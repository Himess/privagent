import { describe, it, expect } from "vitest";
import { privAgentPaymentMethod, paymentProofForFeedback } from "./index.js";

describe("ERC-8004 Integration", () => {
  describe("privAgentPaymentMethod", () => {
    it("should generate correct format with defaults", () => {
      const method = privAgentPaymentMethod({
        poolAddress: "0x8F1ae8209156C22dFD972352A415880040fB0b0c",
      });
      expect(method.scheme).toBe("x402-privagent");
      expect(method.network).toBe("eip155:84532");
      expect(method.token).toBe("USDC");
      expect(method.pool).toBe("0x8F1ae8209156C22dFD972352A415880040fB0b0c");
      expect(method.privacyLevel).toBe("full-utxo");
      expect(method.features).toContain("zk-proofs");
      expect(method.features).toContain("stealth-addresses");
    });

    it("should accept custom config", () => {
      const method = privAgentPaymentMethod({
        poolAddress: "0xAAAA",
        facilitatorUrl: "https://custom.relay.xyz",
        network: "eip155:8453",
        token: "USDT",
      });
      expect(method.network).toBe("eip155:8453");
      expect(method.token).toBe("USDT");
      expect(method.facilitator).toBe("https://custom.relay.xyz");
    });
  });

  describe("paymentProofForFeedback", () => {
    it("should generate correct proof", () => {
      const proof = paymentProofForFeedback(
        "0x1234567890abcdef",
        "0x8F1ae8209156C22dFD972352A415880040fB0b0c"
      );
      expect(proof.type).toBe("privagent-nullifier");
      expect(proof.nullifier).toBe("0x1234567890abcdef");
      expect(proof.pool).toBe("0x8F1ae8209156C22dFD972352A415880040fB0b0c");
      expect(proof.network).toBe("eip155:84532");
      expect(proof.timestamp).toBeGreaterThan(0);
    });

    it("should include timestamp", () => {
      const before = Date.now();
      const proof = paymentProofForFeedback("0xabc", "0xdef");
      const after = Date.now();
      expect(proof.timestamp).toBeGreaterThanOrEqual(before);
      expect(proof.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
