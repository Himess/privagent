import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon, hash2, hash3, computeCommitment, computeNullifierHash, isInitialized } from "./poseidon.js";
import { FIELD_SIZE } from "./types.js";

describe("poseidon", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should initialize successfully", () => {
    expect(isInitialized()).toBe(true);
  });

  it("should produce deterministic hash2 results", () => {
    const a = hash2(1n, 2n);
    const b = hash2(1n, 2n);
    expect(a).toBe(b);
  });

  it("should produce different hash2 for different inputs", () => {
    const a = hash2(1n, 2n);
    const b = hash2(2n, 1n);
    expect(a).not.toBe(b);
  });

  it("should hash zero values", () => {
    const result = hash2(0n, 0n);
    expect(result).toBeTypeOf("bigint");
    expect(result).not.toBe(0n);
  });

  it("should produce deterministic hash3 results", () => {
    const a = hash3(1n, 2n, 3n);
    const b = hash3(1n, 2n, 3n);
    expect(a).toBe(b);
  });

  it("should produce different hash3 for different inputs", () => {
    const a = hash3(1n, 2n, 3n);
    const b = hash3(3n, 2n, 1n);
    expect(a).not.toBe(b);
  });

  it("hash2 and hash3 should differ for overlapping inputs", () => {
    const h2 = hash2(1n, 2n);
    const h3 = hash3(1n, 2n, 0n);
    expect(h2).not.toBe(h3);
  });

  it("computeCommitment should use hash3 (V3 3-input)", () => {
    const amount = 1000000n;
    const nullifierSecret = 12345n;
    const randomness = 67890n;
    const commitment = computeCommitment(amount, nullifierSecret, randomness);
    const expected = hash3(amount, nullifierSecret, randomness);
    expect(commitment).toBe(expected);
  });

  it("computeNullifierHash should use hash2", () => {
    const secret = 999n;
    const commitment = 888n;
    expect(computeNullifierHash(secret, commitment)).toBe(hash2(secret, commitment));
  });

  it("should throw on values >= FIELD_SIZE (H9 fix)", () => {
    expect(() => hash2(FIELD_SIZE, 0n)).toThrow("out of field bounds");
    expect(() => hash3(0n, 0n, FIELD_SIZE)).toThrow("out of field bounds");
  });

  it("should throw on negative values (H9 fix)", () => {
    expect(() => hash2(-1n, 0n)).toThrow("out of field bounds");
  });

  it("should handle concurrent initPoseidon calls (H4 fix)", async () => {
    await Promise.all([initPoseidon(), initPoseidon(), initPoseidon()]);
    expect(isInitialized()).toBe(true);
  });
});
