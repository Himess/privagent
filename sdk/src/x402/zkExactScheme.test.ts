import { describe, it, expect } from "vitest";
import { decodePaymentHeader } from "./zkExactScheme.js";
import type { V2PaymentPayload } from "../types.js";

describe("zkExactScheme", () => {
  it("should encode/decode payment header with proof array", () => {
    const payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "zk-exact",
        network: "eip155:84532",
        amount: "1000000",
        payTo: "0x1234567890abcdef1234567890abcdef12345678",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        poolAddress: "0xaabbccdd",
      },
      payload: {
        from: "shielded",
        nullifierHash: "12345",
        newCommitment: "67890",
        merkleRoot: "11111",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        recipient: "0x000000000000000000000000000000000000dEaD",
        amount: "1000000",
        relayer: "0x0000000000000000000000000000000000000000",
        fee: "0",
        ephemeralPubKeyX: "99999",
        ephemeralPubKeyY: "88888",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.scheme).toBe("zk-exact");
    expect(decoded.accepted.amount).toBe("1000000");
    expect(decoded.payload.nullifierHash).toBe("12345");
    expect(decoded.payload.proof).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(decoded.payload.recipient).toBe("0x000000000000000000000000000000000000dEaD");
    expect(decoded.payload.ephemeralPubKeyX).toBe("99999");
    expect(decoded.payload.ephemeralPubKeyY).toBe("88888");
  });

  it("should handle missing resource gracefully", () => {
    const payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "zk-exact",
        network: "eip155:84532",
        amount: "500000",
        payTo: "0xrecipient",
        maxTimeoutSeconds: 60,
        asset: "0xusdc",
        poolAddress: "0xpool",
      },
      payload: {
        from: "shielded",
        nullifierHash: "99",
        newCommitment: "0",
        merkleRoot: "88",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        recipient: "0xrecipient",
        amount: "500000",
        relayer: "0x0",
        fee: "0",
        ephemeralPubKeyX: "0",
        ephemeralPubKeyY: "0",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);
    expect(decoded.resource).toBeUndefined();
  });

  it("proof should be string array of 8 elements", () => {
    const payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "zk-exact",
        network: "eip155:84532",
        amount: "1000000",
        payTo: "0xrecipient",
        maxTimeoutSeconds: 300,
        asset: "0xusdc",
        poolAddress: "0xpool",
      },
      payload: {
        from: "shielded",
        nullifierHash: "12345",
        newCommitment: "67890",
        merkleRoot: "11111",
        proof: [
          "1111111111111111",
          "2222222222222222",
          "3333333333333333",
          "4444444444444444",
          "5555555555555555",
          "6666666666666666",
          "7777777777777777",
          "8888888888888888",
        ],
        recipient: "0xdead",
        amount: "1000000",
        relayer: "0x0",
        fee: "0",
        ephemeralPubKeyX: "0",
        ephemeralPubKeyY: "0",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);

    expect(Array.isArray(decoded.payload.proof)).toBe(true);
    expect(decoded.payload.proof.length).toBe(8);
    expect(decoded.payload.proof[0]).toBe("1111111111111111");
  });

  it("should include stealthMetaAddress in requirements", () => {
    const payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "zk-exact",
        network: "eip155:84532",
        amount: "1000000",
        payTo: "0xrecipient",
        maxTimeoutSeconds: 300,
        asset: "0xusdc",
        poolAddress: "0xpool",
        stealthMetaAddress: {
          spendingPubKeyX: "111",
          spendingPubKeyY: "222",
          viewingPubKeyX: "333",
          viewingPubKeyY: "444",
        },
      },
      payload: {
        from: "shielded",
        nullifierHash: "12345",
        newCommitment: "67890",
        merkleRoot: "11111",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        recipient: "0xstealth",
        amount: "1000000",
        relayer: "0x0",
        fee: "0",
        ephemeralPubKeyX: "555",
        ephemeralPubKeyY: "666",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);

    expect(decoded.accepted.stealthMetaAddress).toBeDefined();
    expect(decoded.accepted.stealthMetaAddress!.spendingPubKeyX).toBe("111");
    expect(decoded.payload.ephemeralPubKeyX).toBe("555");
  });
});
