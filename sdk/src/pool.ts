import { Contract, Interface, Signer, Provider, ethers } from "ethers";
import { initPoseidon, computeCommitment, computeNullifierHash } from "./poseidon.js";
import { MerkleTree } from "./merkle.js";
import { ProofGenerator } from "./proof.js";
import { createNote, selectNoteForPayment, randomFieldElement, getNullifierHash } from "./note.js";
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
  "event Deposited(bytes32 indexed commitment, uint256 indexed leafIndex, uint256 amount, uint256 timestamp)",
  "event NewCommitment(bytes32 indexed commitment, uint256 indexed leafIndex)",
  "event Withdrawn(bytes32 indexed nullifierHash, address indexed recipient, address relayer, uint256 fee)",
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
  private deployBlock?: number;
  // C4 FIX: pending nullifiers to prevent concurrent double-spend
  private pendingNullifiers: Set<string> = new Set();

  constructor(config: GhostPayConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.poolAddress = config.poolAddress;
    this.deployBlock = config.deployBlock;
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
   * Sync local Merkle tree from on-chain events.
   * Paginates in 9000-block chunks to stay within public RPC limits (10K).
   */
  async syncTree(fromBlock?: number): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();

    // Find expected leaf count from on-chain
    const expectedLeaves = Number(await this.poolContract.nextLeafIndex());

    // Start scanning from provided block, deploy block, or recent blocks
    const hasHint = fromBlock !== undefined || this.deployBlock !== undefined;
    let startBlock = fromBlock ?? this.deployBlock ?? Math.max(0, currentBlock - 50000);

    let allLeaves = await this.scanEvents(startBlock, currentBlock);

    // M7 FIX: expand backwards only if needed, reuse results
    if (allLeaves.length < expectedLeaves && !hasHint && startBlock > 0) {
      const expandedStart = Math.max(0, currentBlock - 500000);
      if (expandedStart < startBlock) {
        const earlier = await this.scanEvents(expandedStart, startBlock - 1);
        allLeaves = [...earlier, ...allLeaves];
        allLeaves.sort((a, b) => a.index - b.index);
      }
    }

    if (allLeaves.length < expectedLeaves && !hasHint) {
      allLeaves = await this.scanEvents(0, currentBlock);
    }

    this.merkleTree.setLeaves(allLeaves.map((l) => l.commitment));
  }

  private async scanEvents(
    startBlock: number,
    endBlock: number
  ): Promise<{ index: number; commitment: bigint }[]> {
    const indexedLeaves: { index: number; commitment: bigint }[] = [];
    const depositFilter = this.poolContract.filters.Deposited();
    const changeFilter = this.poolContract.filters.NewCommitment();

    for (let from = startBlock; from <= endBlock; from += 9000) {
      const to = Math.min(from + 8999, endBlock);

      // Query both Deposited and NewCommitment events
      const [depositEvents, changeEvents] = await Promise.all([
        this.poolContract.queryFilter(depositFilter, from, to),
        this.poolContract.queryFilter(changeFilter, from, to),
      ]);

      for (const event of depositEvents) {
        const parsed = this.poolIface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        if (parsed) {
          indexedLeaves.push({
            index: Number(parsed.args.leafIndex),
            commitment: BigInt(parsed.args.commitment),
          });
        }
      }

      for (const event of changeEvents) {
        const parsed = this.poolIface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        if (parsed) {
          indexedLeaves.push({
            index: Number(parsed.args.leafIndex),
            commitment: BigInt(parsed.args.commitment),
          });
        }
      }
    }

    // Sort by leaf index and deduplicate
    indexedLeaves.sort((a, b) => a.index - b.index);
    return indexedLeaves;
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
   *
   * V3: Uses Poseidon(3) for commitments, conditional newCommitment for full-spend.
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

    // M5: Use selectNoteForPayment for optimal selection
    // C4: Skip notes with pending nullifiers
    const availableNotes = this.notes.filter((n) => {
      const nh = getNullifierHash(n).toString();
      return !this.pendingNullifiers.has(nh);
    });

    const note = selectNoteForPayment(availableNotes, amount, fee);
    if (!note) {
      throw new Error(`No note with sufficient balance (need ${amount + fee})`);
    }

    // C4: Lock this note
    const nullifierHash = getNullifierHash(note);
    this.pendingNullifiers.add(nullifierHash.toString());

    try {
      // Compute change
      const change = note.balance - amount - fee;

      // C2 FIX: conditional newCommitment
      let newNullifierSecret: bigint;
      let newRandomness: bigint;
      let newBalance: bigint;
      let newCommitment: bigint;

      if (change > 0n) {
        newNullifierSecret = randomFieldElement();
        newRandomness = randomFieldElement();
        newBalance = change;
        newCommitment = computeCommitment(change, newNullifierSecret, newRandomness);
      } else {
        // Full-spend: circuit outputs 0 via IsZero conditional
        newNullifierSecret = 0n;
        newRandomness = 0n;
        newBalance = 0n;
        newCommitment = 0n;
      }

      const merkleProof = this.merkleTree.getProof(note.leafIndex);

      const circuitInput = {
        balance: note.balance.toString(),
        nullifierSecret: note.nullifierSecret.toString(),
        randomness: note.randomness.toString(),
        newBalance: newBalance.toString(),
        newNullifierSecret: newNullifierSecret.toString(),
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
              nullifierSecret: newNullifierSecret,
              randomness: newRandomness,
            }
          : undefined,
        spentNoteCommitment: note.commitment,
      };
    } catch (err) {
      // C4: Unlock note on failure
      this.pendingNullifiers.delete(nullifierHash.toString());
      throw err;
    }
  }

  /**
   * Unlock a note that was locked for proof generation but whose payment failed.
   * C4: Called when server returns error or network failure.
   */
  unlockNote(nullifierHashStr: string): void {
    this.pendingNullifiers.delete(nullifierHashStr);
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
      nullifierSecret: bigint;
      randomness: bigint;
    }
  ): void {
    const noteIndex = this.notes.findIndex(
      (n) => n.commitment === spentCommitment
    );
    if (noteIndex === -1) return;

    // Remove from pending nullifiers
    const nh = getNullifierHash(this.notes[noteIndex]).toString();
    this.pendingNullifiers.delete(nh);

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
   * Withdraw USDC from the shielded pool with ZK proof (direct call).
   * M12: Requires signer.
   */
  async withdraw(
    recipient: string,
    amount: bigint,
    relayer: string = ethers.ZeroAddress,
    fee: bigint = 0n
  ): Promise<WithdrawResult> {
    if (!this.signer) throw new Error("Signer required for withdraw");
    if (!this.proofGenerator) {
      throw new Error("Circuit paths not configured");
    }

    const proofResult = await this.generateWithdrawProof(
      recipient, amount, relayer, fee
    );

    const tx = await this.poolContract.withdraw(
      recipient,
      amount,
      this.toBytes32(proofResult.nullifierHash),
      proofResult.newCommitment > 0n
        ? this.toBytes32(proofResult.newCommitment)
        : ethers.ZeroHash,
      this.toBytes32(proofResult.merkleRoot),
      relayer,
      fee,
      proofResult.proof
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) {
      // Unlock note on failure
      this.unlockNote(proofResult.nullifierHash.toString());
      throw new Error("Withdraw transaction failed");
    }

    // Consume the spent note
    this.consumeNote(
      proofResult.spentNoteCommitment,
      proofResult.changeNote
    );

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      nullifierHash: proofResult.nullifierHash,
      amount,
      recipient,
      newNote: proofResult.changeNote
        ? {
            commitment: proofResult.changeNote.commitment,
            balance: proofResult.changeNote.balance,
            nullifierSecret: proofResult.changeNote.nullifierSecret,
            randomness: proofResult.changeNote.randomness,
            leafIndex: this.merkleTree.getLeafCount() - 1,
          }
        : undefined,
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
