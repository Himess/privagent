# GhostPay Circuit Documentation (V3)

## privatePayment Circuit

The main circuit proving:
1. Knowledge of a note `(amount, nullifierSecret, randomness)` committed in the Merkle tree
2. Correct nullifier computation (prevents double-spend)
3. Sufficient balance for payment + fee
4. Correct conditional change commitment computation

### Signals

#### Private Inputs
| Signal | Description |
|--------|-------------|
| `balance` | Note balance (USDC amount in 6-decimal units) |
| `nullifierSecret` | Secret for nullifier derivation (bound to commitment) |
| `randomness` | Commitment randomness |
| `pathElements[20]` | Merkle proof sibling hashes |
| `pathIndices[20]` | Merkle proof path directions (0=left, 1=right) |
| `newBalance` | Change amount (balance - amount - fee) |
| `newNullifierSecret` | Secret for change note |
| `newRandomness` | Randomness for change commitment |

#### Public Inputs
| Signal | Description |
|--------|-------------|
| `root` | Merkle tree root |
| `nullifierHash` | Hash to prevent double-spend |
| `recipient` | Payment recipient address (as field element) |
| `amount` | Payment amount |
| `relayer` | Relayer address (for fee) |
| `fee` | Relayer fee |

#### Output
| Signal | Description |
|--------|-------------|
| `newCommitment` | Conditional: `Poseidon(change, newSecret, newRandom)` if change > 0, else `0` |

### Constraints (V3)

1. `commitment = Poseidon(balance, nullifierSecret, randomness)` — 3-input (C6+C7 fix)
2. `nullifierHash == Poseidon(nullifierSecret, commitment)` — nullifier binding
3. `MerkleTreeChecker(commitment, pathElements, pathIndices) == root` — inclusion proof
4. `amount + fee <= balance` — `LessEqThan(64)` (M2 fix: was 252, now 64-bit)
5. `change = balance - amount - fee` — balance equation
6. `change == newBalance` — declared change matches
7. `expectedNewCommitment = (1 - IsZero(change)) * Poseidon(newBalance, newNullifierSecret, newRandomness)` — conditional (C2 fix)
8. `newCommitment == expectedNewCommitment` — output constraint
9. `recipientSquare = recipient * recipient` — unused signal prevention
10. `relayerSquare = relayer * relayer` — unused signal prevention

### V3 Changes from V2

| Aspect | V2 | V3 |
|--------|----|----|
| Commitment | `Poseidon(balance, randomness)` | `Poseidon(balance, nullifierSecret, randomness)` |
| Balance check | `LessEqThan(252)` | `LessEqThan(64)` |
| newCommitment | Always computed | Conditional via `IsZero` gate |
| Full-spend | `newCommitment = Poseidon(0, random)` | `newCommitment = 0` |

### Constraint Count

| Component | Non-linear | Linear | Total |
|-----------|-----------|--------|-------|
| Circuit total | 5,762 | 6,442 | 12,204 |

Well within `2^14 = 16,384` non-linear constraint limit of `powersOfTau28_hez_final_14.ptau`.

Constraint breakdown:
- 20 Poseidon(2) hashes for Merkle path verification
- 2 Poseidon(3) hashes for commitment and change commitment
- 1 Poseidon(2) hash for nullifier
- 1 LessEqThan(64) comparator
- 1 IsZero gate for conditional output
- 2 quadratic constraints for unused signal prevention

## Merkle Tree Template

`MerkleTreeChecker(levels)` — verifies a leaf is included in a Merkle tree.

- Uses Poseidon(2) at each level
- `pathIndices[i]` determines left/right placement (constrained to 0 or 1)
- Outputs the computed root
- Depth 20 = ~1,048,576 possible leaves

## Trusted Setup

### Powers of Tau (Phase 1)

Uses `powersOfTau28_hez_final_14.ptau` from the Hermez trusted setup ceremony:
- Supports circuits up to 2^14 = 16,384 non-linear constraints
- Community ceremony with 54 participants
- Download: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau`

### Phase 2

The build script performs a single-entropy Phase 2 contribution.
For production, run a multi-party ceremony:

```bash
# First contributor
snarkjs zkey contribute build/privatePayment_0000.zkey build/privatePayment_0001.zkey --name="Contributor 1"

# Second contributor
snarkjs zkey contribute build/privatePayment_0001.zkey build/privatePayment_0002.zkey --name="Contributor 2"

# Verify
snarkjs zkey verify build/privatePayment.r1cs powersOfTau28_hez_final_14.ptau build/privatePayment_final.zkey
```

See `circuits/CEREMONY.md` for the current ceremony record.

## Build

```bash
cd circuits
bash scripts/build.sh
```

Outputs:
- `build/privatePayment_js/privatePayment.wasm` — WASM for proof generation
- `build/privatePayment_final.zkey` — Proving key
- `build/verification_key.json` — Verification key
- `contracts/src/Groth16Verifier.sol` — On-chain verifier
