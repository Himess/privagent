import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon, hash2, computeCommitment, computeNullifierHash, isInitialized } from "./poseidon.js";

describe("poseidon", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should initialize", () => {
    expect(isInitialized()).toBe(true);
  });

  it("should hash two values deterministically", () => {
    const a = hash2(1n, 2n);
    const b = hash2(1n, 2n);
    expect(a).toBe(b);
  });

  it("should produce different hashes for different inputs", () => {
    const a = hash2(1n, 2n);
    const b = hash2(2n, 1n);
    expect(a).not.toBe(b);
  });

  it("should hash zero values", () => {
    const result = hash2(0n, 0n);
    expect(result).toBeTypeOf("bigint");
    expect(result).not.toBe(0n);
  });

  it("computeCommitment should match hash2", () => {
    const balance = 1000000n;
    const randomness = 12345n;
    expect(computeCommitment(balance, randomness)).toBe(hash2(balance, randomness));
  });

  it("computeNullifierHash should match hash2", () => {
    const secret = 999n;
    const commitment = 888n;
    expect(computeNullifierHash(secret, commitment)).toBe(hash2(secret, commitment));
  });
});
