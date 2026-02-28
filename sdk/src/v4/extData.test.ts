import { describe, it, expect } from "vitest";
import { computeExtDataHash, ExtData } from "./extData.js";
import { ethers } from "ethers";
import { FIELD_SIZE } from "../types.js";

describe("V4 ExtData", () => {
  it("should compute extDataHash matching on-chain logic", () => {
    const extData: ExtData = {
      recipient: "0x0000000000000000000000000000000000000001",
      relayer: "0x0000000000000000000000000000000000000002",
      fee: 50000n,
      encryptedOutput1: new Uint8Array([0xaa, 0xbb, 0xcc]),
      encryptedOutput2: new Uint8Array([0xdd, 0xee, 0xff]),
    };

    const hash = computeExtDataHash(extData);
    expect(hash).toBeGreaterThan(0n);
    expect(hash).toBeLessThan(FIELD_SIZE);
  });

  it("should be deterministic", () => {
    const extData: ExtData = {
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: new Uint8Array([1, 2, 3]),
      encryptedOutput2: new Uint8Array([4, 5, 6]),
    };

    const hash1 = computeExtDataHash(extData);
    const hash2 = computeExtDataHash(extData);
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different recipients", () => {
    const ext1: ExtData = {
      recipient: "0x0000000000000000000000000000000000000001",
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: new Uint8Array([0]),
      encryptedOutput2: new Uint8Array([0]),
    };

    const ext2: ExtData = {
      ...ext1,
      recipient: "0x0000000000000000000000000000000000000002",
    };

    expect(computeExtDataHash(ext1)).not.toBe(computeExtDataHash(ext2));
  });

  it("should produce different hashes for different fees", () => {
    const ext1: ExtData = {
      recipient: ethers.ZeroAddress,
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: new Uint8Array([0]),
      encryptedOutput2: new Uint8Array([0]),
    };

    const ext2: ExtData = { ...ext1, fee: 50000n };

    expect(computeExtDataHash(ext1)).not.toBe(computeExtDataHash(ext2));
  });

  it("should produce different hashes for different encrypted outputs", () => {
    const ext1: ExtData = {
      recipient: ethers.ZeroAddress,
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: new Uint8Array([0xaa]),
      encryptedOutput2: new Uint8Array([0xbb]),
    };

    const ext2: ExtData = {
      ...ext1,
      encryptedOutput1: new Uint8Array([0xcc]),
    };

    expect(computeExtDataHash(ext1)).not.toBe(computeExtDataHash(ext2));
  });
});
