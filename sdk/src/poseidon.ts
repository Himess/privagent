import { buildPoseidon, Poseidon } from "circomlibjs";

let poseidonInstance: Poseidon | null = null;
let F: any = null;

export async function initPoseidon(): Promise<void> {
  if (poseidonInstance) return;
  poseidonInstance = await buildPoseidon();
  F = poseidonInstance.F;
}

function ensureInitialized(): void {
  if (!poseidonInstance || !F) {
    throw new Error("Poseidon not initialized. Call initPoseidon() first.");
  }
}

export function hash2(a: bigint, b: bigint): bigint {
  ensureInitialized();
  return F.toObject(poseidonInstance!([a, b]));
}

export function computeCommitment(balance: bigint, randomness: bigint): bigint {
  return hash2(balance, randomness);
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
