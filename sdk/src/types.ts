import { Provider, Signer } from "ethers";

// ============================================================================
// Constants
// ============================================================================

export const FIELD_SIZE = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

export const MERKLE_DEPTH = 20;

export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ============================================================================
// SDK Configuration
// ============================================================================

export interface GhostPayConfig {
  provider: Provider;
  signer?: Signer;
  poolAddress: string;
  circuitWasm?: string;
  circuitZkey?: string;
  circuitVkey?: string;
}

// ============================================================================
// Private Note
// ============================================================================

export interface PrivateNote {
  commitment: bigint;
  balance: bigint;
  randomness: bigint;
  nullifierSecret: bigint;
  leafIndex: number;
}

// ============================================================================
// Merkle Proof
// ============================================================================

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
  leafIndex: number;
}

// ============================================================================
// ZK Proof
// ============================================================================

export interface ProofData {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  publicSignals: bigint[];
}

export interface CircuitInput {
  balance: string;
  randomness: string;
  nullifierSecret: string;
  newRandomness: string;
  pathElements: string[];
  pathIndices: string[];
  root: string;
  nullifierHash: string;
  recipient: string;
  amount: string;
  relayer: string;
  fee: string;
}

// ============================================================================
// Stealth
// ============================================================================

export interface StealthMetaAddress {
  spendingPubKeyX: bigint;
  spendingPubKeyY: bigint;
  viewingPubKeyX: bigint;
  viewingPubKeyY: bigint;
}

export interface SerializedStealthMetaAddress {
  spendingPubKeyX: string;
  spendingPubKeyY: string;
  viewingPubKeyX: string;
  viewingPubKeyY: string;
}

export interface StealthPaymentData {
  ephemeralPrivKey: bigint;
  ephemeralPubKeyX: bigint;
  ephemeralPubKeyY: bigint;
  stealthAddressX: bigint;
  stealthAddressY: bigint;
  viewTag: bigint;
  sharedSecret: bigint;
}

// ============================================================================
// Results
// ============================================================================

export interface DepositResult {
  txHash: string;
  blockNumber: number;
  commitment: bigint;
  leafIndex: number;
  note: PrivateNote;
}

export interface WithdrawResult {
  txHash: string;
  blockNumber: number;
  nullifierHash: bigint;
  amount: bigint;
  recipient: string;
  newNote?: PrivateNote;
}

export interface GenerateProofResult {
  proof: bigint[];
  nullifierHash: bigint;
  newCommitment: bigint;
  merkleRoot: bigint;
  amount: bigint;
  recipient: string;
  relayer: string;
  fee: bigint;
  changeNote?: {
    commitment: bigint;
    balance: bigint;
    randomness: bigint;
    nullifierSecret: bigint;
  };
  spentNoteCommitment: bigint;
}

// ============================================================================
// x402 Types
// ============================================================================

export interface ZkPaymentRequirements {
  scheme: "zk-exact";
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  poolAddress: string;
  relayer?: string;
  relayerFee?: string;
  stealthMetaAddress?: SerializedStealthMetaAddress;
}

export interface ZkExactPayload {
  from: string;
  nullifierHash: string;
  newCommitment: string;
  merkleRoot: string;
  proof: string[];
  recipient: string;
  amount: string;
  relayer: string;
  fee: string;
  ephemeralPubKeyX: string;
  ephemeralPubKeyY: string;
}

export interface V2PaymentPayload {
  x402Version: 2;
  accepted: ZkPaymentRequirements;
  resource?: ResourceInfo;
  payload: ZkExactPayload;
}

export interface ResourceInfo {
  url: string;
  method: string;
  headers?: Record<string, string>;
}

export interface PaymentRequired {
  x402Version: 2;
  accepts: ZkPaymentRequirements[];
  resource: ResourceInfo;
  error?: string;
}

export interface PaymentResult {
  nullifierHash: string;
  paymentHeader: string;
  requirements: ZkPaymentRequirements;
  _proofResult?: GenerateProofResult;
}

export interface PaymentInfo {
  nullifierHash: string;
  from: string;
  amount: string;
  asset: string;
  recipient: string;
  txHash: string;
  blockNumber: number;
}

export interface GhostPaywallConfig {
  price: string;
  asset: string;
  recipient: string;
  network?: string;
  poolAddress: string;
  relayer?: string;
  relayerFee?: string;
  maxTimeoutSeconds?: number;
  signer: Signer;
  stealthMetaAddress?: SerializedStealthMetaAddress;
}

export interface GhostFetchOptions extends RequestInit {
  maxPayment?: bigint;
  allowedNetworks?: string[];
  dryRun?: boolean;
}
