# GhostPay V4 — Railgun Privacy Model Research Report

> Deep technical analysis of Railgun's privacy architecture for GhostPay V4 design.
> Covers circuits, contracts, SDK, UTXO model, Base feasibility, alternatives, and implementation plan.

---

## Table of Contents

1. [Railgun Codebase Analysis](#1-railgun-codebase-analysis)
2. [Circuit Constraint Details & Benchmarks](#2-circuit-constraint-details--benchmarks)
3. [UTXO Model Specification](#3-utxo-model-specification)
4. [Range Proof Implementation Options](#4-range-proof-implementation-options)
5. [GhostPay V4 Architecture Proposal](#5-ghostpay-v4-architecture-proposal)
6. [Base Feasibility Analysis](#6-base-feasibility-analysis)
7. [x402 + UTXO Wire Format Proposal](#7-x402--utxo-wire-format-proposal)
8. [Implementation Timeline & Effort Estimate](#8-implementation-timeline--effort-estimate)
9. [Risk Analysis](#9-risk-analysis)
10. [References](#10-references)

---

## 1. Railgun Codebase Analysis

### 1.1 Repository Map

Railgun's code is split across two GitHub organizations:

| Repo | Org | Purpose |
|------|-----|---------|
| `circuits-v2` | Railgun-Privacy | Circom 2.0.6 JoinSplit circuits |
| `circuits-ppoi` | Railgun-Privacy | Private Proof of Innocence circuits |
| `contract` | Railgun-Privacy | Solidity contracts (V1/V2/V3) |
| `engine` | Railgun-Community | TypeScript SDK (wallet, prover, tree sync) |
| `shared-models` | Railgun-Community | Network configs, deployment addresses |
| `deployments` | Railgun-Community | Contract deployment data |

Note: There is **no** `circom-utxo` repo — the actual circuit code is in `Railgun-Privacy/circuits-v2`.

### 1.2 Circuit Architecture

**Three hand-written templates** in `src/library/`:

1. **`joinsplit.circom`** — `JoinSplit(nInputs, nOutputs, MerkleTreeDepth)`
   - Core transaction circuit. 8 verification steps: message hash, EdDSA signature, nullifier checks, master public key derivation, Merkle proofs, output range checks, output commitment verify, balance conservation.

2. **`merkle-proof-verifier.circom`** — `MerkleProofVerifier(MerkleTreeDepth)`
   - Poseidon(2) at each level, `Switcher` for left/right, `Num2Bits(16)` for path index.

3. **`nullifier-check.circom`** — `NullifierCheck()`
   - `nullifier = Poseidon(nullifyingKey, leafIndex)`, verified via `IsEqual`.

**91 generated circuits** in `src/generated/`, one per valid `(nullifiers, commitments)` pair:

```javascript
// Generation logic from lib/circuitConfigs.js:
for (let nullifiers = 1; nullifiers <= 14; nullifiers += 1) {
  for (let commitments = 1; commitments <= 14 - nullifiers; commitments += 1) {
    circuitConfigs.push({ nullifiers, commitments });
  }
}
// Constraint: nullifiers + commitments <= 14
// (Poseidon arity limit: message hash needs nInputs + nOutputs + 2 <= 16)
```

Each generated file instantiates:
```circom
component main{public [merkleRoot, boundParamsHash, nullifiers, commitmentsOut]}
  = JoinSplit(N, M, 16);
```

### 1.3 Contract Architecture

**V1 — Monolithic:**
- Single `RailgunLogic` contract inheriting `Commitments`, `Verifier`, `TokenWhitelist`
- One `transact()` function handles deposit, transfer, and withdraw
- Depth 16 Merkle tree, 3 outputs per transaction (fixed)
- Two verification keys: small (2 nullifiers) and large (10 nullifiers)
- SHA256-hashes all public inputs into single field element → only 1 IC point

**V2 — `RailgunSmartWallet`:**
- Separate `shield()` and `transact()` functions
- Variable-size circuits: VK stored per `(nullifiers, commitments)` pair
- Multi-token: ERC20 + ERC721 + ERC1155 via `TokenData` struct
- Token blocklist replaces whitelist
- `BoundParams` struct binds metadata to proof (prevents replay)
- Batched `transact(Transaction[])` for multiple proofs in one TX

**V3 — Modular (3 contracts):**
- `PoseidonMerkleAccumulator` — Merkle tree state (roots, leaves, tree rollover)
- `PoseidonMerkleVerifier` — Proof verification + single `execute()` entry point
- `TokenVault` — Token custody, fees, SafetyVector circuit breaker
- Single `AccumulatorStateUpdate` event replaces all V2 events
- `GlobalBoundParams` enables native cross-contract calls (no separate RelayAdapt)
- Claims 50-60% gas reduction vs V2

### 1.4 Engine SDK Architecture

**Main class:** `RailgunEngine` (extends EventEmitter)

**Key modules:**

| Module | Purpose |
|--------|---------|
| `wallet/` | RailgunWallet, ViewOnlyWallet, HardwareWallet, MultisigWallet |
| `note/` | TransactNote, ShieldNote, UnshieldNote (ERC20/NFT variants) |
| `transaction/` | TransactionBatch, Transaction, BoundParams |
| `solutions/` | Coin selection (simple + complex), UTXO utilities |
| `prover/` | Groth16 proof gen (snarkjs WASM + native C prover) |
| `merkletree/` | UTXOMerkletree, TXIDMerkletree, root validation |
| `key-derivation/` | BIP32 on BabyJubJub, BIP39, Bech32 addresses |
| `contracts/` | V2/V3 smart wallet wrappers, RelayAdapt |
| `poi/` | Proof of Innocence: blinded commitments, balance buckets |

**Two-phase sync:**
1. QuickSync (~50%) — bulk event fetch from indexer API
2. Slow scan (~50%) — 499-block chunks via RPC, Merkle root validation

**Proof generation backends:**
- `snarkjs` (browser/Node.js WASM) — ~1.5s per JoinSplit
- Native C prover (mobile) — faster but platform-specific

**Coin selection:**
- Simple: exact match → smallest-first accumulation
- Complex: cross-tree splitting, multi-proof batching, overfill strategy

---

## 2. Circuit Constraint Details & Benchmarks

### 2.1 Railgun Component Costs

| Component | ~Constraints | Count Per Circuit |
|-----------|-------------|-------------------|
| EdDSA-Poseidon signature verify | ~3,800 | 1 (fixed) |
| MerkleProofVerifier(16) | ~4,000 | per input |
| NullifierCheck (Poseidon(2) + IsEqual) | ~260 | per input |
| Poseidon(3) — NPK derivation | ~240 | per input |
| Poseidon(3) — input commitment | ~240 | per input |
| Poseidon(2) — NPK from MPK+random | ~230 | per input |
| Poseidon(nIns+nOuts+2) — message hash | ~310-700 | 1 |
| Num2Bits(120) — output range proof | ~120 | per output |
| Poseidon(3) — output commitment | ~240 | per output |
| Balance constraint (sumIn === sumOut) | 1 | 1 |

### 2.2 Estimated Constraint Counts

| Circuit Config | Est. Non-Linear Constraints |
|---------------|---------------------------|
| 1x2 | ~9,000-10,000 |
| 2x2 | ~14,000-15,000 |
| 2x3 | ~14,500-15,500 |
| 4x2 | ~24,000-26,000 |
| 8x2 | ~38,000-42,000 |
| 10x4 | ~52,000-56,000 |
| 13x1 | ~56,000-60,000 |

**Key insight:** Adding 1 input costs ~4,700 constraints (Merkle proof dominates). Adding 1 output costs only ~360 constraints.

### 2.3 GhostPay V3 vs Railgun Comparison

| Aspect | GhostPay V3 | Railgun V2 |
|--------|------------|------------|
| Circuit model | Single note, 1 input → 1 output + change | JoinSplit, N inputs → M outputs |
| Constraints (NL) | 5,762 | 9K-60K depending on config |
| Total constraints | 12,204 | ~2-3x NL count |
| Commitment | `Poseidon(balance, nullifierSecret, randomness)` | `Poseidon(NPK, tokenHash, value)` |
| Nullifier | `Poseidon(nullifierSecret, commitment)` | `Poseidon(nullifyingKey, leafIndex)` |
| Merkle depth | 20 (1M leaves, single tree) | 16 (65K leaves, multi-tree) |
| Authorization | None (secret = auth) | EdDSA over BabyJubJub (~3,800 constraints) |
| Range proof | LessEqThan(64) | Num2Bits(120) |
| Balance check | `amount + fee <= balance` | `sum(inputs) === sum(outputs)` (strict) |
| Token support | USDC only | ERC20 + ERC721 + ERC1155 |
| Public signals | 7 (newCommitment, root, nullifier, recipient, amount, relayer, fee) | 4 (merkleRoot, boundParamsHash, nullifiers[], commitmentsOut[]) |
| POI | Planned | Full PPOI circuit |

### 2.4 Proof Generation Benchmarks

| System | Circuit | Time | Environment |
|--------|---------|------|-------------|
| GhostPay V3 | ~12K constraints | ~1.2s | Node.js, snarkjs |
| Railgun | ~15K (2x2) | ~1.5s (est.) | Browser, snarkjs WASM |
| Railgun | ~40K (8x2) | ~5-10s (est.) | Browser, snarkjs WASM |
| Tornado Nova | ~30K | ~5-10s | Browser, snarkjs WASM |
| Rapidsnark | ~30K | ~1-2s | Native C++ prover |

### 2.5 Trusted Setup

Railgun uses **2^28 Powers of Tau** (~4 GB ptau file, 268M constraint limit). Phase 2 ceremony per circuit.

GhostPay V3 uses `powersOfTau28_hez_final_14.ptau` (2^14 = 16,384 NL constraint limit). **A larger ptau file is needed for V4** — minimum 2^17 (131K constraints) for comfortable headroom.

---

## 3. UTXO Model Specification

### 3.1 Railgun Note Structure

```
Note {
  notePublicKey: bigint     // Poseidon(masterPublicKey, random)
  tokenHash: bytes32        // ERC20: address; NFT: keccak256(type,addr,subID) % p
  value: bigint             // Token amount
}

commitment = Poseidon(notePublicKey, tokenHash, value)
```

**Key derivation chain:**
```
mnemonic → BIP32 on BabyJubJub
  ├── spendingPrivateKey (m/44'/1984'/0'/0'/{i}')
  │     └── spendingPubKey = eddsa.prv2pub(spendingPrivateKey)
  ├── viewingPrivateKey (m/420'/1984'/0'/0'/{i}')
  │     └── viewingPubKey = ed25519.getPublicKey(viewingPrivateKey)
  ├── nullifyingKey = Poseidon(viewingPrivateKey)
  └── masterPublicKey = Poseidon(spendingPubKey.x, spendingPubKey.y, nullifyingKey)
```

**NPK per note:** `NPK = Poseidon(masterPublicKey, random)` — unique per note even for same owner.

### 3.2 Nullifier Scheme

```
nullifier = Poseidon(nullifyingKey, leafIndex)
```

- `nullifyingKey` is wallet-level (derived from viewing key)
- `leafIndex` is the note's position in the Merkle tree
- Deterministic: same note always produces same nullifier
- Unlinkable: can't connect nullifier to commitment without viewing key

**vs GhostPay V3:** `nullifier = Poseidon(nullifierSecret, commitment)` — per-note secret provides better compartmentalization but requires tracking more secrets.

### 3.3 Transaction Structure

```
Transaction:
  Inputs:  [Note_0, Note_1, ..., Note_N]   (consumed, nullified)
  Outputs: [Note_0, Note_1, ..., Note_M]   (new commitments)

  Rules:
  1. sum(input values) === sum(output values)   [strict equality]
  2. Each input has valid Merkle proof to root
  3. Each input has correctly derived nullifier
  4. Each output value ∈ [0, 2^120)              [range proof]
  5. All commitment preimages correctly computed
  6. EdDSA signature over all public signals     [authorization]
  7. Single token type per proof
```

### 3.4 Max Inputs/Outputs

- **Hard limit:** inputs + outputs <= 14 (Poseidon arity: message hash needs nIns + nOuts + 2 <= 16)
- **Practical engine limits:** 1-10 inputs, 1-5 outputs
- **Named circuits used:** 1x2, 1x3, 2x2, 2x3, 8x2

### 3.5 Change Handling

No special "change" concept in circuit. All outputs are identical. If spending 10 USDC from a 15 USDC note to pay 3 USDC:
- Input: [15 USDC note]
- Output 1: 3 USDC (recipient)
- Output 2: 12 USDC (self, "change")

### 3.6 Fee Handling

Broadcaster fee is a regular output note with `OutputType.BroadcasterFee`. Not a circuit-level concept — it's just another UTXO output. `BoundParams.minGasPrice` is bound into the proof to prevent the broadcaster from pocketing gas savings.

### 3.7 Note Encryption

- **V2:** AES-256-GCM with ECDH shared key (sender viewing key × blinded receiver viewing key)
- **V3:** XChaCha20-Poly1305 via @noble/ciphers
- Encrypted fields: masterPublicKey, random, value, tokenHash, memo
- `ShieldKey` (ECDH public component) published on-chain so receiver can decrypt

### 3.8 Multi-Tree Architecture

- Depth 16 → 65,536 leaves per tree
- When tree fills, `treeNumber` increments, new empty tree starts
- `rootHistory[treeNumber][root] = true` — all historical roots valid
- Coin selection must consider tree boundaries (inputs must be from same tree in one proof)

---

## 4. Range Proof Implementation Options

### 4.1 Comparison

| Approach | Constraints | Max Value | Used By |
|----------|------------|-----------|---------|
| `Num2Bits(120)` | 120 | 2^120 - 1 (~1.3×10^36) | Railgun |
| `Num2Bits(248)` | 248 | 2^248 - 1 | Tornado Nova |
| `LessEqThan(64)` | ~130 | 2^64 - 1 (~1.8×10^19) | GhostPay V3 |
| `Num2Bits_strict` | 254 + alias check | Full field | Security-critical |

### 4.2 Recommendation for V4

- **Keep `LessEqThan(64)` for USDC amounts** — 64 bits is more than enough for 6-decimal USDC (max ~18.4 billion USDC representable)
- **Add `Num2Bits(248)` for output commitments** as safety net — prevents Solidity uint256 overflow exploits (Circom fields are 254 bits, Solidity is 256 bits, values between 2^248 and 2^256 could exploit this gap)
- **Do NOT use Bulletproofs** — they require a different proving system and add complexity without clear benefit in Circom

### 4.3 Why Railgun Uses 120 Bits

120 bits gives maximum representable value of ~1.329×10^36. For any ERC20 token with up to 18 decimals, this represents ~1.329×10^18 whole tokens. More than sufficient. The 120-bit range check costs only 120 constraints per output — negligible compared to Merkle proofs.

---

## 5. GhostPay V4 Architecture Proposal

### 5.1 Design Decisions

| Decision | GhostPay V3 | V4 Proposal | Rationale |
|----------|------------|-------------|-----------|
| Circuit model | Single note | JoinSplit (2-in, 2-out base) | UTXO consolidation, privacy improvement |
| Commitment | `Poseidon(balance, secret, random)` | `Poseidon(NPK, tokenHash, value)` | Multi-token ready, standard pattern |
| Nullifier | Per-note secret | Wallet-level nullifyingKey | Simpler key management |
| Authorization | None | EdDSA on BabyJubJub (optional) | Front-running prevention |
| Balance check | Inequality | Strict equality | Cleaner, prevents hidden inflation |
| Public signals | 7 separate | SHA256-hashed into 1 | Gas optimization (1 IC point) |
| Tree depth | 20 (1M leaves) | 16 (65K, multi-tree) | Faster proofs, Railgun-compatible |
| Range proof | LessEqThan(64) | Num2Bits(120) + LessEqThan(64) | Safety + USDC-specific |
| Token support | USDC only | Multi-ERC20 (tokenHash in commitment) | Future flexibility |

### 5.2 Proposed Circuit: `GhostPayJoinSplit(nIns, nOuts, depth)`

```
Public signals:
  - merkleRoot (or SHA256 of all publics → single signal)
  - nullifiers[nIns]
  - commitmentsOut[nOuts]
  - publicAmount (for deposit/withdraw, 0 for internal transfer)
  - extDataHash (binds to recipient, relayer, fee, encrypted data)

Private signals per input:
  - amount, pubkey, blinding
  - pathElements[depth], pathIndices[depth]

Private signals per output:
  - amount, pubkey, blinding

Constraints:
  1. For each input: commitment = Poseidon(amount, pubkey, blinding)
  2. For each input: Merkle proof verify → root
  3. For each input: nullifier = Poseidon(nullifyingKey, leafIndex)
  4. For each output: commitment = Poseidon(amount, pubkey, blinding)
  5. For each output: Num2Bits(120) range proof
  6. Conservation: sum(inputs) + publicAmount === sum(outputs)
  7. extDataHash binding (recipient, relayer, fee, ciphertext)
```

### 5.3 Estimated Constraints (Without EdDSA)

| Config | Est. Constraints | Proof Time (snarkjs) | Proof Time (Rapidsnark) |
|--------|-----------------|---------------------|------------------------|
| 1x1 | ~6,000 | ~0.8s | ~0.2s |
| 1x2 | ~6,500 | ~0.9s | ~0.3s |
| 2x2 | ~10,500 | ~1.5s | ~0.5s |
| 2x3 | ~11,000 | ~1.6s | ~0.5s |
| 4x2 | ~19,000 | ~3s | ~1s |
| 8x2 | ~36,000 | ~6s | ~2s |

**Without EdDSA** (~3,800 constraints saved), proof times are significantly better. EdDSA can be deferred to V5 or made optional.

### 5.4 Contract Changes

```
V3 ShieldedPool → V4:

1. deposit(amount, commitment) stays similar
   - Add tokenHash support: deposit(amount, token, commitment)
   - Or keep USDC-only initially

2. withdraw() → transact(Transaction[])
   - Variable nullifier/commitment count
   - VK per (nIns, nOuts) pair
   - publicAmount for deposit/withdraw
   - extDataHash for bound params

3. Merkle tree:
   - Reduce depth 20 → 16
   - Add multi-tree support (treeNumber, rollover)
   - ROOT_HISTORY_SIZE per tree

4. New: ShieldedPool V4 = ReentrancyGuard + Pausable + Ownable
   - setVerificationKey(nIns, nOuts, vkey)
   - transact(Transaction[]) — single entry point
   - shield(ShieldRequest[]) — deposit path
```

### 5.5 SDK Changes

```
V3 ShieldedPoolClient → V4:

1. Note management:
   - PrivateNote → UTXO { commitment, amount, pubkey, blinding, treeNumber, leafIndex }
   - Local storage (currently in-memory, needs persistence for UTXO tracking)

2. Coin selection:
   - selectNotesForPayment(amount) → select UTXOs covering amount
   - Smallest-first strategy
   - Same-tree constraint

3. Proof generation:
   - generateJoinSplitProof(inputs[], outputs[], publicAmount)
   - Circuit selection based on |inputs| and |outputs|
   - Multiple circuit artifacts to manage

4. Tree sync:
   - Support multiple trees
   - Track treeNumber boundaries
   - Maintain per-tree leaf counts
```

### 5.6 What NOT To Change (Keep from V3)

- secp256k1 ECDH stealth addresses (already working, ERC-5564 compatible)
- x402 `zk-exact` scheme structure (extend, don't replace)
- Server-as-relayer pattern (buyer generates proof, server submits TX)
- Poseidon hash function (same curve, same library)
- Express middleware pattern (ghostPaywall)
- Off-chain proof verification (snarkjs.groth16.verify)

---

## 6. Base Feasibility Analysis

### 6.1 BN254 Precompiles

All three required precompiles are available on Base (OP Stack = full EVM equivalence):
- `0x06` ecAdd — 150 gas
- `0x07` ecMul — 6,000 gas
- `0x08` ecPairing — 34,000×k + 45,000 gas

GhostPay's existing `Groth16Verifier.sol` at `0x605002BbB689457101104e8Ee3C76a8d5D23e5c8` is empirical proof.

### 6.2 Gas Costs

**Groth16 verification formula:** `181,150 + (numPublicInputs × 6,150)` gas

| Public Inputs | Verify Gas | Base Cost (~0.008 Gwei) |
|---------------|-----------|------------------------|
| 7 (GhostPay V3) | ~224K | ~$0.005 |
| 1 (SHA256-hashed, Railgun-style) | ~187K | ~$0.004 |
| 15 (large UTXO) | ~273K | ~$0.006 |

**Full transaction cost comparison:**

| Operation | GhostPay V3 | Railgun (Ethereum) | V4 Est. (Base) |
|-----------|------------|-------------------|---------------|
| Deposit | 851K gas (~$0.02) | 700-900K | ~500K (~$0.01) |
| Transfer | N/A | 400-700K | ~600K (~$0.01) |
| Withdraw | 1.03M gas (~$0.02) | 1.0-1.6M | ~800K (~$0.02) |

Base is **50-100x cheaper** than Ethereum mainnet for the same operations.

### 6.3 Block Gas Limit

Base: **375M gas** per block. Even worst-case privacy TX (3M gas) uses <1% of a block.

### 6.4 Proof Generation for x402

| Circuit | snarkjs (Node.js) | Rapidsnark (native) | x402 Viable? |
|---------|-------------------|---------------------|-------------|
| V3 current (12K) | 1.2s | ~0.3s | Yes |
| V4 2x2 (10.5K) | ~1.5s | ~0.5s | Yes |
| V4 4x2 (19K) | ~3s | ~1s | Marginal |
| V4 8x2 (36K) | ~6s | ~2s | No (too slow) |

**Recommendation:** Keep x402 circuits at 2x2 max. Use Rapidsnark for production.

### 6.5 Circuit Artifact Sizes

| Circuit | WASM (est.) | zkey (est.) | Total |
|---------|------------|------------|-------|
| V3 current | 2.2 MB | 5.5 MB | 7.7 MB |
| V4 2x2 | ~5 MB | ~12 MB | ~17 MB |
| V4 4x2 | ~10 MB | ~25 MB | ~35 MB |

For Node.js agents: bundled locally, non-issue. For browser: lazy-download + cache.

### 6.6 Railgun on Base

**Railgun is NOT deployed on Base** (Feb 2026). Deployments: Ethereum ($79M TVL), Arbitrum ($2.8M), BSC ($624K), Polygon ($402K). Total ~$83-108M TVL, $4.5B cumulative volume.

**GhostPay V4 would be the first ZK-based UTXO privacy protocol on Base.**

### 6.7 Block Time

Base: 2s blocks, 200ms Flashblocks (sub-block preconfirmation). E2E privacy transaction: proof gen (1-2s) + block inclusion (0.2s) + confirmation (0.2-2s) = **~2-5s total**.

### 6.8 Data Availability

Post-EIP-4844 blob transactions: even 2,200 bytes of calldata costs <$0.01 on Base. Non-issue.

### 6.9 Privacy Set Challenge

**The biggest non-technical challenge.** A new pool starts with 0 TVL.

Mitigations:
1. **x402 agent traffic as baseline noise** — 50 agents × 10 payments/day = 500 daily TXs
2. **Fixed denomination sub-pools** — even 20 depositors provide meaningful anonymity
3. **POI compliance** — attracts institutional depositors
4. **Base DeFi integration** — Aerodrome, Uniswap drives organic usage
5. **Time-delayed withdrawals** — reduces timing correlation

---

## 7. x402 + UTXO Wire Format Proposal

### 7.1 Current V3 Flow (Account-like)

```
Agent → 402: "Pay 1.5 USDC"
Agent → Single note spend → proof (1 nullifier, 1 change commitment)
Agent → Payment header: { proof[8], nullifier, newCommitment, merkleRoot, recipient, amount, relayer, fee }
Server → withdraw() on-chain
```

### 7.2 Proposed V4 Flow (UTXO JoinSplit)

```
Agent → 402: "Pay 1.5 USDC"
Agent → UTXO selection: [10 USDC note]
Agent → JoinSplit proof:
  Input:  [10 USDC note]
  Output: [1.5 USDC (seller stealth), 8.45 USDC (self change), 0.05 USDC (relayer fee)]
  publicAmount: 0 (internal transfer, no deposit/withdraw)
Agent → Payment header: { proof[8], nullifiers[1], commitments[3], merkleRoot, extDataHash, treeNumber }
Server → transact() on-chain
```

**Key difference:** All amounts are PRIVATE. The server sees nullifiers and commitments but cannot determine amounts.

### 7.3 Wire Format V4

```typescript
interface ZkExactPayloadV4 {
  // x402 protocol
  x402Version: 3;
  scheme: "zk-exact-v2";

  // JoinSplit proof
  proof: string[];        // 8 elements (Groth16 A, B, C)
  nullifiers: string[];   // 1-10 nullifier hashes
  commitments: string[];  // 1-5 output commitment hashes
  merkleRoot: string;
  treeNumber: number;

  // Bound params (hashed into proof)
  extDataHash: string;    // SHA256(recipient, relayer, fee, encryptedOutputs)

  // Encrypted outputs (for recipient to decrypt their notes)
  encryptedOutputs: string[];  // AES-encrypted note data per output

  // Stealth (unchanged from V3)
  ephemeralPubKey?: string;
}

interface PaymentRequiredV4 {
  x402Version: 3;
  accepts: [{
    scheme: "zk-exact-v2";
    network: "eip155:84532";
    poolAddress: string;
    treeNumber: number;       // current active tree
    merkleRoot: string;       // current root (for freshness)
    stealthMetaAddress?: SerializedStealthMetaAddress;
    // Note: NO amount field — amount is private!
    // Server knows the price but doesn't put it in 402 response
    // Agent includes correct amount in proof, server verifies via extDataHash
    priceCommitment: string;  // Poseidon(price, serverNonce) — server can verify
    serverNonce: string;      // nonce for price verification
  }];
}
```

### 7.4 Server Verification (Without Knowing Amounts)

The server can verify the proof is valid (snarkjs off-chain verify) without learning amounts. The `extDataHash` binds the proof to the correct recipient and relayer. To verify the correct price was paid:

1. Server knows the price (e.g., 1.5 USDC)
2. `extDataHash = SHA256(recipient, price, relayer, fee, nonce)`
3. Server computes expected `extDataHash` and compares with proof's public input
4. If match → correct price was paid, without the price being a public signal

### 7.5 UTXO Selection Strategy

For x402 agent payments (many small, frequent):

1. **Deposit in bulk** — agent deposits 100 USDC once
2. **Spend from single UTXO** — typical x402 payment uses 1 input, 2 outputs (payment + change)
3. **Consolidate dust** — periodically batch small UTXOs into larger ones (4x1 or 8x1 JoinSplit)
4. **Cache proofs** — if same amount paid repeatedly, pre-compute proofs

---

## 8. Implementation Timeline & Effort Estimate

### 8.1 Phase Breakdown

| Phase | Task | Effort | Claude Code? |
|-------|------|--------|-------------|
| **1. Circuit** | Design JoinSplit template (2x2 base) | 2 weeks | 80% — template writing, constraint debugging |
| | Add Num2Bits(120) range proofs | 1 day | 100% |
| | Generate 2x2, 1x2, 4x2 variants | 1 day | 100% |
| | Constraint testing + verification | 3 days | 90% |
| **2. Trusted Setup** | Download larger ptau (2^17) | 1 hour | 100% |
| | Phase 2 ceremony (single contributor dev) | 1 day | 100% |
| | Multi-party ceremony (production) | 2-4 weeks | 10% — needs human participants |
| **3. Contract** | Redesign ShieldedPool for JoinSplit | 1 week | 85% |
| | Variable VK storage | 2 days | 100% |
| | Multi-tree support | 3 days | 90% |
| | Foundry tests | 3 days | 95% |
| **4. SDK** | UTXO note management | 1 week | 85% |
| | Coin selection algorithm | 3 days | 90% |
| | JoinSplit proof generation | 3 days | 90% |
| | Multi-tree sync | 3 days | 85% |
| | Local storage (LevelDB or JSON) | 2 days | 90% |
| **5. x402** | V4 wire format | 2 days | 95% |
| | Middleware update | 2 days | 95% |
| | zkExactScheme V2 | 2 days | 95% |
| | ghostFetch update | 1 day | 95% |
| **6. E2E** | Integration test | 3 days | 80% |
| | Demo agents update | 2 days | 90% |
| | Base Sepolia deploy + verify | 1 day | 90% |
| **7. Docs** | Protocol docs, circuit docs | 2 days | 95% |
| | README update | 1 day | 100% |

### 8.2 Total Estimate

| Category | Weeks |
|----------|-------|
| Circuit design + test | 2.5 |
| Contract rewrite | 2 |
| SDK UTXO engine | 2.5 |
| x402 integration | 1 |
| E2E + deploy | 1 |
| Docs | 0.5 |
| Buffer (debugging, unexpected issues) | 1.5 |
| **TOTAL (dev setup)** | **~11 weeks** |
| Production trusted setup | +2-4 weeks (parallel) |

### 8.3 What Requires Human Intervention

1. **Multi-party trusted setup ceremony** — need real external participants
2. **Security audit** — external auditor review of circuits + contracts
3. **Privacy set bootstrapping** — marketing, partnerships, getting users to deposit
4. **Regulatory assessment** — legal review of privacy protocol compliance
5. **Rapidsnark compilation** — native binary builds per platform (CI/CD can help)

### 8.4 Suggested Phased Rollout

**V4.0 (MVP):** 2x2 JoinSplit, USDC only, single tree, no EdDSA, no encryption
**V4.1:** Multi-tree support, 4x2 circuit, note encryption
**V4.2:** Multi-token, EdDSA authorization, POI integration
**V4.3:** Cross-contract calls (RelayAdapt), DeFi integration

---

## 9. Risk Analysis

### 9.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Circuit bugs (soundness) | Critical — fake proofs | Low | Extensive testing, formal verification, audit |
| Proof too slow for x402 | High — UX broken | Medium | Rapidsnark, limit to 2x2, pre-computation |
| Smart contract vulnerability | Critical — fund loss | Low | Audit, ReentrancyGuard, Pausable, gradual TVL |
| Trusted setup compromise | Critical — fake proofs | Very Low | Multi-party ceremony, 10+ contributors |
| UTXO dust accumulation | Medium — UX friction | High | Periodic consolidation, minimum note size |
| Multi-tree complexity | Medium — sync bugs | Medium | Extensive testing, root validation |

### 9.2 Privacy Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Small anonymity set | High — deanonymization | High (initially) | Fixed denominations, agent traffic noise |
| Amount correlation (V3) | Critical — links deposit/withdraw | Certain (V3) | **V4 fixes this** — amounts are private |
| Timing correlation | Medium — narrows suspects | Medium | Time-delayed withdrawals, batching |
| Token-type correlation | Low — only if multi-token | Low (USDC-only initially) | Single-token pool |
| Graph analysis on nullifiers | Medium — pattern detection | Low | High transaction volume, uniform behavior |

### 9.3 Business Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Regulatory action (OFAC-style) | Critical — pool unusable | Low-Medium | POI compliance, "clean funds clean hands" |
| No user adoption | High — empty pool | Medium | x402 agent demand, DeFi integration |
| Competition (Railgun deploys on Base) | Medium — split anonymity set | Low | First-mover, x402 integration unique |
| Gas cost increase on Base | Low — still cheap | Low | Efficient circuits, SHA256-hashed signals |

### 9.4 What Could Go Wrong

1. **Circuit soundness bug** — Most dangerous. Mitigation: use Tornado Nova's battle-tested pattern as template.
2. **Proof generation timeout in x402 flow** — Agent takes too long, server times out. Mitigation: Rapidsnark + 2x2 limit.
3. **Tree rollover bug** — When first tree fills 65K leaves, transition to tree 2 might have edge cases. Mitigation: test extensively with artificial fills.
4. **Key management complexity** — BabyJubJub keys + ECDH stealth keys + Ethereum keys. Mitigation: derive all from single mnemonic.
5. **State desync between local UTXO set and on-chain tree** — Agent's local notes get out of sync. Mitigation: periodic full resync, root validation.

---

## 10. References

### Railgun
- [Railgun-Privacy/circuits-v2](https://github.com/Railgun-Privacy/circuits-v2) — Circom JoinSplit circuits
- [Railgun-Privacy/circuits-ppoi](https://github.com/Railgun-Privacy/circuits-ppoi) — POI circuits
- [Railgun-Privacy/contract](https://github.com/Railgun-Privacy/contract) — Solidity contracts
- [Railgun-Community/engine](https://github.com/Railgun-Community/engine) — TypeScript SDK
- [Railgun Docs: ZK Cryptography](https://docs.railgun.org/wiki/learn/privacy-system/zero-knowledge-cryptography)
- [Railgun Docs: Wallets & Keys](https://docs.railgun.org/wiki/learn/wallets-and-keys)
- [Railgun Docs: Trusted Setup Ceremony](https://docs.railgun.org/wiki/learn/privacy-system/trusted-setup-ceremony)
- [Railgun Docs: UX Private Transactions](https://docs.railgun.org/developer-guide/wallet/transactions/ux-private-transactions)

### Tornado Cash Nova
- [tornadocash/tornado-nova](https://github.com/nickknyc/tornado-nova) — Variable amount JoinSplit (Circom + Groth16)

### Alternative Privacy Systems
- [Aztec/Noir](https://github.com/noir-lang/noir) — UltraPlonk DSL, BN254 compatible
- [Hyperledger/Zeto](https://github.com/hyperledger-labs/zeto) — Modular Circom UTXO toolkit
- [Zcash Sapling](https://github.com/zcash/librustzcash) — BLS12-381, Groth16, Bellman
- [Penumbra](https://github.com/penumbra-zone/penumbra) — BLS12-377, Groth16, Arkworks
- [Namada MASP](https://github.com/anoma/masp) — Multi-asset shielded pool, BLS12-381

### Base L2
- [Base Block Gas Limit](https://docs.base.org/) — 375M gas, 2s blocks, 200ms Flashblocks
- [EIP-4844 Blobs](https://eips.ethereum.org/EIPS/eip-4844) — L2 data availability cost reduction

### GhostPay V3
- [GhostPay GitHub](https://github.com/Himess/ghostpay)
- [ShieldedPool V3.1](https://base-sepolia.blockscout.com/address/0xbA5c38093CefBbFA08577b08b0494D5c7738E4F6) — Deployed on Base Sepolia
- [GhostPay AUDIT.md](./AUDIT.md) — V3 + V3.1 audit findings

---

## Summary

**Railgun's UTXO JoinSplit model is the right architecture for GhostPay V4.** It solves V3's fundamental privacy weakness (amount correlation) by making all amounts private. The closest implementation reference is **Tornado Cash Nova** (same stack: Circom + Groth16 + BN254 + Poseidon), while Railgun provides the production-grade reference for multi-token support, key management, and compliance (POI).

**Base L2 is ideal** — BN254 precompiles available, gas costs negligible ($0.01-0.02 per TX), 375M block gas limit, 200ms Flashblocks, and zero ZK-privacy competitors deployed.

**The critical trade-off is proof generation time vs circuit complexity.** For x402 compatibility (sub-2-second proofs), circuits should stay at 2x2 JoinSplit with Rapidsnark. Larger circuits (8x2) are viable for non-x402 use cases.

**Estimated effort: ~11 weeks** for a working V4 MVP on Base Sepolia, with the circuit design and trusted setup being the highest-risk phases.

**GhostPay V4 = first ZK-based UTXO privacy protocol on Base + first privacy-native x402 payment system with encrypted amounts.**
