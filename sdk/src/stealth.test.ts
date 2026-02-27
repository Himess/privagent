import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "./poseidon.js";
import { AgentStealthKeypair, generateStealthPayment } from "./stealth.js";

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
});
