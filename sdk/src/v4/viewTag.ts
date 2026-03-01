// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
import { hash2 } from "../poseidon.js";

/**
 * Generate view tag for a note recipient.
 * Tag = Poseidon(senderPrivKey, recipientPubKey) mod 256
 *
 * View tags allow recipients to pre-filter notes during scanning
 * without attempting full decryption (~50x speedup on large pools).
 * NOT a circuit constraint — wrong tag only affects scan speed, not privacy.
 */
export function generateViewTag(
  senderPrivKey: bigint,
  recipientPubKey: bigint
): number {
  const shared = hash2(senderPrivKey, recipientPubKey);
  return Number(shared % 256n);
}

/**
 * Check if a view tag matches (for note scanning).
 * Returns true if note MIGHT belong to us (needs full decrypt to confirm).
 * False positive rate: 1/256 (~0.4%).
 */
export function checkViewTag(
  myPrivKey: bigint,
  senderPubKey: bigint,
  viewTag: number
): boolean {
  const expected = generateViewTag(myPrivKey, senderPubKey);
  return expected === viewTag;
}
