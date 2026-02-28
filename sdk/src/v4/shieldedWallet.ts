import { Provider, Signer, Contract, ethers } from "ethers";
import { MerkleTree } from "../merkle.js";
import { initPoseidon } from "../poseidon.js";
import { FIELD_SIZE } from "../types.js";
import {
  UTXO,
  createUTXO,
  createDummyUTXO,
  computeNullifierV4,
  computeCommitmentV4,
  derivePublicKey,
  V4_MERKLE_DEPTH,
} from "./utxo.js";
import { Keypair, keypairFromPrivateKey, generateKeypair } from "./keypair.js";
import { selectUTXOs, getAvailableBalance } from "./coinSelection.js";
import {
  generateJoinSplitProof,
  proofToArray,
  JoinSplitProofResult,
} from "./joinSplitProver.js";
import { ExtData, computeExtDataHash } from "./extData.js";
import { syncTreeFromEvents } from "./treeSync.js";

// ============================================================================
// Pool ABI (V4)
// ============================================================================

const POOL_ABI = [
  "function transact((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, bytes32 root, int256 publicAmount, bytes32 extDataHash, bytes32[] inputNullifiers, bytes32[] outputCommitments) args, (address recipient, address relayer, uint256 fee, bytes encryptedOutput1, bytes encryptedOutput2) extData) external",
  "function getLastRoot() view returns (bytes32)",
  "function isKnownRoot(bytes32) view returns (bool)",
  "function nullifiers(bytes32) view returns (bool)",
  "function nextLeafIndex() view returns (uint256)",
  "function getBalance() view returns (uint256)",
  "function getTreeInfo() view returns (uint256, uint256, bytes32)",
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// ============================================================================
// Config
// ============================================================================

export interface ShieldedWalletConfig {
  provider: Provider;
  signer?: Signer;
  poolAddress: string;
  usdcAddress: string;
  circuitDir: string; // directory containing v4/1x2/ and v4/2x2/
  deployBlock?: number;
}

// ============================================================================
// Result Types
// ============================================================================

export interface TransactResult {
  txHash: string;
  blockNumber: number;
  nullifiers: bigint[];
  commitments: bigint[];
  publicAmount: bigint;
}

export interface GenerateTransactProofResult {
  proofResult: JoinSplitProofResult;
  extData: ExtData;
  extDataHash: bigint;
  inputUTXOs: UTXO[];
  outputUTXOs: UTXO[];
  publicAmount: bigint;
}

// ============================================================================
// ShieldedWallet
// ============================================================================

export class ShieldedWallet {
  private utxos: UTXO[] = [];
  private keypair: Keypair;
  private tree: MerkleTree;
  private config: ShieldedWalletConfig;
  private initialized = false;

  constructor(config: ShieldedWalletConfig, privateKey?: bigint) {
    this.config = config;
    this.keypair = privateKey
      ? keypairFromPrivateKey(privateKey)
      : generateKeypair();
    this.tree = new MerkleTree(V4_MERKLE_DEPTH);
  }

  get publicKey(): bigint {
    return this.keypair.publicKey;
  }

  get privateKey(): bigint {
    return this.keypair.privateKey;
  }

  get circuitDir(): string {
    return this.config.circuitDir;
  }

  async initialize(): Promise<void> {
    await initPoseidon();
    // Re-derive pubkey after Poseidon init (if it was generated before init)
    this.keypair = keypairFromPrivateKey(this.keypair.privateKey);
    this.initialized = true;
  }

  async syncTree(): Promise<void> {
    const { tree, commitments } = await syncTreeFromEvents(
      this.config.provider,
      this.config.poolAddress,
      this.config.deployBlock
    );
    this.tree = tree;

    // Mark UTXOs as spent if their nullifiers are on-chain
    for (const utxo of this.utxos) {
      if (utxo.leafIndex !== undefined) {
        utxo.nullifier = computeNullifierV4(
          utxo.commitment,
          utxo.leafIndex,
          this.keypair.privateKey
        );
      }
    }
  }

  // ============================================================================
  // Balance
  // ============================================================================

  getBalance(): bigint {
    return getAvailableBalance(this.utxos);
  }

  getUTXOs(): UTXO[] {
    return this.utxos.filter((u) => !u.spent && !u.pending);
  }

  // ============================================================================
  // Deposit: USDC → shielded UTXO
  // ============================================================================

  async deposit(amount: bigint): Promise<TransactResult> {
    if (!this.config.signer) throw new Error("Signer required for deposit");

    // Create output UTXO for the deposit
    const depositUTXO = createUTXO(amount, this.keypair.publicKey);
    // Second output is a dummy (zero amount)
    const dummyOutput = createUTXO(0n, this.keypair.publicKey);

    // Dummy input (not spending anything)
    const dummyInput = createDummyUTXO();

    const extData: ExtData = {
      recipient: ethers.ZeroAddress,
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: new Uint8Array([0xaa]),
      encryptedOutput2: new Uint8Array([0xbb]),
    };

    const extDataHash = computeExtDataHash(extData);

    // Generate proof
    const proofResult = await generateJoinSplitProof(
      {
        inputs: [dummyInput],
        outputs: [depositUTXO, dummyOutput],
        publicAmount: amount,
        tree: this.tree,
        extDataHash,
        privateKey: this.keypair.privateKey,
      },
      this.config.circuitDir
    );

    // Build on-chain args
    const poolContract = new Contract(
      this.config.poolAddress,
      POOL_ABI,
      this.config.signer
    );
    const usdcContract = new Contract(
      this.config.usdcAddress,
      USDC_ABI,
      this.config.signer
    );

    // Approve USDC (use MaxUint256 for one-time unlimited approval)
    const signerAddr = await this.config.signer.getAddress();
    const allowance = await usdcContract.allowance(
      signerAddr,
      this.config.poolAddress
    );
    if (BigInt(allowance) < amount) {
      const approveTx = await usdcContract.approve(
        this.config.poolAddress,
        ethers.MaxUint256
      );
      await approveTx.wait();
    }

    // Extract public signals
    const ps = proofResult.proofData.publicSignals;
    const nIns = proofResult.nIns;
    const nOuts = proofResult.nOuts;

    const nullifiers = ps.slice(3, 3 + nIns).map((n) => toBytes32(n));
    const commitments = ps.slice(3 + nIns, 3 + nIns + nOuts).map((c) => toBytes32(c));

    const tx = await poolContract.transact(
      {
        pA: [proofResult.proofData.pA[0], proofResult.proofData.pA[1]],
        pB: proofResult.proofData.pB,
        pC: [proofResult.proofData.pC[0], proofResult.proofData.pC[1]],
        root: toBytes32(ps[0]),
        publicAmount: amount,
        extDataHash: toBytes32(extDataHash),
        inputNullifiers: nullifiers,
        outputCommitments: commitments,
      },
      {
        recipient: extData.recipient,
        relayer: extData.relayer,
        fee: extData.fee,
        encryptedOutput1: extData.encryptedOutput1,
        encryptedOutput2: extData.encryptedOutput2,
      }
    );

    const receipt = await tx.wait();

    // Update local state
    const leafCount = this.tree.getLeafCount();
    depositUTXO.leafIndex = leafCount;
    depositUTXO.nullifier = computeNullifierV4(
      depositUTXO.commitment,
      leafCount,
      this.keypair.privateKey
    );
    this.tree.addLeaf(depositUTXO.commitment);
    this.tree.addLeaf(dummyOutput.commitment);
    this.utxos.push(depositUTXO);
    // Don't track zero-amount dummy

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      nullifiers: ps.slice(3, 3 + nIns),
      commitments: ps.slice(3 + nIns, 3 + nIns + nOuts),
      publicAmount: amount,
    };
  }

  // ============================================================================
  // Generate proof for a private transfer (no on-chain TX submission)
  // ============================================================================

  async generateTransferProof(
    amount: bigint,
    recipientPubkey: bigint,
    recipient: string = ethers.ZeroAddress,
    relayer: string = ethers.ZeroAddress,
    fee: bigint = 0n
  ): Promise<GenerateTransactProofResult> {
    const totalNeeded = amount + fee;

    // Coin selection
    const selection = selectUTXOs(this.utxos, totalNeeded, 2);
    if (!selection) {
      throw new Error("Insufficient shielded balance"); // [SDK-M1] generic error
    }

    // Lock selected UTXOs
    for (const utxo of selection.inputs) {
      utxo.pending = true;
    }

    try {
      // Create output UTXOs
      const paymentUTXO = createUTXO(amount, recipientPubkey);
      const changeUTXO = createUTXO(selection.change, this.keypair.publicKey);

      const extData: ExtData = {
        recipient,
        relayer,
        fee,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const extDataHash = computeExtDataHash(extData);

      // Determine publicAmount
      // For private transfer: publicAmount = 0
      // For withdraw: publicAmount = -(amount + fee)
      let publicAmount = 0n;
      if (recipient !== ethers.ZeroAddress) {
        // Withdraw: money leaves the pool
        publicAmount = -(amount + fee);
      }

      const proofResult = await generateJoinSplitProof(
        {
          inputs: selection.inputs,
          outputs: [paymentUTXO, changeUTXO],
          publicAmount,
          tree: this.tree,
          extDataHash,
          privateKey: this.keypair.privateKey,
        },
        this.config.circuitDir
      );

      return {
        proofResult,
        extData,
        extDataHash,
        inputUTXOs: selection.inputs,
        outputUTXOs: [paymentUTXO, changeUTXO],
        publicAmount,
      };
    } catch (err) {
      // Unlock on failure
      for (const utxo of selection.inputs) {
        utxo.pending = false;
      }
      throw err;
    }
  }

  // ============================================================================
  // Withdraw: shielded → public USDC
  // ============================================================================

  async withdraw(
    amount: bigint,
    recipient: string,
    relayer: string = ethers.ZeroAddress,
    fee: bigint = 0n
  ): Promise<TransactResult> {
    if (!this.config.signer) throw new Error("Signer required for withdraw");

    const result = await this.generateTransferProof(
      amount,
      this.keypair.publicKey, // change goes to self
      recipient,
      relayer,
      fee
    );

    return this.submitTransact(result);
  }

  // ============================================================================
  // Submit transact on-chain
  // ============================================================================

  async submitTransact(
    proof: GenerateTransactProofResult
  ): Promise<TransactResult> {
    if (!this.config.signer) throw new Error("Signer required");

    const poolContract = new Contract(
      this.config.poolAddress,
      POOL_ABI,
      this.config.signer
    );

    const { proofResult, extData, inputUTXOs, outputUTXOs, publicAmount } =
      proof;
    const ps = proofResult.proofData.publicSignals;
    const nIns = proofResult.nIns;
    const nOuts = proofResult.nOuts;

    const nullifiers = ps.slice(3, 3 + nIns).map((n) => toBytes32(n));
    const commitments = ps.slice(3 + nIns, 3 + nIns + nOuts).map((c) => toBytes32(c));

    const tx = await poolContract.transact(
      {
        pA: [proofResult.proofData.pA[0], proofResult.proofData.pA[1]],
        pB: proofResult.proofData.pB,
        pC: [proofResult.proofData.pC[0], proofResult.proofData.pC[1]],
        root: toBytes32(ps[0]),
        publicAmount: publicAmount,
        extDataHash: toBytes32(proof.extDataHash),
        inputNullifiers: nullifiers,
        outputCommitments: commitments,
      },
      {
        recipient: extData.recipient,
        relayer: extData.relayer,
        fee: extData.fee,
        encryptedOutput1: extData.encryptedOutput1,
        encryptedOutput2: extData.encryptedOutput2,
      }
    );

    const receipt = await tx.wait();

    // Consume spent UTXOs
    for (const utxo of inputUTXOs) {
      utxo.spent = true;
      utxo.pending = false;
    }

    // Add new UTXOs to local state
    const leafCount = this.tree.getLeafCount();
    for (let i = 0; i < outputUTXOs.length; i++) {
      const outUTXO = outputUTXOs[i];
      outUTXO.leafIndex = leafCount + i;
      outUTXO.nullifier = computeNullifierV4(
        outUTXO.commitment,
        outUTXO.leafIndex,
        this.keypair.privateKey
      );
      this.tree.addLeaf(outUTXO.commitment);
      // Only track UTXOs that belong to us (pubkey matches)
      if (outUTXO.pubkey === this.keypair.publicKey && outUTXO.amount > 0n) {
        this.utxos.push(outUTXO);
      } else if (outUTXO.amount > 0n) {
        // [SDK-M5] Warn about untracked UTXO (sent to different pubkey)
        console.warn(`Untracked UTXO at leaf ${outUTXO.leafIndex}: pubkey mismatch`);
      }
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      nullifiers: ps.slice(3, 3 + nIns),
      commitments: ps.slice(3 + nIns, 3 + nIns + nOuts),
      publicAmount,
    };
  }

  // ============================================================================
  // UTXO Management
  // ============================================================================

  lockUTXO(utxo: UTXO): void {
    utxo.pending = true;
  }

  unlockUTXO(utxo: UTXO): void {
    utxo.pending = false;
  }

  consumeUTXO(utxo: UTXO): void {
    utxo.spent = true;
    utxo.pending = false;
  }

  addUTXO(utxo: UTXO): void {
    this.utxos.push(utxo);
  }

  getTree(): MerkleTree {
    return this.tree;
  }

  /**
   * Confirm a payment that was submitted by a relayer (x402 flow).
   * Marks input UTXOs as spent and adds output UTXOs to local state.
   */
  confirmPayment(inputUTXOs: UTXO[], outputUTXOs: UTXO[]): void {
    for (const utxo of inputUTXOs) {
      utxo.spent = true;
      utxo.pending = false;
    }

    const leafCount = this.tree.getLeafCount();
    for (let i = 0; i < outputUTXOs.length; i++) {
      const out = outputUTXOs[i];
      out.leafIndex = leafCount + i;
      out.nullifier = computeNullifierV4(
        out.commitment,
        out.leafIndex,
        this.keypair.privateKey
      );
      this.tree.addLeaf(out.commitment);
      if (out.pubkey === this.keypair.publicKey && out.amount > 0n) {
        this.utxos.push(out);
      }
    }
  }

  /**
   * Cancel a pending payment. Unlocks the input UTXOs.
   */
  cancelPayment(inputUTXOs: UTXO[]): void {
    for (const utxo of inputUTXOs) {
      utxo.pending = false;
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toBytes32(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}
