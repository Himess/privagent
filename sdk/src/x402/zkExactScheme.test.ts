import { describe, it, expect } from "vitest";
import { decodePaymentHeader } from "./zkExactScheme.js";
import type { V2PaymentPayload } from "../types.js";

describe("zkExactScheme", () => {
  it("should encode/decode payment header", () => {
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
        proof: "0xdeadbeef",
        relayer: "0x0000000000000000000000000000000000000000",
        fee: "0",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.scheme).toBe("zk-exact");
    expect(decoded.accepted.amount).toBe("1000000");
    expect(decoded.payload.nullifierHash).toBe("12345");
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
        proof: "0xproof",
        relayer: "0x0",
        fee: "0",
      },
    };

    const encoded = btoa(JSON.stringify(payload));
    const decoded = decodePaymentHeader(encoded);
    expect(decoded.resource).toBeUndefined();
  });
});
