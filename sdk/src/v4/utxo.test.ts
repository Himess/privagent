import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "../poseidon.js";
import {
  createUTXO,
  createDummyUTXO,
  computeCommitmentV4,
  computeNullifierV4,
  derivePublicKey,
  randomFieldElement,
  serializeUTXO,
  deserializeUTXO,
} from "./utxo.js";

describe("V4 UTXO", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should create UTXO with correct commitment", () => {
    const pubkey = derivePublicKey(42n);
    const utxo = createUTXO(1000000n, pubkey);

    expect(utxo.amount).toBe(1000000n);
    expect(utxo.pubkey).toBe(pubkey);
    expect(utxo.blinding).toBeDefined();
    expect(utxo.commitment).toBeDefined();
    expect(utxo.spent).toBe(false);
    expect(utxo.pending).toBe(false);

    // Verify commitment matches manual calculation
    const expected = computeCommitmentV4(utxo.amount, utxo.pubkey, utxo.blinding);
    expect(utxo.commitment).toBe(expected);
  });

  it("should compute nullifier deterministically", () => {
    const privateKey = 12345n;
    const pubkey = derivePublicKey(privateKey);
    const utxo = createUTXO(500n, pubkey);
    utxo.leafIndex = 7;

    const nullifier1 = computeNullifierV4(utxo.commitment, utxo.leafIndex, privateKey);
    const nullifier2 = computeNullifierV4(utxo.commitment, utxo.leafIndex, privateKey);
    expect(nullifier1).toBe(nullifier2);
    expect(nullifier1).not.toBe(0n);
  });

  it("should produce different commitments with different blinding", () => {
    const pubkey = derivePublicKey(99n);
    const utxo1 = createUTXO(1000n, pubkey);
    const utxo2 = createUTXO(1000n, pubkey);

    // Same amount + pubkey but different random blinding
    expect(utxo1.commitment).not.toBe(utxo2.commitment);
  });

  it("should create dummy UTXO with zero amount", () => {
    const dummy = createDummyUTXO();
    expect(dummy.amount).toBe(0n);
    // pubkey = Poseidon(0), not 0n (matches circuit behavior)
    expect(dummy.pubkey).toBe(derivePublicKey(0n));
    expect(dummy.blinding).not.toBe(0n); // random blinding for unique nullifiers
    expect(dummy.commitment).toBeDefined();
  });

  it("should derive public key from private key", () => {
    const pk1 = derivePublicKey(42n);
    const pk2 = derivePublicKey(42n);
    const pk3 = derivePublicKey(43n);

    expect(pk1).toBe(pk2); // deterministic
    expect(pk1).not.toBe(pk3); // different keys → different pubkeys
  });

  it("should generate random field elements within bounds", () => {
    const FIELD_SIZE = BigInt(
      "21888242871839275222246405745257275088548364400416034343698204186575808495617"
    );
    for (let i = 0; i < 10; i++) {
      const r = randomFieldElement();
      expect(r).toBeGreaterThanOrEqual(0n);
      expect(r).toBeLessThan(FIELD_SIZE);
    }
  });

  it("should serialize and deserialize UTXO", () => {
    const pubkey = derivePublicKey(77n);
    const utxo = createUTXO(5000000n, pubkey);
    utxo.leafIndex = 42;
    utxo.nullifier = 123456789n;

    const serialized = serializeUTXO(utxo);
    const deserialized = deserializeUTXO(serialized);

    expect(deserialized.amount).toBe(utxo.amount);
    expect(deserialized.pubkey).toBe(utxo.pubkey);
    expect(deserialized.blinding).toBe(utxo.blinding);
    expect(deserialized.commitment).toBe(utxo.commitment);
    expect(deserialized.leafIndex).toBe(utxo.leafIndex);
    expect(deserialized.nullifier).toBe(utxo.nullifier);
  });

  it("should compute nullifier differently with different path indices", () => {
    const privateKey = 42n;
    const commitment = computeCommitmentV4(100n, derivePublicKey(privateKey), 1n);
    const null1 = computeNullifierV4(commitment, 0, privateKey);
    const null2 = computeNullifierV4(commitment, 1, privateKey);

    expect(null1).not.toBe(null2);
  });
});
