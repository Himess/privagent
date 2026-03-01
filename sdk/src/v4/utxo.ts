// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
import { randomBytes } from "crypto";
import { hash1, hash3 } from "../poseidon.js";
import { FIELD_SIZE } from "../types.js";

// ============================================================================
// V4 UTXO Types
// ============================================================================

export interface UTXO {
  amount: bigint;
  pubkey: bigint; // Poseidon(privateKey)
  blinding: bigint; // random field element
  commitment: bigint; // Poseidon(amount, pubkey, blinding)

  // Metadata (not part of commitment)
  nullifier?: bigint;
  leafIndex?: number;
  spent: boolean;
  pending: boolean; // C4 lock
}

export interface SerializedUTXO {
  amount: string;
  pubkey: string;
  blinding: string;
  commitment: string;
  nullifier?: string;
  leafIndex?: number;
  spent: boolean;
  pending: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const V4_MERKLE_DEPTH = 20;
export const V4_MAX_LEAVES = 1048576; // 2^20

// ============================================================================
// Core Functions
// ============================================================================

export function randomFieldElement(): bigint {
  return BigInt("0x" + randomBytes(31).toString("hex")) % FIELD_SIZE;
}

/**
 * Derive public key from private key: publicKey = Poseidon(privateKey)
 */
export function derivePublicKey(privateKey: bigint): bigint {
  return hash1(privateKey);
}

/**
 * Compute UTXO commitment: Poseidon(amount, pubkey, blinding)
 * Matches circuit: UTXOCommitment template in joinSplit.circom
 */
export function computeCommitmentV4(
  amount: bigint,
  pubkey: bigint,
  blinding: bigint
): bigint {
  return hash3(amount, pubkey, blinding);
}

/**
 * Compute nullifier: Poseidon(commitment, pathIndex, privateKey)
 * Matches circuit: NullifierHasher template in joinSplit.circom
 */
export function computeNullifierV4(
  commitment: bigint,
  pathIndex: number,
  privateKey: bigint
): bigint {
  return hash3(commitment, BigInt(pathIndex), privateKey);
}

/**
 * Create a new UTXO with the given amount and public key
 */
export function createUTXO(amount: bigint, pubkey: bigint): UTXO {
  // [SDK-H1] Validate field bounds
  if (amount < 0n || amount >= FIELD_SIZE) {
    throw new Error("Amount out of field range");
  }
  if (pubkey < 0n || pubkey >= FIELD_SIZE) {
    throw new Error("Pubkey out of field range");
  }

  const blinding = randomFieldElement();
  const commitment = computeCommitmentV4(amount, pubkey, blinding);

  return {
    amount,
    pubkey,
    blinding,
    commitment,
    spent: false,
    pending: false,
  };
}

/**
 * Create a dummy UTXO (amount=0) for padding JoinSplit inputs.
 * Uses privateKey=0 → pubkey=Poseidon(0) to match the circuit
 * which always derives pubkey from privateKey.
 */
export function createDummyUTXO(): UTXO {
  const dummyPubkey = derivePublicKey(0n); // Poseidon(0)
  const commitment = computeCommitmentV4(0n, dummyPubkey, 0n);
  return {
    amount: 0n,
    pubkey: dummyPubkey,
    blinding: 0n,
    commitment,
    spent: false,
    pending: false,
  };
}

/**
 * Serialize UTXO for JSON storage
 */
export function serializeUTXO(utxo: UTXO): SerializedUTXO {
  return {
    amount: utxo.amount.toString(),
    pubkey: utxo.pubkey.toString(),
    blinding: utxo.blinding.toString(),
    commitment: utxo.commitment.toString(),
    nullifier: utxo.nullifier?.toString(),
    leafIndex: utxo.leafIndex,
    spent: utxo.spent,
    pending: utxo.pending,
  };
}

/**
 * Deserialize UTXO from JSON
 */
export function deserializeUTXO(data: SerializedUTXO): UTXO {
  return {
    amount: BigInt(data.amount),
    pubkey: BigInt(data.pubkey),
    blinding: BigInt(data.blinding),
    commitment: BigInt(data.commitment),
    nullifier: data.nullifier ? BigInt(data.nullifier) : undefined,
    leafIndex: data.leafIndex,
    spent: data.spent,
    pending: data.pending,
  };
}
