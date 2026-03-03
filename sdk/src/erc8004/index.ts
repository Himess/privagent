// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1

/**
 * ERC-8004 integration helpers for PrivAgent.
 * Generates registration file entries and payment proof for feedback.
 */

export interface PrivAgentPaymentMethod {
  scheme: "x402-privagent";
  network: string;
  token: string;
  pool: string;
  facilitator: string;
  privacyLevel: "full-utxo";
  features: string[];
  description: string;
}

export interface PaymentProofForFeedback {
  type: "privagent-nullifier";
  nullifier: string;
  pool: string;
  network: string;
  timestamp: number;
}

/**
 * Generate ERC-8004 compatible payment method entry
 * for agent registration files.
 */
export function privAgentPaymentMethod(config: {
  poolAddress: string;
  facilitatorUrl?: string;
  network?: string;
  token?: string;
}): PrivAgentPaymentMethod {
  return {
    scheme: "x402-privagent",
    network: config.network || "eip155:84532",
    token: config.token || "USDC",
    pool: config.poolAddress,
    facilitator: config.facilitatorUrl || "https://facilitator.privagent.xyz",
    privacyLevel: "full-utxo",
    features: [
      "stealth-addresses",
      "encrypted-amounts",
      "view-tags",
      "zk-proofs",
    ],
    description: "Private x402 payment via PrivAgent",
  };
}

/**
 * Generate proof-of-payment for ERC-8004 feedback submission.
 * Uses nullifier as proof that a real payment was made,
 * without revealing amount, sender, or recipient.
 */
export function paymentProofForFeedback(
  nullifier: string,
  poolAddress: string,
  network?: string
): PaymentProofForFeedback {
  return {
    type: "privagent-nullifier",
    nullifier,
    pool: poolAddress,
    network: network || "eip155:84532",
    timestamp: Date.now(),
  };
}
