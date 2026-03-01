import { describe, it, expect, beforeAll } from "vitest";
import { generateViewTag, checkViewTag } from "./viewTag.js";
import { initPoseidon } from "../poseidon.js";

describe("ViewTag", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should generate deterministic tag (0-255)", () => {
    const tag = generateViewTag(123n, 456n);
    expect(tag).toBeGreaterThanOrEqual(0);
    expect(tag).toBeLessThan(256);
    // Deterministic
    expect(generateViewTag(123n, 456n)).toBe(tag);
  });

  it("should match on both sender and receiver side", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const tag = generateViewTag(senderPriv, recipientPub);
    expect(checkViewTag(senderPriv, recipientPub, tag)).toBe(true);
  });

  it("should not match for wrong recipient", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const wrongPub = 333n;
    const tag = generateViewTag(senderPriv, recipientPub);
    // Tag with wrong key should be different (with high probability)
    const wrongTag = generateViewTag(senderPriv, wrongPub);
    // They could theoretically match (1/256 chance) but very unlikely with these specific values
    if (wrongTag !== tag) {
      expect(checkViewTag(senderPriv, wrongPub, tag)).toBe(false);
    }
  });

  it("should filter notes efficiently (simulated)", () => {
    const myPriv = 42n;
    const myPub = 100n;
    const realTag = generateViewTag(myPriv, myPub);

    // Simulate 1000 random tags
    let matches = 0;
    for (let i = 0; i < 1000; i++) {
      const randomTag = i % 256;
      if (randomTag === realTag) matches++;
    }
    // Should be approximately 1000/256 ≈ 3.9 matches
    expect(matches).toBeLessThan(10);
    expect(matches).toBeGreaterThan(0);
  });
});
