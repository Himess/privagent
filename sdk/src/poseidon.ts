import { buildPoseidon, Poseidon } from "circomlibjs";
import { FIELD_SIZE } from "./types.js";

let poseidonInstance: Poseidon | null = null;
let F: any = null;
let initPromise: Promise<void> | null = null;

// H4 FIX: Promise-based singleton lock — no race condition
export function initPoseidon(): Promise<void> {
  if (!initPromise) {
    initPromise = buildPoseidon().then((p) => {
      poseidonInstance = p;
      F = p.F;
    });
  }
  return initPromise;
}

function ensureInitialized(): void {
  if (!poseidonInstance || !F) {
    throw new Error("Poseidon not initialized. Call initPoseidon() first.");
  }
}

// H9 FIX: Field bounds check
function requireFieldBounds(...values: bigint[]): void {
  for (const v of values) {
    if (v < 0n || v >= FIELD_SIZE) {
      throw new Error(`Value out of field bounds: ${v}`);
    }
  }
}

export function hash2(a: bigint, b: bigint): bigint {
  ensureInitialized();
  requireFieldBounds(a, b);
  return F.toObject(poseidonInstance!([a, b]));
}

// V3: Poseidon(3) for 3-input commitment (C6+C7 fix)
export function hash3(a: bigint, b: bigint, c: bigint): bigint {
  ensureInitialized();
  requireFieldBounds(a, b, c);
  return F.toObject(poseidonInstance!([a, b, c]));
}

export function computeCommitment(
  balance: bigint,
  nullifierSecret: bigint,
  randomness: bigint
): bigint {
  return hash3(balance, nullifierSecret, randomness);
}

export function computeNullifierHash(
  nullifierSecret: bigint,
  commitment: bigint
): bigint {
  return hash2(nullifierSecret, commitment);
}

export function getF(): any {
  ensureInitialized();
  return F;
}

export function isInitialized(): boolean {
  return poseidonInstance !== null;
}
