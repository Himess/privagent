# GhostPay Security Audit Report

> **V4.4 Audit:** See [docs/AUDIT-V4.4.md](docs/AUDIT-V4.4.md) for the latest comprehensive audit.

## Summary (V3)

Full audit of GhostPay privacy x402 payment protocol. All findings fixed in V3.

- **Total findings:** 28 (7 Critical, 9 High, 12 Medium, 8 Low) — all fixed in V3
- **V3.1 fixes:** 5 additional (middleware validation, off-chain verify, duplicate commitment, fee trapping, exact approval)
- **Status:** All FIXED
- **Tests:** 95 (32 Foundry + 63 SDK)
- **E2E:** Verified on Base Sepolia
- **ShieldedPool V3.1:** `0xbA5c38093CefBbFA08577b08b0494D5c7738E4F6` (redeployed)

---

## Critical Findings

### C1: Stealth addresses use Poseidon hash instead of ECDH
**Status:** FIXED
**Fix:** Replaced Poseidon-based stealth with secp256k1 ECDH (`@noble/curves/secp256k1`). Real EC keypairs with recoverable stealth private keys. Compatible with ERC-5564 Scheme 1.
**Files:** `sdk/src/stealth.ts`, `sdk/src/stealth.test.ts`

### C2: Full-spend produces non-zero newCommitment
**Status:** FIXED
**Fix:** Added `IsZero` circuit gate: `expectedNewCommitment = (1 - IsZero(change)) * Poseidon(...)`. Full-spend outputs 0, contract skips Merkle insert.
**Files:** `circuits/privatePayment.circom`, `sdk/src/pool.ts`

### C3: Middleware does not validate recipient address
**Status:** FIXED
**Fix:** Added recipient validation in middleware. Skipped when stealth meta-address is enabled (stealth addresses are unpredictable by server).
**Files:** `sdk/src/x402/middleware.ts`

### C4: No note locking for concurrent payments
**Status:** FIXED
**Fix:** Added `pendingNullifiers` Set in pool.ts. `selectNote()` skips locked notes. Lock acquired before proof generation, released on failure.
**Files:** `sdk/src/pool.ts`

### C5: Middleware does not validate relayer or fee
**Status:** FIXED
**Fix:** Added relayer address and fee validation. Relayer must match config, fee must not exceed `maxFee`.
**Files:** `sdk/src/x402/middleware.ts`

### C6: Commitment missing nullifierSecret binding
**Status:** FIXED
**Fix:** Changed commitment from `Poseidon(balance, randomness)` to `Poseidon(balance, nullifierSecret, randomness)`. Prevents creating two valid nullifiers for the same commitment.
**Files:** `circuits/privatePayment.circom`, `sdk/src/note.ts`, `sdk/src/pool.ts`

### C7: Amount not bound to commitment
**Status:** FIXED
**Fix:** Amount is now the first input to Poseidon(3) commitment. Circuit enforces `balance >= amount + fee` where `balance` is the preimage. Fake balance = different commitment = not in Merkle tree.
**Files:** `circuits/privatePayment.circom`, `sdk/src/note.ts`

---

## High Findings

### H1: No reentrancy protection on deposit/withdraw
**Status:** FIXED
**Fix:** Added OpenZeppelin `ReentrancyGuard` with `nonReentrant` modifier on both functions.
**Files:** `contracts/src/ShieldedPool.sol`

### H2: No pre-flight checks before gas-expensive withdraw
**Status:** FIXED
**Fix:** Middleware checks `isKnownRoot()` and `nullifiers()` before submitting on-chain TX. Returns 402 (retry) or 402 (already processed) without wasting gas.
**Files:** `sdk/src/x402/middleware.ts`

### H3: No emergency pause mechanism
**Status:** FIXED
**Fix:** Added OpenZeppelin `Pausable` + `Ownable`. Owner can pause/unpause. Both deposit and withdraw blocked when paused.
**Files:** `contracts/src/ShieldedPool.sol`

### H4: Poseidon initialization race condition
**Status:** FIXED
**Fix:** Promise-based singleton lock. Concurrent `initPoseidon()` calls share the same initialization promise.
**Files:** `sdk/src/poseidon.ts`

### H5: _proofResult exposes sensitive data
**Status:** FIXED
**Fix:** `_proofResult` only contains commitment (for consumeNote). nullifierSecret and randomness not exposed.
**Files:** `sdk/src/x402/zkExactScheme.ts`

### H6: consumeNote without TX verification
**Status:** FIXED
**Fix:** ghostFetch checks `X-Payment-TxHash` header before calling `consumeNote()`. No header = no state update.
**Files:** `sdk/src/x402/zkFetch.ts`

### H7: onPayment callback timing
**Status:** FIXED
**Fix:** Callback fires after retry response is received and processed (after consumeNote).
**Files:** `sdk/src/x402/zkFetch.ts`

### H8: Deposit leaf index desync
**Status:** FIXED
**Fix:** `deposit()` calls `syncTree()` after successful on-chain deposit to ensure local tree matches chain.
**Files:** `sdk/src/pool.ts`

### H9: No field bounds checking on Poseidon inputs
**Status:** FIXED
**Fix:** `hash2()` and `hash3()` validate all inputs are `< BN254_FIELD_SIZE`. Throws on overflow.
**Files:** `sdk/src/poseidon.ts`

---

## Medium Findings

### M1: ROOT_HISTORY_SIZE too small (30)
**Status:** FIXED
**Fix:** Increased from 30 to 100.
**Files:** `contracts/src/ShieldedPool.sol`

### M2: LessEqThan bit width too large (252)
**Status:** FIXED
**Fix:** Changed from `LessEqThan(252)` to `LessEqThan(64)`. USDC amounts fit in 64 bits. Reduces constraints.
**Files:** `circuits/privatePayment.circom`

### M3: Standalone relayer is redundant
**Status:** FIXED (DEPRECATED)
**Fix:** Standalone relayer deprecated. Server-as-relayer middleware handles withdrawal submission. Relayer package kept for reference but not used in V3 flow.
**Files:** `relayer/` (deprecated)

### M5: selectNoteForPayment not integrated
**Status:** FIXED
**Fix:** Integrated into pool.ts as `selectNote()` with pending note filtering (C4).
**Files:** `sdk/src/pool.ts`

### M6: No maximum deposit limit
**Status:** FIXED
**Fix:** Added `MAX_DEPOSIT = 1_000_000_000_000` (1M USDC) constant with validation in deposit().
**Files:** `contracts/src/ShieldedPool.sol`

### M7: syncTree inefficient scanning
**Status:** FIXED
**Fix:** Paginated scanning in 9,000-block chunks (RPC 10K limit). Uses `deployBlock` config to avoid scanning from block 0. Scans both Deposited and Withdrawn events (change commitments).
**Files:** `sdk/src/pool.ts`

### M10: MerkleTree no capacity check
**Status:** FIXED
**Fix:** `addLeaf()` checks `leafCount < 2^20` before insertion. Throws on overflow.
**Files:** `sdk/src/merkle.ts`

### M12: withdraw() no signer check
**Status:** FIXED
**Fix:** `withdraw()` and `generateWithdrawProof()` validate signer is available before proceeding.
**Files:** `sdk/src/pool.ts`

---

## Low Findings

### L1: Events not indexed
**Status:** FIXED
**Fix:** Added `indexed` to event parameters (commitment, nullifierHash, recipient).
**Files:** `contracts/src/ShieldedPool.sol`

### L2: String errors instead of custom errors
**Status:** FIXED
**Fix:** Replaced all `require()` strings with custom error types: `ZeroAmount`, `InvalidCommitment`, `ExceedsMaxDeposit`, `NullifierAlreadyUsed`, `UnknownMerkleRoot`, `InvalidRecipient`, `InsufficientPoolBalance`, `InvalidProof`.
**Files:** `contracts/src/ShieldedPool.sol`

### L5: atob/btoa not available in all environments
**Status:** FIXED
**Fix:** Replaced with `Buffer.from(str, "base64")` / `Buffer.from(str).toString("base64")`.
**Files:** `sdk/src/x402/middleware.ts`, `sdk/src/x402/zkExactScheme.ts`

### L6: Error messages leak internal state
**Status:** FIXED
**Fix:** Generic error messages (`"Invalid payment"`, `"Payment processing failed"`) — no internal details.
**Files:** `sdk/src/x402/middleware.ts`

### L7: E2E test lacks balance assertions
**Status:** FIXED
**Fix:** E2E test prints before/after shielded balances and verifies response + TX hash.
**Files:** `demo/e2e-test.ts`

### L8: No ceremony documentation
**Status:** FIXED
**Fix:** Created `circuits/CEREMONY.md` with Phase 1/Phase 2 details and production requirements.
**Files:** `circuits/CEREMONY.md`

### Other Low Fixes
- Custom errors in all Foundry tests (selector-based assertions)
- initPoseidon() called in both SDK entry points (tsup split-bundle compatibility)
- deployBlock config prevents scanning from block 0 on public RPCs

---

## V3.1 Post-Audit Fixes

### P1: Middleware newCommitment validation bug
**Status:** FIXED
**Fix:** `!p.newCommitment === undefined` always evaluated to `false` due to operator precedence. Changed to `p.newCommitment === undefined || p.newCommitment === null`.
**Files:** `sdk/src/x402/middleware.ts`

### P2: Off-chain proof verification (gas drain prevention)
**Status:** FIXED
**Fix:** Added snarkjs.groth16.verify() before on-chain submit. Invalid proofs rejected without wasting gas. Requires `verificationKeyPath` or `verificationKey` in config.
**Files:** `sdk/src/x402/middleware.ts`, `sdk/src/types.ts`

### P3: Duplicate commitment check
**Status:** FIXED
**Fix:** `commitmentExists` mapping was written but never read. Added `if (commitmentExists[commitment]) revert DuplicateCommitment()` in deposit().
**Files:** `contracts/src/ShieldedPool.sol`

### P4: Fee + zero relayer fund trapping
**Status:** FIXED
**Fix:** `fee > 0 && relayer != address(0)` silently skipped fee transfer when relayer=0. Changed to `if (fee > 0) { require(relayer != 0); transfer(); }`.
**Files:** `contracts/src/ShieldedPool.sol`

### P5: Exact USDC approval
**Status:** FIXED
**Fix:** `approve(MaxUint256)` replaced with `approve(amount)`. Limits USDC exposure if pool has vulnerability.
**Files:** `sdk/src/pool.ts`
