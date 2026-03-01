import { describe, it, expect } from "vitest";
import {
  AgentStealthKeypair,
  generateStealthPayment,
  pubKeyToAddress,
  serializeStealthMetaAddress,
  deserializeStealthMetaAddress,
} from "./stealth.js";

describe("stealth (secp256k1 ECDH)", () => {
  it("should generate keypair with valid secp256k1 keys", () => {
    const kp = AgentStealthKeypair.generate();
    // Private keys are Uint8Array (32 bytes)
    expect(kp.spendingPrivKey).toBeInstanceOf(Uint8Array);
    expect(kp.viewingPrivKey).toBeInstanceOf(Uint8Array);
    expect(kp.spendingPrivKey.length).toBe(32);
    expect(kp.viewingPrivKey.length).toBe(32);
    // Public keys are uncompressed (65 bytes)
    expect(kp.spendingPubKey).toBeInstanceOf(Uint8Array);
    expect(kp.viewingPubKey).toBeInstanceOf(Uint8Array);
    expect(kp.spendingPubKey.length).toBe(65);
    expect(kp.viewingPubKey.length).toBe(65);
    // Uncompressed prefix 0x04
    expect(kp.spendingPubKey[0]).toBe(0x04);
    expect(kp.viewingPubKey[0]).toBe(0x04);
  });

  it("should produce consistent meta-address", () => {
    const kp = AgentStealthKeypair.generate();
    const meta = kp.getMetaAddress();
    expect(meta.spendingPubKey).toMatch(/^0x04/);
    expect(meta.viewingPubKey).toMatch(/^0x04/);
    // Should be hex strings of uncompressed public keys (65 bytes = 130 hex + 0x prefix)
    expect(meta.spendingPubKey.length).toBe(132);
    expect(meta.viewingPubKey.length).toBe(132);
  });

  it("should generate stealth payment with valid address", () => {
    const recipient = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();
    const payment = generateStealthPayment(meta);

    expect(payment.stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(payment.ephemeralPubKey).toMatch(/^0x04/);
    expect(payment.viewTag).toBeGreaterThanOrEqual(0);
    expect(payment.viewTag).toBeLessThan(256);
  });

  it("recipient should recover same stealth address from ephemeral key (C1 fix)", () => {
    const recipient = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();
    const payment = generateStealthPayment(meta);

    // Recipient derives stealth address using ephemeral public key
    const derived = recipient.deriveStealthAddress(payment.ephemeralPubKey);
    expect(derived.stealthAddress).toBe(payment.stealthAddress);
    // Should also produce a valid private key
    expect(derived.stealthPrivKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("different recipient should NOT recover same stealth address", () => {
    const recipient = AgentStealthKeypair.generate();
    const other = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();
    const payment = generateStealthPayment(meta);

    const derivedOther = other.deriveStealthAddress(payment.ephemeralPubKey);
    expect(derivedOther.stealthAddress).not.toBe(payment.stealthAddress);
  });

  it("view tag should be consistent between sender and recipient", () => {
    const recipient = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();
    const payment = generateStealthPayment(meta);

    const viewTag = recipient.computeViewTag(payment.ephemeralPubKey);
    expect(viewTag).toBe(payment.viewTag);
  });

  it("pubKeyToAddress should return valid Ethereum address", () => {
    const kp = AgentStealthKeypair.generate();
    const addr = pubKeyToAddress(kp.spendingPubKey);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("pubKeyToAddress should be deterministic", () => {
    const kp = AgentStealthKeypair.generate();
    const addr1 = pubKeyToAddress(kp.spendingPubKey);
    const addr2 = pubKeyToAddress(kp.spendingPubKey);
    expect(addr1).toBe(addr2);
  });

  it("different keys should produce different stealth addresses", () => {
    const kp1 = AgentStealthKeypair.generate();
    const kp2 = AgentStealthKeypair.generate();
    const meta1 = kp1.getMetaAddress();
    const meta2 = kp2.getMetaAddress();

    const payment1 = generateStealthPayment(meta1);
    const payment2 = generateStealthPayment(meta2);
    expect(payment1.stealthAddress).not.toBe(payment2.stealthAddress);
  });

  it("should serialize and deserialize StealthMetaAddress", () => {
    const kp = AgentStealthKeypair.generate();
    const meta = kp.getMetaAddress();

    const serialized = serializeStealthMetaAddress(meta);
    expect(typeof serialized.spendingPubKey).toBe("string");
    expect(typeof serialized.viewingPubKey).toBe("string");

    const deserialized = deserializeStealthMetaAddress(serialized);
    expect(deserialized.spendingPubKey).toBe(meta.spendingPubKey);
    expect(deserialized.viewingPubKey).toBe(meta.viewingPubKey);
  });

  it("serialize roundtrip should preserve stealth recovery", () => {
    const recipient = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();
    const serialized = serializeStealthMetaAddress(meta);
    const deserialized = deserializeStealthMetaAddress(serialized);

    // Generate payment using deserialized meta-address
    const payment = generateStealthPayment(deserialized);
    const derived = recipient.deriveStealthAddress(payment.ephemeralPubKey);
    expect(derived.stealthAddress).toBe(payment.stealthAddress);
  });
});
