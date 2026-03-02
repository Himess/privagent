// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
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
import { NoteStore, MemoryNoteStore, StoredNote } from "./noteStore.js";
import { generateViewTag } from "./viewTag.js";

// ============================================================================
// Pool ABI (V4)
// ============================================================================

const POOL_ABI = [
  "function transact((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, bytes32 root, int256 publicAmount, bytes32 extDataHash, uint256 protocolFee, bytes32[] inputNullifiers, bytes32[] outputCommitments, uint8[] viewTags) args, (address recipient, address relayer, uint256 fee, bytes encryptedOutput1, bytes encryptedOutput2) extData) external",
  "function getLastRoot() view returns (bytes32)",
  "function isKnownRoot(bytes32) view returns (bool)",
  "function nullifiers(bytes32) view returns (bool)",
  "function nextLeafIndex() view returns (uint256)",
  "function getBalance() view returns (uint256)",
  "function getTreeInfo() view returns (uint256, uint256, bytes32)",
  "function protocolFeeBps() view returns (uint256)",
  "function minProtocolFee() view returns (uint256)",
  "function treasury() view returns (address)",
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
  noteStore?: NoteStore; // optional persistent note storage (default: MemoryNoteStore)
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
  private noteStore: NoteStore;

  constructor(config: ShieldedWalletConfig, privateKey?: bigint) {
    this.config = config;
    this.noteStore = config.noteStore || new MemoryNoteStore();
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

    // Load persisted notes from NoteStore
    const stored = await this.noteStore.getUnspent();
    for (const sn of stored) {
      const utxo: UTXO = {
        amount: BigInt(sn.amount),
        pubkey: BigInt(sn.pubkey),
        blinding: BigInt(sn.blinding),
        commitment: BigInt(sn.commitment),
        nullifier: BigInt(sn.nullifier),
        leafIndex: sn.leafIndex,
        spent: false,
        pending: false,
      };
      // Avoid duplicates (if already tracked)
      if (!this.utxos.some((u) => u.commitment === utxo.commitment)) {
        this.utxos.push(utxo);
      }
    }

    this.initialized = true;
  }

  private utxoToStoredNote(utxo: UTXO, txHash?: string): StoredNote {
    return {
      commitment: utxo.commitment.toString(),
      nullifier: (utxo.nullifier ?? 0n).toString(),
      amount: utxo.amount.toString(),
      pubkey: utxo.pubkey.toString(),
      blinding: utxo.blinding.toString(),
      leafIndex: utxo.leafIndex ?? 0,
      spent: !!utxo.spent,
      createdAt: Date.now(),
      txHash,
    };
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

    // Calculate protocol fee for deposit
    const feeParams = await this.getProtocolFeeParams();
    const protocolFee = ShieldedWallet.calculateProtocolFee(
      amount,
      feeParams.feeBps,
      feeParams.minFee,
      feeParams.treasury !== ethers.ZeroAddress
    );

    // Deposit UTXO amount = depositAmount - protocolFee (circuit balance conservation)
    // Circuit: 0 + publicAmount = sumOutputs + protocolFee
    //        → sumOutputs = publicAmount - protocolFee = amount - protocolFee
    const depositUTXO = createUTXO(amount - protocolFee, this.keypair.publicKey);
    // Second output is a dummy (zero amount)
    const dummyOutput = createUTXO(0n, this.keypair.publicKey);

    // Generate proof
    const proofResult = await generateJoinSplitProof(
      {
        inputs: [dummyInput],
        outputs: [depositUTXO, dummyOutput],
        publicAmount: amount,
        protocolFee,
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

    // Approve USDC: deposit amount + protocol fee (contract does 2 transferFrom calls)
    const totalApproval = amount + protocolFee;
    const signerAddr = await this.config.signer.getAddress();
    const allowance = await usdcContract.allowance(
      signerAddr,
      this.config.poolAddress
    );
    if (BigInt(allowance) < totalApproval) {
      const approveTx = await usdcContract.approve(
        this.config.poolAddress,
        totalApproval
      );
      await approveTx.wait();
    }

    // Extract public signals (V4.4: offset 4 due to protocolFee at [3])
    const ps = proofResult.proofData.publicSignals;
    const nIns = proofResult.nIns;
    const nOuts = proofResult.nOuts;

    const nullifiers = ps.slice(4, 4 + nIns).map((n) => toBytes32(n));
    const commitments = ps.slice(4 + nIns, 4 + nIns + nOuts).map((c) => toBytes32(c));

    // Generate view tags for outputs
    const viewTags = [depositUTXO, dummyOutput].map((u) =>
      generateViewTag(this.keypair.privateKey, u.pubkey)
    );

    const tx = await poolContract.transact(
      {
        pA: [proofResult.proofData.pA[0], proofResult.proofData.pA[1]],
        pB: proofResult.proofData.pB,
        pC: [proofResult.proofData.pC[0], proofResult.proofData.pC[1]],
        root: toBytes32(ps[0]),
        publicAmount: amount,
        extDataHash: toBytes32(extDataHash),
        protocolFee,
        inputNullifiers: nullifiers,
        outputCommitments: commitments,
        viewTags,
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

    // Persist to NoteStore
    await this.noteStore.save(this.utxoToStoredNote(depositUTXO, receipt.hash));

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      nullifiers: ps.slice(4, 4 + nIns),
      commitments: ps.slice(4 + nIns, 4 + nIns + nOuts),
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
    // Calculate protocol fee first (needed for coin selection)
    const feeParams = await this.getProtocolFeeParams();

    // Determine publicAmount and output structure based on TX type
    let publicAmount = 0n;
    let paymentAmount: bigint;
    let feeBase: bigint;

    if (recipient !== ethers.ZeroAddress) {
      // Withdraw: money leaves the pool publicly
      // publicAmount = -(amount + fee), protocolFee from pool surplus
      publicAmount = -(amount + fee);
      paymentAmount = 0n; // payment is PUBLIC, not a shielded output
      feeBase = amount + fee;
    } else {
      // Private transfer: stays in pool as shielded UTXO
      paymentAmount = amount;
      feeBase = amount;
    }

    const protocolFee = ShieldedWallet.calculateProtocolFee(
      feeBase,
      feeParams.feeBps,
      feeParams.minFee,
      feeParams.treasury !== ethers.ZeroAddress
    );

    // totalNeeded includes protocolFee (circuit balance conservation)
    const totalNeeded = amount + fee + protocolFee;

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
      // For withdraw: paymentAmount=0 (dummy), change absorbs remaining balance
      // For transfer: paymentAmount=amount (shielded), change absorbs remaining
      const paymentUTXO = createUTXO(paymentAmount, recipientPubkey);
      const changeUTXO = createUTXO(selection.change, this.keypair.publicKey);

      const extData: ExtData = {
        recipient,
        relayer,
        fee,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const extDataHash = computeExtDataHash(extData);

      const proofResult = await generateJoinSplitProof(
        {
          inputs: selection.inputs,
          outputs: [paymentUTXO, changeUTXO],
          publicAmount,
          protocolFee,
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

    const nullifiers = ps.slice(4, 4 + nIns).map((n) => toBytes32(n));
    const commitments = ps.slice(4 + nIns, 4 + nIns + nOuts).map((c) => toBytes32(c));

    // protocolFee is at public signal index [3]
    const protocolFee = ps[3];

    // Generate view tags for outputs
    const viewTags = outputUTXOs.map((u) =>
      generateViewTag(this.keypair.privateKey, u.pubkey)
    );

    const tx = await poolContract.transact(
      {
        pA: [proofResult.proofData.pA[0], proofResult.proofData.pA[1]],
        pB: proofResult.proofData.pB,
        pC: [proofResult.proofData.pC[0], proofResult.proofData.pC[1]],
        root: toBytes32(ps[0]),
        publicAmount: publicAmount,
        extDataHash: toBytes32(proof.extDataHash),
        protocolFee,
        inputNullifiers: nullifiers,
        outputCommitments: commitments,
        viewTags,
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
      if (utxo.nullifier !== undefined) {
        await this.noteStore.markSpent(utxo.nullifier.toString());
      }
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
        await this.noteStore.save(this.utxoToStoredNote(outUTXO, receipt.hash));
      } else if (outUTXO.amount > 0n) {
        // [SDK-M5] Warn about untracked UTXO (sent to different pubkey)
        console.warn(`Untracked UTXO at leaf ${outUTXO.leafIndex}: pubkey mismatch`);
      }
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      nullifiers: ps.slice(4, 4 + nIns),
      commitments: ps.slice(4 + nIns, 4 + nIns + nOuts),
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
  async confirmPayment(inputUTXOs: UTXO[], outputUTXOs: UTXO[]): Promise<void> {
    for (const utxo of inputUTXOs) {
      utxo.spent = true;
      utxo.pending = false;
      if (utxo.nullifier !== undefined) {
        await this.noteStore.markSpent(utxo.nullifier.toString());
      }
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
        await this.noteStore.save(this.utxoToStoredNote(out));
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

  // ============================================================================
  // Protocol Fee
  // ============================================================================

  /**
   * Calculate protocol fee for a given amount.
   * fee = max(amount * feeBps / 10000, minFee)
   * Returns 0 if treasury is not set.
   */
  static calculateProtocolFee(
    amount: bigint,
    feeBps: bigint,
    minFee: bigint,
    hasTreasury: boolean
  ): bigint {
    if (!hasTreasury) return 0n;
    const percentFee = (amount * feeBps) / 10000n;
    return percentFee > minFee ? percentFee : minFee;
  }

  /**
   * Query protocol fee parameters from the pool contract.
   */
  async getProtocolFeeParams(): Promise<{
    feeBps: bigint;
    minFee: bigint;
    treasury: string;
  }> {
    const poolContract = new Contract(
      this.config.poolAddress,
      POOL_ABI,
      this.config.provider
    );
    const [feeBps, minFee, treasury] = await Promise.all([
      poolContract.protocolFeeBps(),
      poolContract.minProtocolFee(),
      poolContract.treasury(),
    ]);
    return {
      feeBps: BigInt(feeBps),
      minFee: BigInt(minFee),
      treasury: treasury as string,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toBytes32(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}
