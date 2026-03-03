// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { UTXO } from "./utxo.js";

export interface CoinSelectionResult {
  inputs: UTXO[];
  change: bigint;
}

/**
 * Select UTXOs for a payment.
 * Strategy: exact match first, then smallest-first accumulation.
 *
 * @param available - Available (unspent, unlocked) UTXOs
 * @param targetAmount - Amount to spend
 * @param maxInputs - Max inputs (1 for 1x2 circuit, 2 for 2x2)
 * @returns Selected UTXOs + change amount, or null if insufficient
 */
export function selectUTXOs(
  available: UTXO[],
  targetAmount: bigint,
  maxInputs: number = 2
): CoinSelectionResult | null {
  // Filter out spent and pending UTXOs
  const eligible = available.filter((u) => !u.spent && !u.pending && u.amount > 0n);

  if (eligible.length === 0) return null;

  // 1. Try exact match (single UTXO == target)
  const exact = eligible.find((u) => u.amount === targetAmount);
  if (exact) {
    return { inputs: [exact], change: 0n };
  }

  // 2. [M3] Deterministic sort: amount ascending, then leafIndex ascending (FIFO)
  const sorted = [...eligible].sort((a, b) => {
    if (a.amount < b.amount) return -1;
    if (a.amount > b.amount) return 1;
    return (a.leafIndex ?? 0) - (b.leafIndex ?? 0);
  });

  // 3. Try single UTXO that covers the target (smallest sufficient)
  const singleSufficient = sorted.find((u) => u.amount >= targetAmount);
  if (singleSufficient) {
    return {
      inputs: [singleSufficient],
      change: singleSufficient.amount - targetAmount,
    };
  }

  // 4. Accumulate smallest-first up to maxInputs
  let accumulated = 0n;
  const selected: UTXO[] = [];

  for (const utxo of sorted) {
    if (selected.length >= maxInputs) break;
    selected.push(utxo);
    accumulated += utxo.amount;
    if (accumulated >= targetAmount) {
      return {
        inputs: selected,
        change: accumulated - targetAmount,
      };
    }
  }

  // Insufficient balance or too many inputs needed
  return null;
}

/**
 * Get total balance of available UTXOs
 */
export function getAvailableBalance(utxos: UTXO[]): bigint {
  return utxos
    .filter((u) => !u.spent && !u.pending)
    .reduce((sum, u) => sum + u.amount, 0n);
}
