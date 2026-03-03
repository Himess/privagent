// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { hash2, hash3 } from "../poseidon.js";

/**
 * Generate view tag for a note recipient.
 * Tag = Poseidon(senderPrivKey, recipientPubKey, nonce) mod 256
 *
 * [M1] Nonce prevents deterministic clustering: same sender→recipient
 * pair produces different tags per transaction.
 *
 * @param senderPrivKey - Sender's private key
 * @param recipientPubKey - Recipient's public key
 * @param nonce - Per-note nonce (use blinding or leafIndex)
 */
export function generateViewTag(
  senderPrivKey: bigint,
  recipientPubKey: bigint,
  nonce?: bigint
): number {
  if (nonce !== undefined) {
    const shared = hash3(senderPrivKey, recipientPubKey, nonce);
    return Number(shared % 256n);
  }
  // Backward compat: no nonce = deterministic (legacy notes)
  const shared = hash2(senderPrivKey, recipientPubKey);
  return Number(shared % 256n);
}

/**
 * Check if a view tag matches (for note scanning).
 * Returns true if note MIGHT belong to us (needs full decrypt to confirm).
 * False positive rate: 1/256 (~0.4%).
 *
 * @param myPrivKey - Recipient's private key
 * @param senderPubKey - Sender's ephemeral public key
 * @param viewTag - The tag to check
 * @param nonce - Per-note nonce (must match what sender used)
 */
export function checkViewTag(
  myPrivKey: bigint,
  senderPubKey: bigint,
  viewTag: number,
  nonce?: bigint
): boolean {
  const expected = generateViewTag(myPrivKey, senderPubKey, nonce);
  return expected === viewTag;
}
