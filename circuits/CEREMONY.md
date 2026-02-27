# GhostPay Trusted Setup Ceremony

## Phase 1: Powers of Tau

- **Source:** Hermez (Polygon) community ceremony
- **File:** `powersOfTau28_hez_final_14.ptau`
- **Max constraints:** 2^14 = 16,384 (non-linear)
- **Contributors:** 54 participants
- **Circuit constraints:** 5,762 non-linear (within limit)

## Phase 2: Circuit-Specific

- **Date:** 2026-02-27
- **Circuit:** privatePayment (V3 — Poseidon(3) commitment, conditional newCommitment)
- **Contributors:** Single contributor (development)
- **Entropy:** Random (`ghostpay-v3` + timestamp)

## Production Requirements

This Phase 2 setup has a single contributor and is suitable for testing only.

For production deployment, a multi-party ceremony is required:

```bash
# Each participant contributes entropy
snarkjs zkey contribute privatePayment_000N.zkey privatePayment_000(N+1).zkey \
  --name="Contributor Name" -v

# Verify the full chain
snarkjs zkey verify privatePayment.r1cs powersOfTau28_hez_final_14.ptau privatePayment_final.zkey
```

Minimum recommended: 3+ independent contributors from different organizations.

## Verification

```bash
# Verify proving key
snarkjs zkey verify circuits/build/privatePayment.r1cs \
  circuits/build/powersOfTau28_hez_final_14.ptau \
  circuits/build/privatePayment_final.zkey

# Export verification key
snarkjs zkey export verificationkey \
  circuits/build/privatePayment_final.zkey \
  circuits/build/verification_key.json
```

## Files

| File | Purpose |
|------|---------|
| `powersOfTau28_hez_final_14.ptau` | Phase 1 (Hermez, 54 contributors) |
| `privatePayment_0000.zkey` | Phase 2 initial |
| `privatePayment_final.zkey` | Phase 2 final (proving key) |
| `verification_key.json` | Verification key (for off-chain verify) |
| `contracts/src/Groth16Verifier.sol` | On-chain verifier (auto-generated) |
