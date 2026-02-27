# GhostPay Circuit Documentation

## privatePayment Circuit

The main circuit proving:
1. Knowledge of a note (balance, randomness) committed in the Merkle tree
2. Correct nullifier computation (prevents double-spend)
3. Sufficient balance for payment + fee
4. Correct change commitment computation

### Signals

#### Private Inputs
| Signal | Description |
|--------|-------------|
| `balance` | Note balance (USDC amount in 6-decimal units) |
| `randomness` | Commitment randomness |
| `nullifierSecret` | Secret for nullifier derivation |
| `newRandomness` | Randomness for change commitment |
| `pathElements[20]` | Merkle proof sibling hashes |
| `pathIndices[20]` | Merkle proof path directions (0=left, 1=right) |

#### Public Inputs
| Signal | Description |
|--------|-------------|
| `root` | Merkle tree root |
| `nullifierHash` | Hash to prevent double-spend |
| `recipient` | Payment recipient address |
| `amount` | Payment amount |
| `relayer` | Relayer address (for fee) |
| `fee` | Relayer fee |

#### Output
| Signal | Description |
|--------|-------------|
| `newCommitment` | Change commitment (balance - amount - fee, newRandomness) |

### Constraints

1. `commitment = Poseidon(balance, randomness)`
2. `MerkleTreeChecker(commitment, pathElements, pathIndices) == root`
3. `Poseidon(nullifierSecret, commitment) == nullifierHash`
4. `amount + fee <= balance` (LessEqThan 252-bit)
5. `amount > 0` (IsZero check)
6. `change = balance - amount - fee`
7. `newCommitment = Poseidon(change, newRandomness)`

### Constraint Count

~8,000 constraints (well within 2^15 = 32,768 Powers of Tau limit).
Primarily from: 20 Poseidon hashes (Merkle path) + 3 Poseidon hashes (commitment, nullifier, new commitment) + comparators.

## Merkle Tree Template

`MerkleTreeChecker(levels)` — verifies a leaf is included in a Merkle tree.

- Uses Poseidon(2) at each level
- `pathIndices[i]` determines left/right placement (constrained to 0 or 1)
- Outputs the computed root

## Trusted Setup

### Powers of Tau

Uses `powersOfTau28_hez_final_15.ptau` from the Hermez trusted setup ceremony:
- Supports circuits up to 2^15 = 32,768 constraints
- Community ceremony with hundreds of participants
- Download: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau`

### Phase 2

The build script performs a single-entropy Phase 2 contribution.
For production, run a multi-party ceremony:

```bash
# First contributor
snarkjs zkey contribute build/privatePayment_0000.zkey build/privatePayment_0001.zkey --name="Contributor 1"

# Second contributor
snarkjs zkey contribute build/privatePayment_0001.zkey build/privatePayment_0002.zkey --name="Contributor 2"

# Verify
snarkjs zkey verify build/privatePayment.r1cs powersOfTau28_hez_final_15.ptau build/privatePayment_final.zkey
```

## Build

```bash
cd circuits
bash scripts/build.sh
```

Outputs:
- `build/privatePayment_js/privatePayment.wasm` — WASM for proof generation
- `build/privatePayment_final.zkey` — Proving key
- `build/verification_key.json` — Verification key
- `contracts/src/Groth16Verifier.sol` — On-chain verifier (replaces placeholder)
