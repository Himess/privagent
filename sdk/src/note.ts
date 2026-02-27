import { randomBytes } from "crypto";
import { computeCommitment, computeNullifierHash } from "./poseidon.js";
import { PrivateNote, FIELD_SIZE } from "./types.js";

/**
 * Generate a random field element (< FIELD_SIZE)
 */
export function randomFieldElement(): bigint {
  return BigInt("0x" + randomBytes(31).toString("hex")) % FIELD_SIZE;
}

/**
 * Create a new private note
 */
export function createNote(balance: bigint): PrivateNote {
  const randomness = randomFieldElement();
  const nullifierSecret = randomFieldElement();
  const commitment = computeCommitment(balance, randomness);

  return {
    commitment,
    balance,
    randomness,
    nullifierSecret,
    leafIndex: -1, // Set after deposit
  };
}

/**
 * Compute the nullifier hash for a note
 */
export function getNullifierHash(note: PrivateNote): bigint {
  return computeNullifierHash(note.nullifierSecret, note.commitment);
}

/**
 * Select the best note for a payment amount.
 * Prefers the smallest note that covers the amount.
 */
export function selectNoteForPayment(
  notes: PrivateNote[],
  amount: bigint,
  fee: bigint = 0n
): PrivateNote | null {
  const required = amount + fee;

  const eligible = notes
    .filter((n) => n.balance >= required)
    .sort((a, b) => {
      // Smallest sufficient note first
      const diff = a.balance - b.balance;
      if (diff < 0n) return -1;
      if (diff > 0n) return 1;
      return 0;
    });

  return eligible[0] ?? null;
}

/**
 * Serialize note to JSON-safe object
 */
export function serializeNote(note: PrivateNote): object {
  return {
    commitment: note.commitment.toString(),
    balance: note.balance.toString(),
    randomness: note.randomness.toString(),
    nullifierSecret: note.nullifierSecret.toString(),
    leafIndex: note.leafIndex,
  };
}

/**
 * Deserialize note from JSON object
 */
export function deserializeNote(data: {
  commitment: string;
  balance: string;
  randomness: string;
  nullifierSecret: string;
  leafIndex: number;
}): PrivateNote {
  return {
    commitment: BigInt(data.commitment),
    balance: BigInt(data.balance),
    randomness: BigInt(data.randomness),
    nullifierSecret: BigInt(data.nullifierSecret),
    leafIndex: data.leafIndex,
  };
}
