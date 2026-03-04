# PrivAgent Trusted Setup Ceremony

<!-- TODO(MAINNET): Multi-party trusted setup ceremony with 3+ independent contributors
     required before mainnet. Current single-contributor Phase 2 is NOT production-safe. -->

## V4 JoinSplit Circuits (Current)

### Phase 1: Powers of Tau

- **Source:** Hermez (Polygon) community ceremony
- **File:** `powersOfTau28_hez_final_17.ptau`
- **Max constraints:** 2^17 = 131,072 (non-linear)
- **Contributors:** 54 participants

### Phase 2: Circuit-Specific

- **Date:** 2026-02-27
- **Circuits:** joinSplit_1x2 (5,572 NL), joinSplit_2x2 (10,375 NL)
- **Contributors:** Single contributor (development)
- **Entropy:** Deterministic `privagent-v4-dev-entropy-{config}` — **NOT suitable for production**

> **WARNING:** Phase 2 uses hardcoded entropy strings. For mainnet, use `openssl rand -hex 32` piped to each contribution, and run a multi-party ceremony with 3+ independent contributors.

### V4 Circuit Variants

| Circuit | Inputs | Outputs | Non-linear Constraints | PTAU Required |
|---------|--------|---------|----------------------|---------------|
| joinSplit_1x2 | 1 | 2 | 13,726 | 2^14 (16,384) |
| joinSplit_2x2 | 2 | 2 | 25,877 | 2^15 (32,768) |

### V4 Build

```bash
cd circuits
bash scripts/build-v4.sh
```

Outputs per variant:
- `build/v4/{variant}/joinSplit_{variant}.wasm`
- `build/v4/{variant}/joinSplit_{variant}_final.zkey`
- `build/v4/{variant}/verification_key.json`
- `contracts/src/verifiers/Groth16Verifier_{variant}.sol`

## V3 privatePayment Circuit (Legacy)

### Phase 1: Powers of Tau

- **File:** `powersOfTau28_hez_final_14.ptau`
- **Max constraints:** 2^14 = 16,384 (non-linear)
- **Circuit constraints:** 5,762 non-linear (within limit)

### Phase 2: Circuit-Specific

- **Date:** 2026-02-27
- **Circuit:** privatePayment (V3)
- **Contributors:** Single contributor (development)
- **Entropy:** Random (`privagent-v3` + timestamp)

## Production Ceremony Guide

For mainnet deployment, a multi-party ceremony is required:

```bash
# 1. Each participant contributes random entropy
openssl rand -hex 32 | snarkjs zkey contribute \
  joinSplit_1x2_000N.zkey joinSplit_1x2_000(N+1).zkey \
  --name="Contributor Name" -v

# 2. Verify the full contribution chain
snarkjs zkey verify build/v4/1x2/joinSplit_1x2.r1cs \
  powersOfTau28_hez_final_17.ptau \
  build/v4/1x2/joinSplit_1x2_final.zkey

# 3. Export verification key
snarkjs zkey export verificationkey \
  build/v4/1x2/joinSplit_1x2_final.zkey \
  build/v4/1x2/verification_key.json
```

**Minimum:** 3+ independent contributors from different organizations.

## Files

### V4

| File | Purpose |
|------|---------|
| `powersOfTau28_hez_final_17.ptau` | Phase 1 (Hermez, 54 contributors, 2^17) |
| `build/v4/1x2/joinSplit_1x2_final.zkey` | Proving key (1 input, 2 outputs) |
| `build/v4/2x2/joinSplit_2x2_final.zkey` | Proving key (2 inputs, 2 outputs) |
| `build/v4/*/verification_key.json` | Verification keys |
| `contracts/src/verifiers/Groth16Verifier_*.sol` | On-chain verifiers |

### V3 (Legacy)

| File | Purpose |
|------|---------|
| `powersOfTau28_hez_final_14.ptau` | Phase 1 (Hermez, 54 contributors, 2^14) |
| `build/privatePayment_final.zkey` | Proving key |
| `build/verification_key.json` | Verification key |
| `contracts/src/Groth16Verifier.sol` | On-chain verifier |
