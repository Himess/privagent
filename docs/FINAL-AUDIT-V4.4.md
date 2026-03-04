# PrivAgent V4.4 — Final Comprehensive Audit Report

**Date:** 2026-03-03
**Scope:** Full codebase (contracts, circuits, SDK, docs, architecture)
**Commit:** Post-455c859 (full rebrand + deep audit fixes)

---

## Executive Summary

PrivAgent is a privacy-preserving x402 payment protocol built on Base Sepolia using ZK-UTXO architecture (Groth16 + Poseidon). The codebase demonstrates strong cryptographic design, comprehensive test coverage (195 tests), and multiple rounds of internal auditing (28+ findings already fixed). The protocol achieves its stated goal of hiding payment amounts, senders, and recipients on-chain.

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Solidity Contracts | 8.0/10 | 25% | 2.00 |
| ZK Circuits | 8.0/10 | 20% | 1.60 |
| SDK (TypeScript) | 7.0/10 | 25% | 1.75 |
| Documentation & Examples | 7.0/10 | 15% | 1.05 |
| Architecture & Design | 8.0/10 | 15% | 1.20 |
| **Overall** | **7.6/10** | | |

---

## 1. Solidity Contracts — 8.0/10

### What's Done Well
- Single entry point (`transact()`) simplifies attack surface
- Proper ReentrancyGuard + Pausable + Ownable from OpenZeppelin
- Custom errors for gas-efficient reverts
- Root history ring buffer (100 entries) for concurrent proof validity
- Circuit-enforced protocol fee — uncheatable by design
- Intra-batch nullifier duplicate check (both on-chain and in-circuit)
- Zero-address validation on constructor immutables
- Emergency withdrawal (only when paused, owner only)
- Comprehensive test coverage: 86 tests including fuzz + invariant testing (640K+ calls)

### Findings

#### HIGH

**H1 — Deposit Fee Accounting Mismatch (Pool Insolvency Risk)**
- **Location:** `ShieldedPoolV4.sol:237-246`
- **Description:** On deposit with fee, the contract does:
  ```
  transferFrom(sender, pool, depositAmount - protocolFee)
  transferFrom(sender, pool_treasury, protocolFee)
  ```
  But the circuit creates a UTXO of `amount - protocolFee` while `publicAmount = amount`. The pool receives `amount - fee` tokens but the Merkle tree contains a UTXO worth `amount - fee`. This is correct. However, on **withdrawal**, the pool sends `|publicAmount| + protocolFee` total USDC out. Over time, the protocolFee drain on private transfers (publicAmount=0) reduces the pool's real token balance while the UTXO tree balance stays the same.
- **Impact:** Pool insolvency after sufficient private transfer volume. Each private transfer deducts `protocolFee` from the pool but no new tokens enter.
- **Severity:** HIGH — however, the fee is small (0.01 USDC min) so insolvency would take very high volume.
- **Note:** The circuit enforces `sum(inputs) = sum(outputs) + protocolFee` for private transfers, so the UTXO-side accounting is correct. The issue is that pool's ERC20 balance must back all UTXOs, and private transfer fees drain it.

**H2 — No Field-Range Validation on Commitments/Nullifiers**
- **Location:** `ShieldedPoolV4.sol:229` (commitments), `ShieldedPoolV4.sol:183` (nullifiers)
- **Description:** Output commitments and input nullifiers are accepted as arbitrary `bytes32` values from the proof. While the ZK proof constrains these to be valid Poseidon hashes (which are < FIELD_SIZE), the contract does not independently verify `uint256(commitment) < FIELD_SIZE`.
- **Impact:** LOW in practice — the Groth16 verifier will reject proofs with out-of-range public signals. But an explicit check adds defense-in-depth.

#### MEDIUM

**M1 — Owner Can Brick the Pool via setVerifier**
- **Location:** `ShieldedPoolV4.sol:423-430`
- **Description:** Owner can set verifier to `address(0)` (removing a circuit) or replace it with a malicious verifier that always returns true. The `setVerifier` function allows `address(0)` explicitly.
- **Impact:** Centralization risk. Owner could disable withdrawals or allow fake proofs.
- **Recommendation:** Consider a timelock or multisig for verifier changes.

**M2 — Private Transfer Fee Drains Pool Balance**
- **Location:** `ShieldedPoolV4.sol:274-280`
- **Description:** Related to H1. For `publicAmount=0` (private transfer), the contract sends `protocolFee` USDC to treasury from the pool's balance. No new tokens enter the pool during a private transfer. The pool's ERC20 balance decreases by `protocolFee` each time.
- **Impact:** Pool balance decreases on every private transfer. If total private transfer fee outflow > total deposit inflow, pool becomes insolvent.

**M3 — MAX_DEPOSIT Not Enforced on Commitments**
- **Location:** `ShieldedPoolV4.sol:239`
- **Description:** MAX_DEPOSIT (1M USDC) is only checked on the `publicAmount` for deposits. A UTXO could theoretically hold more than MAX_DEPOSIT if created via multiple private transfers consolidated.
- **Impact:** LOW — the circuit has a 2^120 range check which is sufficient.

#### LOW

**L1 — StealthRegistry License Mismatch**
- **Location:** `StealthRegistry.sol:1`
- **Description:** StealthRegistry uses MIT license while ShieldedPoolV4 uses BUSL-1.1. Inconsistent licensing within the same project.

**L2 — Announcements Array Unbounded Growth**
- **Location:** `StealthRegistry.sol:36`
- **Description:** The `announcements` array grows unboundedly. No pruning mechanism. Could become very expensive to iterate off-chain over time.

**L3 — No Event for Verifier Changes**
- **Location:** `ShieldedPoolV4.sol:423`
- **Description:** `setVerifier()` doesn't emit an event when a verifier is changed or removed, making it harder to track admin actions.

**L4 — `isKnownRoot` O(100) Loop**
- **Location:** `ShieldedPoolV4.sol:409-413`
- **Description:** Linear scan over 100 slots. Constant gas cost but could be a simple mapping lookup for O(1).

**L5 — No `receive()` or `fallback()` — ETH Sent to Contract is Lost**
- **Description:** No way to recover accidentally sent ETH.

---

## 2. ZK Circuits — 8.5/10

### What's Done Well
- Clean Tornado Cash Nova-inspired JoinSplit architecture
- Correct balance conservation: `sum(inputs) + publicAmount === sum(outputs) + protocolFee`
- Amount range check (Num2Bits 120) prevents field overflow attacks
- Conditional root check via `ForceEqualIfEnabled` — elegant dummy input handling
- In-circuit duplicate nullifier check (H8 defense-in-depth)
- Protocol fee range check (Num2Bits 120) prevents fee manipulation
- extDataHash quadratic constraint prevents front-running
- Proper Poseidon usage (1-input for keypair, 3-input for commitment/nullifier)
- MerkleProofVerifier uses proper bit selection for left/right child

### Findings

#### MEDIUM

**M1 — Dummy Input Private Key is 0, Public Key is Poseidon(0)**
- **Location:** `joinSplit.circom:144`, `utxo.ts:112`
- **Description:** Dummy UTXOs always use `privateKey=0`. An attacker who knows this can compute the dummy's commitment if they know the blinding. Not exploitable because dummy UTXOs have `amount=0` and the root check is skipped for them, but the pattern is less than ideal.
- **Impact:** No direct exploit. Defense-in-depth concern.

**M2 — No Output Commitment Uniqueness Check**
- **Location:** `joinSplit.circom:168-182`
- **Description:** The circuit doesn't check that output commitments are unique. Two identical output commitments would create identical entries in the Merkle tree. In practice, the random blinding in `createUTXO()` makes collision astronomically unlikely.
- **Impact:** Negligible in practice due to Poseidon collision resistance + random blinding.

**M3 — Nullifier Derivation Omits Signature Layer (Deviation from Tornado Nova)**
- **Location:** `joinSplit.circom:54-66`
- **Description:** PrivAgent nullifier: `Poseidon(commitment, pathIndex, privateKey)`. Tornado Nova nullifier: `Poseidon(commitment, pathIndex, Signature)` where `Signature = Poseidon(privateKey, commitment, pathIndex)`. Nova adds an intermediate hash that provides better domain separation between the key's role in commitment derivation vs nullifier derivation. PrivAgent's `privateKey` appears directly in both `Keypair()` (Poseidon(1)) and `NullifierHasher()` (Poseidon(3)).
- **Impact:** Not exploitable today (Poseidon is believed secure), but reduces defense-in-depth. If Poseidon has any weakness in algebraic relations between outputs when shared inputs appear across multiple invocations, the direct key inclusion could be a problem.

**M4 — No Test Coverage for protocolFee in Circuit Tests**
- **Location:** `circuits/joinSplit.test.ts`
- **Description:** The `protocolFee` public signal (V4.4) is never tested — all tests use `protocolFee=0`. No test verifies that non-zero `protocolFee` correctly deducts from the balance equation, or that mismatched fees cause proof failure, or that `protocolFee >= 2^120` is rejected.
- **Impact:** The fee path in the circuit is completely untested.

#### LOW

**L1 — ForceEqualIfEnabled Not Defined in Circuit File**
- **Location:** `joinSplit.circom:141`
- **Description:** `ForceEqualIfEnabled` is used but not defined in the circuit files. It must come from circomlib but is not explicitly included. This works because circomlib provides it, but explicit import would be clearer.

**L2 — No 4x4 or 3x3 Circuit**
- **Description:** Only 1x2 and 2x2 circuits exist. Consolidation of 3+ UTXOs requires multiple transactions. Future optimization opportunity.

**L3 — Circuit Tests Use Depth 16, Production Uses Depth 20**
- **Description:** SDK tests compile and test circuits at depth 16 for speed, but production circuits are compiled at depth 20. The tests are not testing exactly what's deployed. Edge cases at depth 20 (larger pathElements arrays, different root computations) are untested.

#### INFO

**I1 — Constraint Counts (CEREMONY.md)**
- 1x2: 13,726 constraints — verified reasonable for BN254
- 2x2: 25,877 constraints — verified reasonable for BN254
- PTAU: powersOfTau28_hez_final_17 (2^17 = 131,072 max constraints) — sufficient

**I2 — Trusted Setup (C4 — Deferred)**
- Phase 1: Hermez PTAU (54 contributors) — trustworthy
- Phase 2: Single contributor (dev) — **NOT production-safe**
- Multi-party ceremony REQUIRED before mainnet

---

## 3. SDK (TypeScript) — 7.0/10

### What's Done Well
- Clean UTXO model with proper coin selection (exact match → smallest sufficient → accumulation)
- ECDH + AES-256-GCM note encryption with HKDF key derivation (domain-separated)
- secp256k1 Point validation on public keys (M4 fix)
- 30-second proof generation timeout (C5)
- On-chain TX verification before UTXO state update (C1/H3)
- Nullifier mutex in middleware (C2)
- SSRF protection in external relay (H4)
- Rate limiting with periodic cleanup (H5/H6)
- View tags for efficient note scanning
- NoteStore abstraction (memory + file backends)
- 109 tests across 15 suites

### Findings

#### HIGH

**H1 — Poseidon Private Key Exposed via Public Getter**
- **Location:** `shieldedWallet.ts:110-112`
- **Description:** `ShieldedWallet` exposes `get privateKey(): bigint` as a public getter. Any code with a reference to the wallet can read the Poseidon private key, which is the master secret controlling all UTXOs.
- **Impact:** Any dependency, middleware, or logging that accesses the wallet object can extract the private key.
- **Recommendation:** Remove the public getter. Provide only specific operations (sign, prove) that use the key internally.

**H2 — ECDH Private Key Not Zeroed After Use**
- **Location:** `zkExactSchemeV2.ts:52`, `noteEncryption.ts:36`
- **Description:** ECDH private keys (Uint8Array) are stored in class fields and never zeroed after use. JavaScript's garbage collector is non-deterministic — the key material persists in heap memory indefinitely.
- **Impact:** Memory forensics or heap dumps can extract key material long after it was "used."
- **Recommendation:** Zero out key buffers after use with `key.fill(0)`.

**H3 — Change UTXO Encrypted to Server (Privacy Leak)**
- **Location:** `zkExactSchemeV2.ts:157-158`
- **Description:** Both output UTXOs (payment + change) are encrypted using the server's ECDH public key:
  ```typescript
  const enc1 = encryptNote(paymentUTXO, this.ecdhPrivateKey, serverEcdhPubKey);
  const enc2 = encryptNote(changeUTXO, this.ecdhPrivateKey, serverEcdhPubKey);
  ```
  The change UTXO belongs to the BUYER, but it's encrypted so the SERVER can read it. The server now knows the buyer's exact remaining balance and change amount.
- **Impact:** CRITICAL privacy leak. Server learns buyer's exact balance after every payment. Breaks the fundamental privacy promise.
- **Recommendation:** Encrypt change UTXO to buyer's own ECDH public key, or use a dummy encryption.

**H2 — API Key Comparison is Timing-Unsafe**
- **Location:** `relayerServer.ts:82`
- **Description:** API key comparison uses `===` (string equality), which is vulnerable to timing side-channel attacks:
  ```typescript
  if (key !== config.apiKey) { ... }
  ```
- **Impact:** Attacker can brute-force API key character-by-character by measuring response times.
- **Recommendation:** Use `crypto.timingSafeEqual()` or `scmp` for constant-time comparison.

#### MEDIUM

**M1 — `require()` in ESM Module**
- **Location:** `relayerServer.ts:72`
- **Description:** Uses `require("express")` in an ESM codebase. This works in Node.js with `--experimental-require-module` but is fragile and may break in future Node.js versions or bundlers.
- **Impact:** Build/runtime issues in strict ESM environments.

**M2 — FileNoteStore Has No File Locking**
- **Location:** `noteStore.ts:121-126`
- **Description:** `FileNoteStore.persist()` does `fs.writeFile()` without file locking. Concurrent writes (multiple agents sharing a note file) could corrupt the JSON.
- **Impact:** Data loss in concurrent access scenarios.

**M3 — View Tag Uses Private Key Directly**
- **Location:** `viewTag.ts:21-26`
- **Description:** `generateViewTag(senderPrivKey, recipientPubKey)` hashes the sender's Poseidon private key directly. If a recipient correlates view tags across multiple transactions from the same sender, they can link payments (since same privKey + same recipientPubKey = same tag without nonce).
- **Impact:** Privacy degradation. The nonce parameter is optional and not always used (backward compat path at line 25 omits it).

**M4 — No Pool Address Validation in Middleware**
- **Location:** `middlewareV2.ts:70`
- **Description:** The middleware creates a contract instance with `config.poolAddress` but doesn't validate that it's a valid contract address (checksum, length, or on-chain code check).

**M5 — `toBytes32` Doesn't Validate Range**
- **Location:** `middlewareV2.ts:381-383`
- **Description:** `toBytes32(value)` uses `ethers.toBeHex(value)` which will throw for negative values but doesn't validate that the value is < FIELD_SIZE.

#### LOW

**L1 — Middleware Rate Limiter Not Configurable**
- **Location:** `middlewareV2.ts:23`
- **Description:** Rate limit in the middleware is hardcoded at 60 req/min, not configurable through `PrivAgentwallConfigV4`.

**L2 — No Request Body Size Limit on Relayer `/v1/relay`**
- **Location:** `relayerServer.ts:74`
- **Description:** Body parser limit is 100KB but no additional validation on individual field sizes within the request body.

**L3 — `syncTreeFromEvents` Doesn't Handle Reorgs**
- **Location:** `treeSync.ts:29-66`
- **Description:** Events are queried sequentially with no reorg protection. If a chain reorg occurs during sync, the tree state could be incorrect.
- **Impact:** Incorrect Merkle tree → proof generation will fail (fail-safe, not exploitable).

**L4 — Hardcoded USDC Address in types.ts**
- **Location:** `types.ts:13`
- **Description:** `BASE_SEPOLIA_USDC` is hardcoded. Mainnet deployment will need a different address.

**L5 — Dummy Encrypted Output in Deposit/Transfer**
- **Location:** `shieldedWallet.ts:209-210`
- **Description:** Deposits use `new Uint8Array([0xaa])` and `[0xbb]` as encrypted outputs. These are placeholder bytes, not actual encryption. This is fine for deposits (no need to encrypt a known-amount public deposit) but stands out as a pattern break.

---

## 4. Documentation & Examples — 7.5/10

### What's Done Well
- Comprehensive README with architecture diagram, quick start, and contract addresses
- LIGHTPAPER.md is investor/jury-ready with market stats and revenue model
- PROTOCOL.md covers the full x402+ZK flow
- CIRCUITS.md explains constraint counts and public signal ordering
- CEREMONY.md documents trusted setup process
- POI-ROADMAP.md shows compliance thinking
- 5 integration examples (Virtuals, ElizaOS, Express, Basic Transfer, ERC-8004)
- License table clearly explains BUSL-1.1 usage rights
- BUSL-1.1 copyright headers on all source files

### Findings

#### MEDIUM

**M1 — README Code Examples May Not Compile**
- **Location:** `README.md:89-105`
- **Description:** The middleware example shows `privAgentPaywallV4` with `usdcAddress` parameter, but the actual `PrivAgentwallConfigV4` interface doesn't have a `usdcAddress` field (it has `poolAddress`, `signer`, `poseidonPubkey`, `ecdhPrivateKey`, `ecdhPublicKey`). The example would not compile.
- **Impact:** Developers following the README will hit compile errors immediately.

**M2 — Test Count in README (111 vs 86 Foundry)**
- **Location:** `README.md:143`
- **Description:** README says "Foundry tests (111 tests)" in the project structure section but the actual count is 111 including StealthRegistry tests. The earlier section says "86 Foundry" in the badge. Inconsistent numbers.

**M3 — Missing Demo Video**
- **Description:** No demo video exists. For Base Batches S3 submission, a demo video would significantly strengthen the application.

#### LOW

**L1 — `security@privagent.xyz` Email Not Verified**
- **Location:** `README.md:246`
- **Description:** Security contact email listed but unclear if the domain/email is set up.

**L2 — V3 Legacy Types Still in types.ts**
- **Location:** `types.ts:84-174`
- **Description:** V2/V3 types (`ZkPaymentRequirements`, `ZkExactPayload`, `V2PaymentPayload`, `PrivAgentwallConfig`, etc.) are still in the types file alongside V4 types. These are unused by the current V4 system and add confusion.

**L3 — AUDIT.md vs DEEP-AUDIT-V4.4.md**
- **Description:** Two audit files exist. AUDIT.md covers V3+V4, DEEP-AUDIT-V4.4.md covers V4.4 specifically. Consolidation would reduce confusion.

#### CRITICAL (Rebrand)

**C1 — LICENSE File Still References "GhostPay"**
- **Location:** `LICENSE:9-11,38`
- **Description:** The BUSL-1.1 LICENSE file still contains:
  - `Licensor: GhostPay Contributors` (should be PrivAgent)
  - `Licensed Work: GhostPay V4` (should be PrivAgent V4)
  - `license@ghostpay.xyz` (should be `license@privagent.xyz`)
- **Impact:** Legal document contradicts the README and all source file headers. This is the one file where naming matters most.

#### HIGH (Docs)

**H1 — Stale V4.3 Pool Addresses in 5+ Files**
- **Location:** `demo/agent-buyer-v4.ts:37`, `demo/agent-seller-v4.ts:27`, `examples/express-server/README.md:25`, `examples/erc8004-integration/README.md:20`, `examples/virtuals-integration/README.md:26`
- **Description:** These files default to the old V4.3 pool address (`0x17B6...`) instead of V4.4 (`0x8F1ae...`).

**H2 — CIRCUITS.md Constraint Counts Are Wrong**
- **Location:** `docs/CIRCUITS.md:83-84`
- **Description:** States ~5,900 NL constraints for 1x2 and ~11,000 for 2x2. Actual R1CS counts are 13,726 (1x2) and 25,877 (2x2) — roughly double what's documented.

**H3 — Virtuals README Uses Wrong API Signature**
- **Location:** `examples/virtuals-integration/README.md:15,36`
- **Description:** Shows `privAgentFetchV4(url, wallet)` but the actual export is `createPrivAgentFetchV4(wallet, ecdhPrivKey, ecdhPubKey)`. Also shows wrong `ShieldedWallet` constructor params.

**H4 — run-demo.sh References V3 Scripts**
- **Location:** `demo/run-demo.sh:28,36`
- **Description:** References `agent-seller.ts` and `agent-buyer.ts` (V3) instead of V4 files. Script is broken.

**H5 — Demo Says "Deposit amount: HIDDEN" — Actually PUBLIC**
- **Location:** `demo/agent-privacy-demo.ts:317`
- **Description:** The visibility analysis table claims deposit amounts are hidden. They are PUBLIC — `transferFrom` is visible on-chain. Contradicts the protocol's actual privacy model.

---

## 5. Architecture & Design — 8.0/10

### What's Done Well
- **Sound Protocol Design:** JoinSplit UTXO model is battle-tested (Tornado Nova, Railgun). Balance conservation is mathematically enforced by the circuit.
- **Layered Security:** Circuit-level enforcement + on-chain verification + off-chain validation (triple check).
- **x402 Integration:** Natural fit — 402 → proof → payment header → relay → 200. Clean HTTP flow.
- **Server-as-Relayer Model:** Buyers don't need ETH. Server pays gas and recoups via relayer fee. Good UX.
- **Extensible Circuit System:** `verifiers[configKey]` mapping allows adding new circuits without redeploying the pool.
- **View Tags:** Elegant 1-byte optimization for note scanning. 50x speedup with minimal privacy cost.
- **Protocol Fee at Circuit Level:** Uncheatable revenue model. Novel approach vs typical on-chain-only fees.
- **BUSL-1.1 License:** Appropriate for a protocol with commercial ambitions.

### Findings

#### HIGH

**H1 — Trusted Setup Not Production-Ready (C4)**
- **Description:** Phase 2 of the Groth16 trusted setup has a single contributor (developer). The toxic waste from this ceremony could allow proof forgery — creating valid proofs for invalid statements (e.g., spending UTXOs that don't exist).
- **Impact:** CRITICAL for mainnet. An attacker with the toxic waste can drain the entire pool.
- **Status:** Acknowledged and deferred. Multi-party ceremony planned for V4.5.

#### MEDIUM

**M1 — Single-Chain Design**
- **Description:** Currently Base Sepolia only. No cross-chain bridge or multi-chain support. Unlike MixVM which has LayerZero + CCTP, PrivAgent is single-chain.
- **Impact:** Limited market reach. Cross-chain privacy is a differentiator.

**M2 — USDC-Only Token Support**
- **Description:** Pool only supports USDC (hardcoded ERC20). No multi-token support.
- **Impact:** Limits use cases. Most privacy pools (Railgun, Tornado Nova) support multiple tokens.

**M3 — Owner Centralization**
- **Description:** Pool owner can: pause the pool, change verifiers, set treasury, set fee parameters, emergency withdraw all funds. No timelock, multisig, or governance.
- **Impact:** Users must trust the owner. Rug pull possible via pause + emergency withdraw.

**M4 — Gas Costs Not Optimized**
- **Description:** Groth16 verification on-chain costs ~300K gas per proof. Combined with Merkle tree insert (~150K) and token transfers, total gas per transaction is ~850K-1M. At $0.01/unit on Base, this is ~$0.008-0.01 per TX — acceptable but 10x more than a simple ERC20 transfer.

**M5 — Proof Generation Time**
- **Description:** Browser-based proof generation for the 2x2 circuit (~25K constraints) takes 5-15 seconds depending on device. This is acceptable for API payments but poor for real-time interactions.

**M6 — Server Knows Payment Amount (Design Limitation)**
- **Description:** The middleware must decrypt the encrypted note to verify `amount >= price`. The server therefore knows the exact payment amount. This is inherent to the server-as-relayer model. Privacy is NOT complete against the payment recipient.
- **Impact:** For agent-to-API payments this is arguably acceptable (the API server knows you're paying), but it's a real limitation compared to Railgun where recipients can receive without knowing the sender.

**M7 — Off-Chain Proof Verification Should Be Mandatory**
- **Location:** `middlewareV2.ts:272-312`
- **Description:** The middleware's `verificationKeys` config is optional. If not provided, no off-chain snarkjs proof verification happens before the on-chain TX submission. This makes the server vulnerable to gas griefing — anyone can submit invalid proofs that cost the server gas.
- **Impact:** DoS via gas drain. Server pays gas for every invalid proof submitted.
- **Recommendation:** Make `verificationKeys` required in `PrivAgentwallConfigV4`. Reject construction without them.

**M8 — FileNoteStore Stores Secrets in Plaintext**
- **Location:** `noteStore.ts:121-126`
- **Description:** `FileNoteStore.persist()` writes UTXO data (amounts, blinding factors, commitments) as plaintext JSON to disk. For an agent with a persistent wallet, this is a data breach risk. Anyone with filesystem access can read the agent's entire transaction history and balances.
- **Recommendation:** Encrypt the file at rest using AES-256-GCM with a key derived from the wallet's private key.

#### LOW

**L1 — No Compliance Mechanism Yet**
- **Description:** POI (Proof of Innocence) is planned but not implemented. Without it, the pool cannot distinguish clean funds from sanctioned funds. Regulatory risk.

**L2 — Metadata Leaks**
- **Description:** Transaction timing, gas price, and the number of nullifiers/commitments (1x2 vs 2x2) are public. These metadata can be used for statistical analysis:
  - 1x2 = likely deposit or single-input transfer
  - 2x2 = consolidation or multi-input payment
  - Timing correlation between deposits and withdrawals

**L3 — No Formal Verification**
- **Description:** Neither the Solidity contracts nor the Circom circuits have been formally verified. For a protocol handling real funds, formal verification of the balance conservation invariant would be valuable.

---

## Summary of All Findings

| Severity | Contracts | Circuits | SDK | Docs | Architecture | Total |
|----------|-----------|----------|-----|------|--------------|-------|
| CRITICAL | 0 | 0 | 0 | 1 | 0 | **1** |
| HIGH | 1 | 0 | 2 | 5 | 1 | **9** |
| MEDIUM | 3 | 4 | 5 | 3 | 8 | **23** |
| LOW | 5 | 3 | 5 | 3 | 3 | **19** |
| INFO | 0 | 2 | 0 | 0 | 0 | **2** |
| **Total** | 9 | 9 | 12 | 12 | 12 | **54** |

---

## Priority Action Items (Pre-Mainnet)

### Must Fix (Blockers)
1. **Multi-party trusted setup ceremony** (Architecture H1) — without this, the entire pool can be drained
2. **Change UTXO privacy leak** (SDK H1) — encrypt change note to buyer, not server
3. **Timing-safe API key comparison** (SDK H2) — use `crypto.timingSafeEqual()`
4. **LICENSE file rebrand** (Docs C1) — still says "GhostPay" in 4 places, legal document must match

### Should Fix (Important)
4. **Deposit fee accounting audit** (Contracts H1) — verify pool solvency math with a formal model
5. **Make off-chain proof verification mandatory** (Architecture M7) — prevent gas griefing
6. **Owner centralization** (Architecture M3) — add timelock or multisig
7. **Encrypt FileNoteStore at rest** (Architecture M8) — AES-256-GCM with wallet-derived key
8. **README code examples** (Docs M1) — make them compile
9. **View tag nonce enforcement** (SDK M3) — always require nonce, remove backward compat path
10. **Remove V3 legacy types** (Docs L2) — clean up types.ts

### Nice to Have
11. Field-range validation on commitments (Contracts H2)
12. Verifier change event (Contracts L3)
13. FileNoteStore file locking (SDK M2)
14. ESM-compatible express import (SDK M1)
15. Circuit tests at depth 20 (Circuits L3)
16. Demo video for Base Batches S3

---

## Comparison with Established Protocols

| Feature | PrivAgent V4.4 | Tornado Nova | Railgun V3 |
|---------|---------------|--------------|------------|
| UTXO Model | JoinSplit (1x2, 2x2) | JoinSplit (16x2) | JoinSplit (13x13) |
| Hash Function | Poseidon | Poseidon | Poseidon |
| Nullifier Derivation | Direct (no Signature layer) | Signature intermediate hash | Signature intermediate hash |
| Proof System | Groth16 | Groth16 | Groth16 |
| Tree Depth | 20 (1M leaves) | 23 (8M leaves) | 16 (64K leaves) |
| Tokens | USDC only | ETH + ERC20 | Multi-token |
| Compliance | Planned (POI) | None | POI (live) |
| Protocol Fee | Circuit-enforced | None | 0.25% |
| View Tags | Yes (Poseidon) | No | Yes (Poseidon) |
| x402 Integration | Native | No | No |
| Chains | Base Sepolia | Ethereum | Multi-chain |
| Trusted Setup | Dev-only (NOT SAFE) | MPC ceremony | MPC ceremony |
| Note Encryption | ECDH + AES-256-GCM | ECDH + ChaCha20 | ECDH + XChaCha20 |
| Audit Status | Internal (3 rounds) | Trail of Bits | Multiple firms |

---

## Verdict

PrivAgent V4.4 is a **solid testnet-ready protocol** with strong cryptographic foundations and comprehensive test coverage. The x402 integration is novel and well-executed. The codebase shows evidence of multiple audit rounds with 28+ findings already fixed.

**NOT mainnet-ready** due to:
1. Single-contributor trusted setup (critical)
2. Change UTXO privacy leak (high)
3. Owner centralization (no timelock/multisig)
4. No professional external audit

**Recommended path to mainnet:**
1. Fix SDK H1 (change UTXO encryption) — 1 day
2. Fix SDK H2 (timing-safe comparison) — 1 hour
3. Multi-party trusted setup ceremony — 1-2 weeks
4. Professional audit (Trail of Bits, OpenZeppelin, etc.) — 4-8 weeks
5. Add timelock/multisig for admin functions — 1 week
6. Formal verification of balance conservation — 2-4 weeks

**Overall Score: 7.6/10** — Strong for testnet, needs ceremony + external audit for mainnet.
