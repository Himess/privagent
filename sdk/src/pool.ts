import { Contract, Interface, Signer, Provider, ethers } from "ethers";
import { initPoseidon, computeCommitment, computeNullifierHash } from "./poseidon.js";
import { MerkleTree } from "./merkle.js";
import { ProofGenerator } from "./proof.js";
import { createNote, randomFieldElement, getNullifierHash } from "./note.js";
import {
  GhostPayConfig,
  PrivateNote,
  DepositResult,
  WithdrawResult,
  GenerateProofResult,
  MERKLE_DEPTH,
} from "./types.js";

const POOL_ABI = [
  "function deposit(uint256 amount, bytes32 commitment) external",
  "function withdraw(address recipient, uint256 amount, bytes32 nullifierHash, bytes32 newCommitment, bytes32 merkleRoot, address relayer, uint256 fee, uint256[8] calldata proof) external",
  "function getLastRoot() external view returns (bytes32)",
  "function getTreeInfo() external view returns (uint256, uint256, bytes32)",
  "function getBalance() external view returns (uint256)",
  "function nextLeafIndex() external view returns (uint256)",
  "function isKnownRoot(bytes32 root) external view returns (bool)",
  "event Deposited(address indexed depositor, uint256 amount, bytes32 indexed commitment, uint256 leafIndex)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

export class ShieldedPoolClient {
  private provider: Provider;
  private signer?: Signer;
  private poolContract: Contract;
  private poolIface: Interface;
  private merkleTree: MerkleTree;
  private proofGenerator?: ProofGenerator;
  private notes: PrivateNote[] = [];
  private poolAddress: string;

  constructor(config: GhostPayConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.poolAddress = config.poolAddress;
    this.poolIface = new Interface(POOL_ABI);
    this.merkleTree = new MerkleTree(MERKLE_DEPTH);

    const signerOrProvider = config.signer ?? config.provider;
    this.poolContract = new Contract(config.poolAddress, POOL_ABI, signerOrProvider);

    if (config.circuitWasm && config.circuitZkey && config.circuitVkey) {
      this.proofGenerator = new ProofGenerator(
        config.circuitWasm,
        config.circuitZkey,
        config.circuitVkey
      );
    }
  }

  async initialize(): Promise<void> {
    await initPoseidon();
    await this.syncTree();
  }

  /**
   * Sync local Merkle tree from on-chain deposit events.
   * Paginates in 9000-block chunks to stay within public RPC limits (10K).
   */
  async syncTree(): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    const filter = this.poolContract.filters.Deposited();

    const allLeaves: bigint[] = [];
    for (let from = 0; from <= currentBlock; from += 9000) {
      const to = Math.min(from + 8999, currentBlock);
      const events = await this.poolContract.queryFilter(filter, from, to);

      for (const event of events) {
        const parsed = this.poolIface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        if (parsed) {
          allLeaves.push(BigInt(parsed.args.commitment));
        }
      }
    }

    this.merkleTree.setLeaves(allLeaves);
  }

  /**
   * Deposit USDC into the shielded pool
   */
  async deposit(amount: bigint, usdcAddress: string): Promise<DepositResult> {
    if (!this.signer) throw new Error("Signer required for deposit");

    const note = createNote(amount);

    // Approve USDC if needed
    const usdcContract = new Contract(usdcAddress, ERC20_ABI, this.signer);
    const signerAddress = await this.signer.getAddress();
    const allowance = await usdcContract.allowance(signerAddress, this.poolAddress);

    if (BigInt(allowance) < amount) {
      const approveTx = await usdcContract.approve(this.poolAddress, ethers.MaxUint256);
      await approveTx.wait();
    }

    // Deposit
    const commitmentBytes32 = this.toBytes32(note.commitment);
    const tx = await this.poolContract.deposit(amount, commitmentBytes32);
    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      throw new Error("Deposit transaction failed");
    }

    // Extract leaf index from event
    let leafIndex = -1;
    for (const log of receipt.logs) {
      try {
        const parsed = this.poolIface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "Deposited") {
          leafIndex = Number(parsed.args.leafIndex);
          break;
        }
      } catch {
        // skip
      }
    }

    note.leafIndex = leafIndex;
    this.notes.push(note);
    this.merkleTree.addLeaf(note.commitment);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      commitment: note.commitment,
      leafIndex,
      note,
    };
  }

  /**
   * Generate a ZK withdraw proof WITHOUT submitting a transaction.
   * Returns the raw proof and metadata needed for the server to call withdraw().
   */
  async generateWithdrawProof(
    recipient: string,
    amount: bigint,
    relayer: string = ethers.ZeroAddress,
    fee: bigint = 0n
  ): Promise<GenerateProofResult> {
    if (!this.proofGenerator) {
      throw new Error("Circuit paths not configured");
    }

    // Find suitable note
    const note = this.notes.find((n) => n.balance >= amount + fee);
    if (!note) {
      throw new Error(`No note with sufficient balance (need ${amount + fee})`);
    }

    // Compute proof inputs
    const nullifierHash = getNullifierHash(note);
    const change = note.balance - amount - fee;
    const newRandomness = randomFieldElement();
    const newNullifierSecret = randomFieldElement();
    const newCommitment = change > 0n ? computeCommitment(change, newRandomness) : 0n;

    const merkleProof = this.merkleTree.getProof(note.leafIndex);

    const circuitInput = {
      balance: note.balance.toString(),
      randomness: note.randomness.toString(),
      nullifierSecret: note.nullifierSecret.toString(),
      newRandomness: newRandomness.toString(),
      pathElements: merkleProof.pathElements.map((e) => e.toString()),
      pathIndices: merkleProof.pathIndices.map((i) => i.toString()),
      root: merkleProof.root.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: BigInt(recipient).toString(),
      amount: amount.toString(),
      relayer: BigInt(relayer).toString(),
      fee: fee.toString(),
    };

    const { proofData } = await this.proofGenerator.generateProof(circuitInput);

    // Flatten proof to uint256[8]
    const proofArray = ProofGenerator.proofToArray(proofData);

    return {
      proof: proofArray,
      nullifierHash,
      newCommitment,
      merkleRoot: merkleProof.root,
      amount,
      recipient,
      relayer,
      fee,
      changeNote: change > 0n
        ? {
            commitment: newCommitment,
            balance: change,
            randomness: newRandomness,
            nullifierSecret: newNullifierSecret,
          }
        : undefined,
      spentNoteCommitment: note.commitment,
    };
  }

  /**
   * Consume a spent note and optionally add the change note.
   * Called AFTER the server confirms the on-chain withdrawal succeeded.
   */
  consumeNote(
    spentCommitment: bigint,
    changeNote?: {
      commitment: bigint;
      balance: bigint;
      randomness: bigint;
      nullifierSecret: bigint;
    }
  ): void {
    const noteIndex = this.notes.findIndex(
      (n) => n.commitment === spentCommitment
    );
    if (noteIndex === -1) return;

    if (changeNote) {
      const newNote: PrivateNote = {
        ...changeNote,
        leafIndex: this.merkleTree.getLeafCount(),
      };
      this.notes[noteIndex] = newNote;
      this.merkleTree.addLeaf(changeNote.commitment);
    } else {
      this.notes.splice(noteIndex, 1);
    }
  }

  /**
   * Withdraw USDC from the shielded pool with ZK proof
   */
  async withdraw(
    recipient: string,
    amount: bigint,
    relayer: string = ethers.ZeroAddress,
    fee: bigint = 0n
  ): Promise<WithdrawResult> {
    if (!this.proofGenerator) {
      throw new Error("Circuit paths not configured");
    }

    // Find suitable note
    const note = this.notes.find((n) => n.balance >= amount + fee);
    if (!note) {
      throw new Error(`No note with sufficient balance (need ${amount + fee})`);
    }

    // Compute proof inputs
    const nullifierHash = getNullifierHash(note);
    const change = note.balance - amount - fee;
    const newRandomness = randomFieldElement();
    const newCommitment = change > 0n ? computeCommitment(change, newRandomness) : 0n;

    const merkleProof = this.merkleTree.getProof(note.leafIndex);

    const circuitInput = {
      balance: note.balance.toString(),
      randomness: note.randomness.toString(),
      nullifierSecret: note.nullifierSecret.toString(),
      newRandomness: newRandomness.toString(),
      pathElements: merkleProof.pathElements.map((e) => e.toString()),
      pathIndices: merkleProof.pathIndices.map((i) => i.toString()),
      root: merkleProof.root.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: BigInt(recipient).toString(),
      amount: amount.toString(),
      relayer: BigInt(relayer).toString(),
      fee: fee.toString(),
    };

    const { proofData } = await this.proofGenerator.generateProof(circuitInput);

    // Submit withdrawal
    const proofArray = ProofGenerator.proofToArray(proofData);

    const tx = await this.poolContract.withdraw(
      recipient,
      amount,
      this.toBytes32(nullifierHash),
      change > 0n ? this.toBytes32(newCommitment) : ethers.ZeroHash,
      this.toBytes32(merkleProof.root),
      relayer,
      fee,
      proofArray
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) {
      throw new Error("Withdraw transaction failed");
    }

    // Update local state
    const noteIndex = this.notes.indexOf(note);
    let newNote: PrivateNote | undefined;

    if (change > 0n) {
      newNote = {
        commitment: newCommitment,
        balance: change,
        randomness: newRandomness,
        nullifierSecret: randomFieldElement(),
        leafIndex: this.merkleTree.getLeafCount(),
      };
      this.notes[noteIndex] = newNote;
      this.merkleTree.addLeaf(newCommitment);
    } else {
      this.notes.splice(noteIndex, 1);
    }

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      nullifierHash,
      amount,
      recipient,
      newNote,
    };
  }

  /**
   * Get the current on-chain root
   */
  async getOnChainRoot(): Promise<bigint> {
    const root = await this.poolContract.getLastRoot();
    return BigInt(root);
  }

  /**
   * Get pool balance
   */
  async getPoolBalance(): Promise<bigint> {
    const balance = await this.poolContract.getBalance();
    return BigInt(balance);
  }

  /**
   * Get total shielded balance across all notes
   */
  getTotalBalance(): bigint {
    return this.notes.reduce((sum, n) => sum + n.balance, 0n);
  }

  /**
   * Get all notes
   */
  getNotes(): PrivateNote[] {
    return [...this.notes];
  }

  /**
   * Add an externally-created note (e.g., from a relayer response)
   */
  addNote(note: PrivateNote): void {
    this.notes.push(note);
  }

  /**
   * Get the local Merkle tree root
   */
  getLocalRoot(): bigint {
    return this.merkleTree.getRoot();
  }

  getMerkleTree(): MerkleTree {
    return this.merkleTree;
  }

  private toBytes32(value: bigint): string {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
  }
}
