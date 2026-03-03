# PrivAgent Circuit Documentation

## JoinSplit Circuit (V4)

The main circuit proving UTXO ownership and balance conservation. Based on Tornado Cash Nova's `transaction.circom` pattern.

### What It Proves

1. Knowledge of input UTXOs `(amount, pubkey, blinding)` committed in the Merkle tree
2. Correct nullifier computation (prevents double-spend)
3. Balance conservation: `sum(inputs) + publicAmount === sum(outputs)`
4. Correct output commitment computation
5. Amount range validity (0 ≤ amount < 2^120)

### Circuit Variants

| Variant | Inputs | Outputs | Use Case |
|---------|--------|---------|----------|
| `joinSplit_1x2` | 1 | 2 | Single UTXO payment + change |
| `joinSplit_2x2` | 2 | 2 | Merge UTXOs + payment + change |
| `joinSplit_4x2` | 4 | 2 | Consolidate many UTXOs (not deployed) |

The `1x2` variant handles the most common case: spending a single UTXO, creating a payment output and a change output. The `2x2` variant handles cases where no single UTXO has sufficient balance.

### Signals

#### Public Inputs

| Signal | Description |
|--------|-------------|
| `root` | Merkle tree root (proves inputs exist) |
| `publicAmount` | External amount (>0 deposit, <0 withdraw, 0 transfer) |
| `extDataHash` | Hash of external data (recipient, relayer, fee, encrypted outputs) |
| `protocolFee` | Circuit-enforced protocol fee (V4.4) |
| `inputNullifiers[nIns]` | One per input UTXO (prevents double-spend) |
| `outputCommitments[nOuts]` | One per output UTXO (new commitments) |

#### Private Inputs — Per Input UTXO

| Signal | Description |
|--------|-------------|
| `inAmount[nIns]` | Input UTXO amounts |
| `inPrivateKey[nIns]` | Owner's private key (Poseidon keypair) |
| `inBlinding[nIns]` | Commitment blinding factor |
| `inPathIndices[nIns]` | Merkle leaf index (integer, not bit array) |
| `inPathElements[nIns][levels]` | Merkle proof sibling hashes |

#### Private Inputs — Per Output UTXO

| Signal | Description |
|--------|-------------|
| `outAmount[nOuts]` | Output UTXO amounts |
| `outPubkey[nOuts]` | Recipient public key (Poseidon) |
| `outBlinding[nOuts]` | Commitment blinding factor |

### Constraints

#### Per Input UTXO

1. **Keypair derivation:** `publicKey = Poseidon(privateKey)` — 1-input Poseidon
2. **Commitment:** `commitment = Poseidon(amount, publicKey, blinding)` — 3-input Poseidon
3. **Nullifier:** `nullifier = Poseidon(commitment, pathIndex, privateKey)` — 3-input Poseidon
4. **Nullifier match:** `inputNullifiers[i] === nullifier` — equality constraint
5. **Merkle proof:** `MerkleProofVerifier(commitment, pathIndex, pathElements) → computedRoot` — depth-20 path
6. **Conditional root check:** `ForceEqualIfEnabled(root, computedRoot, amount)` — skip for dummy (amount=0) inputs
7. **Range check:** `Num2Bits(120)` on amount — prevents field overflow

#### Per Output UTXO

1. **Commitment:** `commitment = Poseidon(amount, pubkey, blinding)` — 3-input Poseidon
2. **Commitment match:** `outputCommitments[i] === commitment` — equality constraint
3. **Range check:** `Num2Bits(120)` on amount — prevents field overflow

#### Global

1. **Balance conservation:** `sum(inAmount) + publicAmount === sum(outAmount) + protocolFee`
2. **extDataHash binding:** `extDataHashSquare = extDataHash * extDataHash` — quadratic constraint prevents optimizer removal

### Constraint Counts

| Circuit | Non-linear | Approx Total |
|---------|-----------|-------------|
| joinSplit_1x2 (1 in, 2 out, depth-20) | ~5,900 | ~12,000 |
| joinSplit_2x2 (2 in, 2 out, depth-20) | ~11,000 | ~22,000 |

#### Breakdown (1x2)

| Component | Count | Constraints |
|-----------|-------|-------------|
| Poseidon(1) keypair | 1 | ~220 |
| Poseidon(3) input commitment | 1 | ~660 |
| Poseidon(3) nullifier | 1 | ~660 |
| MerkleProofVerifier (depth-20) | 1 | ~20 × 220 = ~4,400 |
| Poseidon(3) output commitments | 2 | ~1,320 |
| Num2Bits(120) range checks | 3 | ~360 |
| ForceEqualIfEnabled | 1 | ~2 |
| Balance + extData | - | ~4 |

### V3 vs V4 Circuit Comparison

| Aspect | V3 (privatePayment) | V4 (joinSplit) |
|--------|---------------------|----------------|
| Model | Single input, single change | N inputs, M outputs |
| Depth | depth-20 | depth-20 |
| Commitment | `Poseidon(amount, nullifierSecret, randomness)` | `Poseidon(amount, pubkey, blinding)` |
| Nullifier | `Poseidon(nullifierSecret, commitment)` | `Poseidon(commitment, pathIndex, privateKey)` |
| Key model | Per-note secret | Per-wallet keypair |
| Balance check | `LessEqThan(64)` | `sum(in) + pubAmount === sum(out) + protocolFee` |
| Change output | Conditional (IsZero gate) | Always produced (can be zero-amount) |
| Range check | 64-bit (amount + fee) | 120-bit (each UTXO amount) |
| Public signals | 7 (root, null, commit, recipient, amount, relayer, fee) | 4 + nIns + nOuts (root, pubAmount, extDataHash, protocolFee, nullifiers, commitments) |
| Amount visibility | PUBLIC (in public signals) | HIDDEN (only in encrypted notes) |

### Sub-templates

#### Keypair

```
template Keypair():
  input:  privateKey
  output: publicKey = Poseidon(privateKey)
```

#### UTXOCommitment

```
template UTXOCommitment():
  input:  amount, pubkey, blinding
  output: commitment = Poseidon(amount, pubkey, blinding)
```

#### NullifierHasher

```
template NullifierHasher():
  input:  commitment, pathIndex, privateKey
  output: nullifier = Poseidon(commitment, pathIndex, privateKey)
```

#### ForceEqualIfEnabled

From Tornado Cash Nova — enforces `in[0] === in[1]` only when `enabled != 0`. Used for conditional root checking: dummy inputs (amount=0) skip root verification since they have no real Merkle proof.

#### MerkleProofVerifier

Verifies a leaf is in a Merkle tree at a given index (depth-20). Uses Poseidon(2) at each level. The `pathIndex` is an integer (not bit array) — individual bits are extracted internally.

## Trusted Setup

### Powers of Tau (Phase 1)

Uses `powersOfTau28_hez_final_17.ptau` from the Hermez trusted setup ceremony:
- Supports circuits up to 2^17 = 131,072 non-linear constraints
- Community ceremony with 54 participants
- Download: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_17.ptau`

### Phase 2

The build script performs a single-entropy Phase 2 contribution per circuit variant.
For production, run a multi-party ceremony:

```bash
# First contributor
snarkjs zkey contribute build/v4/1x2/joinSplit_1x2_0000.zkey build/v4/1x2/joinSplit_1x2_0001.zkey --name="Contributor 1"

# Verify
snarkjs zkey verify build/v4/1x2/joinSplit_1x2.r1cs powersOfTau28_hez_final_16.ptau build/v4/1x2/joinSplit_1x2_final.zkey
```

See `circuits/CEREMONY.md` for the current ceremony record.

## Build

```bash
cd circuits
bash scripts/build-v4.sh
```

Outputs per variant (1x2, 2x2):
- `build/v4/{variant}/joinSplit_{variant}.wasm` — WASM for proof generation
- `build/v4/{variant}/joinSplit_{variant}_final.zkey` — Proving key
- `build/v4/{variant}/verification_key.json` — Verification key
- `contracts/src/verifiers/Groth16Verifier_{variant}.sol` — On-chain verifier

## Proof Format

The proof is serialized as 8 bigint strings for the `Payment` header:

```
proof[0] = pA[0]
proof[1] = pA[1]
proof[2] = pB[0][1]  // note: pB indices swapped for Solidity
proof[3] = pB[0][0]
proof[4] = pB[1][1]
proof[5] = pB[1][0]
proof[6] = pC[0]
proof[7] = pC[1]
```

For snarkjs verification (off-chain), pB must be un-swapped:
```
pi_b: [[proof[3], proof[2]], [proof[5], proof[4]], ["1", "0"]]
```
