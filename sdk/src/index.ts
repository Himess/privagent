// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
export { initPoseidon, hash1, hash2, hash3, computeCommitment, computeNullifierHash, isInitialized, getF } from "./poseidon.js";
export { MerkleTree } from "./merkle.js";
export * from "./types.js";

// V3 Legacy (deprecated — use V4 API)
/** @deprecated Use V4 ShieldedWallet instead */
export { ProofGenerator } from "./legacy/proof.js";
/** @deprecated Use V4 createUTXO instead */
export { createNote, getNullifierHash, selectNoteForPayment, randomFieldElement, serializeNote, deserializeNote } from "./legacy/note.js";
/** @deprecated Use V4 stealth API instead */
export { AgentStealthKeypair, generateStealthPayment, pubKeyToAddress, serializeStealthMetaAddress, deserializeStealthMetaAddress } from "./legacy/stealth.js";
/** @deprecated Use V4 ShieldedWallet instead */
export { ShieldedPoolClient } from "./legacy/pool.js";

// V4 UTXO Engine (active)
export * from "./v4/index.js";
