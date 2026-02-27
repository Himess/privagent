import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "./poseidon.js";
import {
  AgentStealthKeypair,
  generateStealthPayment,
  deriveStealthEthAddress,
  serializeStealthMetaAddress,
  deserializeStealthMetaAddress,
} from "./stealth.js";

describe("stealth", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should generate keypair", () => {
    const kp = AgentStealthKeypair.generate();
    expect(kp.spendingPrivKey).toBeTypeOf("bigint");
    expect(kp.viewingPrivKey).toBeTypeOf("bigint");
    expect(kp.spendingPubKeyX).toBeTypeOf("bigint");
    expect(kp.viewingPubKeyX).toBeTypeOf("bigint");
  });

  it("should produce consistent meta-address", () => {
    const kp = new AgentStealthKeypair(42n, 43n);
    const meta = kp.getMetaAddress();
    expect(meta.spendingPubKeyX).toBe(kp.spendingPubKeyX);
    expect(meta.viewingPubKeyX).toBe(kp.viewingPubKeyX);
  });

  it("should detect own payments", () => {
    const recipient = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();

    const payment = generateStealthPayment(
      meta.spendingPubKeyX,
      meta.spendingPubKeyY,
      meta.viewingPubKeyX,
      meta.viewingPubKeyY
    );

    expect(
      recipient.isPaymentForMe(
        payment.ephemeralPubKeyX,
        payment.stealthAddressX,
        payment.stealthAddressY
      )
    ).toBe(true);
  });

  it("should not detect others' payments", () => {
    const recipient = AgentStealthKeypair.generate();
    const other = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();

    const payment = generateStealthPayment(
      meta.spendingPubKeyX,
      meta.spendingPubKeyY,
      meta.viewingPubKeyX,
      meta.viewingPubKeyY
    );

    expect(
      other.isPaymentForMe(
        payment.ephemeralPubKeyX,
        payment.stealthAddressX,
        payment.stealthAddressY
      )
    ).toBe(false);
  });

  it("view tag should be consistent", () => {
    const recipient = AgentStealthKeypair.generate();
    const meta = recipient.getMetaAddress();

    const payment = generateStealthPayment(
      meta.spendingPubKeyX,
      meta.spendingPubKeyY,
      meta.viewingPubKeyX,
      meta.viewingPubKeyY
    );

    const viewTag = recipient.computeViewTag(payment.ephemeralPubKeyX);
    expect(viewTag).toBe(payment.viewTag);
  });

  // New tests for deriveStealthEthAddress

  it("deriveStealthEthAddress should return valid Ethereum address", () => {
    const addr = deriveStealthEthAddress(12345n, 67890n);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("deriveStealthEthAddress should be deterministic", () => {
    const addr1 = deriveStealthEthAddress(12345n, 67890n);
    const addr2 = deriveStealthEthAddress(12345n, 67890n);
    expect(addr1).toBe(addr2);
  });

  it("deriveStealthEthAddress should produce different addresses for different inputs", () => {
    const addr1 = deriveStealthEthAddress(12345n, 67890n);
    const addr2 = deriveStealthEthAddress(99999n, 11111n);
    expect(addr1).not.toBe(addr2);
  });

  // New tests for serialize/deserialize

  it("should serialize and deserialize StealthMetaAddress", () => {
    const kp = AgentStealthKeypair.generate();
    const meta = kp.getMetaAddress();

    const serialized = serializeStealthMetaAddress(meta);
    expect(typeof serialized.spendingPubKeyX).toBe("string");
    expect(typeof serialized.spendingPubKeyY).toBe("string");
    expect(typeof serialized.viewingPubKeyX).toBe("string");
    expect(typeof serialized.viewingPubKeyY).toBe("string");

    const deserialized = deserializeStealthMetaAddress(serialized);
    expect(deserialized.spendingPubKeyX).toBe(meta.spendingPubKeyX);
    expect(deserialized.spendingPubKeyY).toBe(meta.spendingPubKeyY);
    expect(deserialized.viewingPubKeyX).toBe(meta.viewingPubKeyX);
    expect(deserialized.viewingPubKeyY).toBe(meta.viewingPubKeyY);
  });
});
