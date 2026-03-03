// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { randomBytes } from "crypto";
import { derivePublicKey, randomFieldElement } from "./utxo.js";
import { FIELD_SIZE } from "../types.js";

export interface Keypair {
  privateKey: bigint;
  publicKey: bigint;
}

/**
 * Generate a new random keypair
 * publicKey = Poseidon(privateKey)
 */
export function generateKeypair(): Keypair {
  const privateKey = randomFieldElement();
  const publicKey = derivePublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Restore keypair from existing private key
 */
export function keypairFromPrivateKey(privateKey: bigint): Keypair {
  const publicKey = derivePublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Serialize keypair for JSON storage
 */
export function serializeKeypair(kp: Keypair): { privateKey: string; publicKey: string } {
  return {
    privateKey: kp.privateKey.toString(),
    publicKey: kp.publicKey.toString(),
  };
}

/**
 * Deserialize keypair from JSON
 */
export function deserializeKeypair(data: { privateKey: string; publicKey: string }): Keypair {
  return {
    privateKey: BigInt(data.privateKey),
    publicKey: BigInt(data.publicKey),
  };
}
