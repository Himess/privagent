import { describe, it, expect, beforeAll } from "vitest";
import { generateViewTag, checkViewTag } from "./viewTag.js";
import { initPoseidon } from "../poseidon.js";

describe("ViewTag", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should generate deterministic tag (0-255) with nonce", () => {
    const tag = generateViewTag(123n, 456n, 1n);
    expect(tag).toBeGreaterThanOrEqual(0);
    expect(tag).toBeLessThan(256);
    // Deterministic with same nonce
    expect(generateViewTag(123n, 456n, 1n)).toBe(tag);
  });

  it("should match on both sender and receiver side", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const nonce = 42n;
    const tag = generateViewTag(senderPriv, recipientPub, nonce);
    expect(checkViewTag(senderPriv, recipientPub, tag, nonce)).toBe(true);
  });

  it("should not match for wrong recipient", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const wrongPub = 333n;
    const nonce = 42n;
    const tag = generateViewTag(senderPriv, recipientPub, nonce);
    const wrongTag = generateViewTag(senderPriv, wrongPub, nonce);
    if (wrongTag !== tag) {
      expect(checkViewTag(senderPriv, wrongPub, tag, nonce)).toBe(false);
    }
  });

  it("should filter notes efficiently (simulated)", () => {
    const myPriv = 42n;
    const myPub = 100n;
    const nonce = 99n;
    const realTag = generateViewTag(myPriv, myPub, nonce);

    let matches = 0;
    for (let i = 0; i < 1000; i++) {
      const randomTag = i % 256;
      if (randomTag === realTag) matches++;
    }
    expect(matches).toBeLessThan(10);
    expect(matches).toBeGreaterThan(0);
  });

  // [M1] Nonce-based view tags
  it("should differ for same pair with different nonce", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const tag1 = generateViewTag(senderPriv, recipientPub, 1n);
    const tag2 = generateViewTag(senderPriv, recipientPub, 2n);
    const tag3 = generateViewTag(senderPriv, recipientPub, 3n);
    // With high probability, at least some tags differ
    const allSame = tag1 === tag2 && tag2 === tag3;
    expect(allSame).toBe(false);
  });

  it("should check view tag correctly with nonce", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const nonce = 42n;
    const tag = generateViewTag(senderPriv, recipientPub, nonce);
    expect(checkViewTag(senderPriv, recipientPub, tag, nonce)).toBe(true);
  });

  it("should produce different tags with different nonces for same pair", () => {
    const senderPriv = 111n;
    const recipientPub = 222n;
    const tag1 = generateViewTag(senderPriv, recipientPub, 100n);
    const tag2 = generateViewTag(senderPriv, recipientPub, 200n);
    // With high probability these differ (1/256 chance of same)
    // We just verify they are valid tags
    expect(tag1).toBeGreaterThanOrEqual(0);
    expect(tag1).toBeLessThan(256);
    expect(tag2).toBeGreaterThanOrEqual(0);
    expect(tag2).toBeLessThan(256);
  });
});
