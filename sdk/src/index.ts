// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
export { initPoseidon, hash1, hash2, hash3, computeCommitment, computeNullifierHash, isInitialized, getF } from "./poseidon.js";
export { MerkleTree } from "./merkle.js";
export * from "./types.js";

// ERC-8004 Integration
export {
  ghostPayPaymentMethod,
  paymentProofForFeedback,
  GhostPayPaymentMethod,
  PaymentProofForFeedback,
} from "./erc8004/index.js";

// V4 UTXO Engine (active)
export * from "./v4/index.js";

// Utilities
export { createLogger, setLogLevel, getLogLevel } from "./utils/logger.js";
export type { Logger, LogLevel } from "./utils/logger.js";
