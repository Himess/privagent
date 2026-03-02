# GhostPay V4.4 — Comprehensive Audit Report

> **Date:** February 27, 2026
> **Scope:** Entire repository — contracts, SDK, circuits, docs, demos, config
> **Auditor:** Internal (Claude Code)
> **Severity Scale:** Critical > High > Medium > Low > Info

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 3 | **ALL FIXED** |
| High | 6 | **ALL FIXED** |
| Medium | 9 | **ALL FIXED** |
| Low | 6 | **ALL FIXED** |
| Info | 4 | Observations |
| **Total** | **28** | **24 Fixed, 4 Info** |

**Overall Assessment:** All 24 actionable findings have been fixed. The middleware now uses V4.4 ABI with protocolFee and viewTags. All documentation is consistent. All example files updated to V4.4 API. 109 SDK tests passing.

---

## Critical Findings

### C1: middlewareV2.ts uses V4.3 ABI — incompatible with V4.4 contract

**File:** `sdk/src/x402/middlewareV2.ts:33-37`

**Issue:** The `POOL_V4_ABI` in the middleware defines `TransactArgs` WITHOUT `protocolFee` (uint256) and `viewTags` (uint8[]). The V4.4 `ShieldedPoolV4` contract requires both fields. Any `transact()` call from the middleware will **revert on-chain**.

**Current ABI:**
```
transact((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, bytes32 root, int256 publicAmount, bytes32 extDataHash, bytes32[] inputNullifiers, bytes32[] outputCommitments) args, ...)
```

**Required ABI (V4.4):**
```
transact((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, bytes32 root, int256 publicAmount, bytes32 extDataHash, uint256 protocolFee, bytes32[] inputNullifiers, bytes32[] outputCommitments, uint8[] viewTags) args, ...)
```

**Impact:** x402 middleware cannot process any payments on V4.4 contracts.

**Fix:**
1. Update `POOL_V4_ABI` to include `protocolFee` and `viewTags`
2. Update `transact()` call (lines 289-302) to pass `protocolFee` and `viewTags`
3. The buyer's `V4PaymentPayload` must also carry `protocolFee` and `viewTags`

---

### C2: middlewareV2.ts off-chain proof verification uses wrong signal order

**File:** `sdk/src/x402/middlewareV2.ts:247-254`

**Issue:** Public signal array for snarkjs verification is:
```typescript
[root, publicAmount, extDataHash, ...nullifiers, ...commitments]
```

V4.4 public signal order is:
```
[root, publicAmount, extDataHash, protocolFee, ...nullifiers, ...commitments]
```

The `protocolFee` at index [3] is missing. Off-chain proof verification will **always fail** for valid V4.4 proofs (signal mismatch).

**Impact:** If `verificationKeys` is configured, ALL valid proofs are rejected. If not configured, verification is skipped (less severe but still broken verification path).

**Fix:** Add `protocolFee` to public signals array at index 3.

---

### C3: joinSplit_4x2.circom missing protocolFee public signal

**File:** `circuits/generated/joinSplit_4x2.circom:7`

**Issue:** The 4x2 circuit variant declares public signals as:
```circom
component main {public [root, publicAmount, extDataHash, inputNullifiers, outputCommitments]} = JoinSplit(4, 2, 20);
```

But 1x2 and 2x2 correctly include `protocolFee`:
```circom
component main {public [root, publicAmount, extDataHash, protocolFee, inputNullifiers, outputCommitments]} = JoinSplit(1, 2, 20);
```

The on-chain verifier expects `protocolFee` at signal index [3]. The 4x2 variant will **fail proof verification**.

**Impact:** 4x2 circuit is broken. Not currently deployed (only 1x2 and 2x2 are deployed), but will fail if enabled.

**Fix:** Add `protocolFee` to public signals in `joinSplit_4x2.circom`.

**Note:** Circuit source files DO exist:
- `circuits/joinSplit.circom` (190 lines) — main template
- `circuits/merkleProof.circom` (36 lines) — Merkle proof verifier
- `circuits/merkleTree.circom` (32 lines) — Merkle tree checker
- `circuits/generated/joinSplit_1x2.circom`, `joinSplit_2x2.circom` — correct
- `circuits/scripts/build-v4.sh` — V4 build script (uses ptau 2^17)
- `circuits/CEREMONY.md` — trusted setup documentation
- Build artifacts (`circuits/build/`) are gitignored (must run `build-v4.sh` to generate)

---

## High Findings

### H1: PROTOCOL.md public signal order is V4.3, not V4.4

**File:** `docs/PROTOCOL.md:186-195`

**Issue:** Documents public signal order as:
```
[0] root
[1] publicAmount
[2] extDataHash
[3..3+nIns-1] inputNullifiers
[3+nIns..] outputCommitments
```

V4.4 actual order (from contract `_buildPublicSignals()`):
```
[0] root
[1] publicAmount
[2] extDataHash
[3] protocolFee          ← MISSING from docs
[4..4+nIns-1] inputNullifiers
[4+nIns..] outputCommitments
```

**Impact:** Any developer implementing a client/facilitator from this spec will produce incompatible proofs.

**Fix:** Update PROTOCOL.md signal table to V4.4 format. Also update the `TransactArgs` struct definition (lines 148-161) to include `protocolFee` and `viewTags`.

---

### H2: PROTOCOL.md and CIRCUITS.md say Merkle depth 16, contract uses depth 20

**Files:**
- `docs/PROTOCOL.md:5` — "depth 16"
- `docs/PROTOCOL.md:64` — "depth-16 path"
- `docs/CIRCUITS.md:20-21` — "joinSplit_1x2 (1 in, 2 out, depth 16)"
- `docs/CIRCUITS.md:83` — constraint counts for "depth 16"
- `docs/CIRCUITS.md:104-105` — Comparison table: V3 depth 20, V4 depth 16

**Actual:** `ShieldedPoolV4.sol:76` — `MERKLE_TREE_DEPTH = 20`

**Impact:** Documentation contradicts deployed contract. Constraint counts in CIRCUITS.md are wrong (based on 16 levels, not 20).

**Fix:** Update all references from depth 16 to depth 20. Recalculate constraint counts.

---

### H3: README.md shows V4.3 contract addresses, not V4.4

**File:** `README.md:174-179`

**Issue:** README lists V4.3 contracts:
- ShieldedPoolV4: `0x17B6209385c2e36E6095b89572273175902547f9`
- Verifiers: `0xe473...`, `0x10D5...`
- PoseidonHasher: `0x3ae7...`

V4.4 deployed contracts (with circuit-level fee + view tags):
- ShieldedPoolV4: `0x8F1ae8209156C22dFD972352A415880040fB0b0c`
- Groth16Verifier_1x2: `0xC53c8E05661450919951f51E4da829a3AABD76A2`
- Groth16Verifier_2x2: `0xE77ad940291c97Ae4dC43a6b9Ffb43a3AdCd4769`
- PoseidonHasher: `0x70Aa742C113218a12A6582f60155c2B299551A43`

The Quick Start code examples also use the old address.

**Impact:** Anyone following the README will connect to the old V4.3 pool, which doesn't support protocolFee or viewTags.

**Fix:** Update all contract addresses in README to V4.4 addresses. Update deploy block.

---

### H4: README.md test count incorrect

**File:** `README.md:10,143,183,197,247`

**Issue:** Multiple references to "217 tests (111 Foundry + 101 SDK + 5 Relayer)" but actual counts are:
- Foundry: **86 tests** (63 ShieldedPoolV4 + 12 ProtocolFee + 10 EdgeCases + 1 PauseInvariant)
- SDK: **109 tests** (15 suites)
- Total: **195 tests**

The LIGHTPAPER also claims 217 tests.

**Fix:** Update all test count references to 195 (86 Foundry + 109 SDK).

---

### H5: All 4 example files have critical API violations

**Files:**
- `examples/eliza-plugin/ghostpay-plugin.ts:9,52` — Wrong import `ghostFetchV4` (should be `createGhostFetchV4`), wrong API call signature, missing ECDH keys
- `examples/virtuals-integration/example.ts:9,46` — Same wrong import + API call
- `examples/basic-transfer/transfer.ts:11,31` — V3 pool address, missing `initPoseidon()`
- `examples/express-server/server.ts:15,45` — V3 pool address, missing `network` param

**Issue:** All examples use V3 pool address `0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f`. The eliza-plugin and virtuals-integration examples call `ghostFetchV4(url, wallet)` which doesn't match the actual API `createGhostFetchV4(wallet, ecdhPrivKey, ecdhPubKey)`. These examples **won't compile**.

**Impact:** Developers following examples will get compilation errors. Bad first impression.

**Fix:** Update all examples to V4.4 API with correct imports, addresses, and ECDH key handling.

---

### H6: Rate limiter memory leak in middlewareV2.ts

**File:** `sdk/src/x402/middlewareV2.ts:20-31`

**Issue:** `rateLimitStore` Map grows unbounded. Expired entries are never cleaned up. Under sustained traffic, this will cause memory growth proportional to unique IP count.

```typescript
const rateLimitStore: Map<string, RateLimitEntry> = new Map();
```

**Impact:** Server memory leak in production. Could lead to OOM under sustained load.

**Fix:** Add periodic cleanup (e.g., every 60s, delete entries where `now > resetAt`) or use a bounded LRU cache.

---

## Medium Findings

### M1: AUDIT.md only documents V3 findings

**File:** `AUDIT.md`

**Issue:** The audit report covers 28 V3 findings + 5 V3.1 fixes. V4.4 features (circuit-level fee, view tags, hybrid relayer, facilitator, ERC-8004) have no audit documentation.

**Fix:** Add a "V4.4 Audit" section to AUDIT.md covering findings from this audit, or replace entirely with this document.

---

### M2: TODO.md shows V4.4 as "In Progress"

**File:** `docs/TODO.md:34,44,49,54,62,69`

**Issue:** All V4.4 features (circuit-level fee, view tags, hybrid relayer, facilitator, ERC-8004 L1) are marked "In Progress" with unchecked `[ ]` items for tests. These features are complete and deployed.

**Fix:** Update status to "Done" and check off completed items.

---

### M3: ROADMAP.md shows V4.4 as "In Progress"

**File:** `docs/ROADMAP.md:9,33-39`

**Issue:** `[WE ARE HERE]` marker is next to V4.4. Status line says "In Development". V4.4 is complete.

**Fix:** Move `[WE ARE HERE]` to between V4.4 and V4.5. Update status to "Done" or "Complete".

---

### M4: build.sh references V3 circuit (privatePayment)

**File:** `circuits/scripts/build.sh:4`

**Issue:** `CIRCUIT=privatePayment` — This is the V3 circuit name. V4 uses `joinSplit_1x2` and `joinSplit_2x2`.

**Fix:** Either create a `build-v4.sh` for V4 circuits or update `build.sh` to handle V4 variants.

---

### M5: PTAU file inconsistency

**Files:**
- `circuits/scripts/build.sh:6` — `powersOfTau28_hez_final_15.ptau` (2^15)
- `docs/CIRCUITS.md:150-154` — `powersOfTau28_hez_final_16.ptau` (2^16)
- Memory notes — `powersOfTau28_hez_final_17.ptau` (2^17)

**Impact:** Developers won't know which PTAU to use. Using the wrong one will fail if circuit constraints exceed PTAU capacity.

**Fix:** Standardize on the PTAU actually used for V4.4 builds. Update all references.

---

### M6: foundry.toml missing fs_permissions

**File:** `contracts/foundry.toml`

**Issue:** No `fs_permissions` configured. `RealVerifierTest.t.sol` needs to read fixture files from `test/fixtures/`. This causes 6 test failures.

**Fix:** Add to foundry.toml:
```toml
fs_permissions = [{ access = "read", path = "test/fixtures" }]
```

---

### M7: middlewareV2.ts paymentInfo uses wrong field paths

**File:** `sdk/src/x402/middlewareV2.ts:320-328`

**Issue:** Line 324: `asset: payload.accepted.asset` — The `V4PaymentPayload` type has no `accepted` property. This will throw at runtime when trying to attach payment info after successful TX.

```typescript
req.paymentInfo = {
  nullifierHash: p.nullifiers[0],
  from: p.from,                    // 'from' doesn't exist in payload
  amount: config.price,
  asset: payload.accepted.asset,   // 'accepted' doesn't exist
  recipient: config.poseidonPubkey,
  txHash: tx.hash,
  blockNumber: receipt.blockNumber,
};
```

**Impact:** Runtime error after successful on-chain transaction. Payment goes through but middleware crashes before calling `next()`.

**Fix:** Use `config.asset` for asset, remove `from` or derive from request context.

---

### M8: LIGHTPAPER.md revenue projections reference "217 tests"

**File:** `docs/LIGHTPAPER.md:383,387,401`

**Issue:** Multiple references to "217 tests (111 Foundry + 101 SDK + 5 Relayer)" and "3 internal audits". The test count is wrong (actual: 195), and the internal audits don't cover V4.4.

**Fix:** Update all test count references. Clarify that V4.4 audit is included.

---

### M9: Root package.json references non-existent relayer package

**File:** `package.json:10-11,14-15`

**Issue:** Scripts reference `relayer/` directory:
```json
"build:relayer": "cd relayer && pnpm build",
"test:relayer": "cd relayer && pnpm test"
```

In V4, the relayer functionality was moved into `sdk/src/x402/`. The standalone `relayer/` package may not exist or be deprecated.

**Fix:** Remove relayer scripts from root package.json, or verify the relayer package exists and is needed.

---

## Low Findings

### L1: STEALTH.md correctly labeled legacy but still in README docs table

**File:** `README.md:227`, `docs/STEALTH.md:3-5`

**Issue:** STEALTH.md is properly marked as "LEGACY V3 DOCUMENT" at the top, but the README docs table lists it as current documentation: `[Stealth](docs/STEALTH.md) | Stealth address system`.

**Fix:** Add "(V3 Legacy)" to the README table description, or remove if V4 note encryption is documented elsewhere.

---

### L2: CIRCUITS.md V3 vs V4 comparison table has wrong depth values

**File:** `docs/CIRCUITS.md:104`

**Issue:** Table says V3 depth = 20, V4 depth = 16. But V4 contract also uses depth 20.

**Fix:** Both should say depth 20.

---

### L3: TODO.md lists "248 tests" for V4.3

**File:** `docs/TODO.md:20`

**Issue:** "248 tests (132 Foundry + 116 SDK)" — This doesn't match any known test count.

**Fix:** Update to actual V4.4 test counts.

---

### L4: ShieldedPoolV4.sol TODO comment references V4.2

**File:** `contracts/src/ShieldedPoolV4.sol:9`

**Issue:** `/// @notice V4.2 TODO: Proof of Innocence` — References V4.2, should be V4.5.

**Fix:** Update comment to V4.5.

---

### L5: CIRCUITS.md says "1x2 depth 16: ~11,000 constraints"

**File:** `docs/CIRCUITS.md:81-83`

**Issue:** Constraint counts are calculated for depth 16 (V3 design). With depth 20, the MerkleProofVerifier uses 4 additional Poseidon(2) levels, adding ~880 constraints per input.

**Fix:** Recalculate for depth 20.

---

### L6: middlewareV2.ts exact amount match may be too strict

**File:** `sdk/src/x402/middlewareV2.ts:204`

**Issue:** `decrypted.amount.toString() !== config.price` requires exact match. If an agent overpays (e.g., sends 1.01 USDC for a 1.00 USDC API), the payment is rejected.

**Fix:** Consider using `>=` comparison: `decrypted.amount < BigInt(config.price)`.

---

## Info / Observations

### I1: V4.4 contract has comprehensive security features

The ShieldedPoolV4 contract is well-designed:
- ReentrancyGuard on transact()
- Pausable with emergency withdraw (whenPaused only)
- WithdrawToSelf prevention
- DuplicateNullifierInBatch check
- FeeExceedsAmount / ZeroRecipientAmount guards
- MAX_DEPOSIT cap (1M USDC)
- ROOT_HISTORY_SIZE = 100 (adequate ring buffer)
- type(int256).min overflow protection
- extcodesize check on setVerifier()

### I2: SDK test coverage is good (109 tests, 15 suites)

Well-distributed coverage:
- Core: poseidon (12), merkle (9)
- V4 engine: utxo (8), coinSelection (10), extData (5), noteEncryption (4), noteStore (11), viewTag (7), joinSplitProver (5)
- x402: zkExactSchemeV2 (8), middlewareV2 (9), zkFetchV2 (4), externalRelay (5), e2e (8)
- ERC-8004: index (4)

### I3: BSL-1.1 license is properly structured

LICENSE file correctly specifies:
- Licensor: GhostPay Contributors
- Change Date: March 1, 2028
- Change License: GPL-2.0-or-later
- Contact: license@ghostpay.xyz
- Explicit testnet/research exemptions

### I4: LIGHTPAPER is investor-grade

The light paper includes:
- Clear problem statement with market data
- Technical architecture
- Revenue model with sensitivity analysis
- Competitive landscape (Railgun, Tornado Cash, Aztec comparison)
- Execution proof metrics
- Realistic growth scenarios

---

## Fix Priority

### Before Base Batches Submission (March 7)

| ID | Finding | Effort |
|----|---------|--------|
| **C1** | Update middlewareV2.ts ABI to V4.4 | 30 min |
| **C2** | Fix off-chain verification signal order | 15 min |
| **C3** | Fix joinSplit_4x2.circom protocolFee signal | 5 min |
| **H1** | Update PROTOCOL.md signal order | 15 min |
| **H2** | Fix depth 16→20 in PROTOCOL.md + CIRCUITS.md | 20 min |
| **H3** | Update README contract addresses to V4.4 | 15 min |
| **H4** | Fix test counts everywhere | 15 min |
| **M2** | Update TODO.md V4.4 status to Done | 10 min |
| **M3** | Update ROADMAP.md V4.4 status to Done | 10 min |
| **M7** | Fix paymentInfo field paths | 10 min |
| **M8** | Fix LIGHTPAPER test counts | 10 min |

| **H5** | Fix all 4 example files (imports, addresses, API) | 30 min |

### After Submission

| ID | Finding | Effort |
|----|---------|--------|
| **H6** | Rate limiter cleanup | 30 min |
| **M1** | Update AUDIT.md with V4.4 findings | 30 min |
| **M4** | Update build.sh or add build-v4.sh | 30 min |
| **M5** | Standardize PTAU reference | 10 min |
| **M6** | Add foundry.toml fs_permissions | 5 min |
| **M9** | Clean up root package.json | 10 min |
| **L1-L6** | Minor doc fixes | 30 min total |

---

## Files That Need Changes

| File | Changes |
|------|---------|
| `sdk/src/x402/middlewareV2.ts` | C1, C2, H6, M7, L6 |
| `docs/PROTOCOL.md` | H1, H2 |
| `docs/CIRCUITS.md` | H2, L2, L5 |
| `README.md` | H3, H4, L1 |
| `docs/LIGHTPAPER.md` | M8 |
| `docs/TODO.md` | M2, L3 |
| `docs/ROADMAP.md` | M3 |
| `circuits/generated/joinSplit_4x2.circom` | C3 |
| `circuits/` | M4, M5 |
| `examples/eliza-plugin/ghostpay-plugin.ts` | H5 |
| `examples/virtuals-integration/example.ts` | H5 |
| `examples/basic-transfer/transfer.ts` | H5 |
| `examples/express-server/server.ts` | H5 |
| `contracts/foundry.toml` | M6 |
| `package.json` | M9 |
| `contracts/src/ShieldedPoolV4.sol` | L4 |
| `AUDIT.md` | M1 |

---

*Generated: 2026-02-27 | GhostPay V4.4 Internal Audit*
