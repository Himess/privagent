// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1

/**
 * [H3] Public signal indices for JoinSplit circuits.
 * Centralized definition — update ONLY here when circuit changes.
 *
 * V4.4 signal order:
 *   [0] root
 *   [1] publicAmount
 *   [2] extDataHash
 *   [3] protocolFee
 *   [4..4+nIn-1] nullifiers
 *   [4+nIn..4+nIn+nOut-1] commitments
 */
export const SIGNAL_INDEX = {
  ROOT: 0,
  PUBLIC_AMOUNT: 1,
  EXT_DATA_HASH: 2,
  PROTOCOL_FEE: 3,

  nullifierStart: () => 4,
  nullifierEnd: (nIn: number) => 4 + nIn,
  commitmentStart: (nIn: number) => 4 + nIn,
  commitmentEnd: (nIn: number, nOut: number) => 4 + nIn + nOut,

  /** Total expected public signals for a given circuit config */
  totalSignals: (nIn: number, nOut: number) => 4 + nIn + nOut,
} as const;

/**
 * Validate that publicSignals array matches expected circuit config.
 * Throws if mismatch detected.
 */
export function validateSignalCount(
  publicSignals: (string | bigint)[],
  nIn: number,
  nOut: number
): void {
  const expected = SIGNAL_INDEX.totalSignals(nIn, nOut);
  if (publicSignals.length !== expected) {
    throw new Error(
      `Signal count mismatch: got ${publicSignals.length}, ` +
        `expected ${expected} for ${nIn}x${nOut} circuit`
    );
  }
}
