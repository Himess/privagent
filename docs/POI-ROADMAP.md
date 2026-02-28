# Proof of Innocence (POI) — Roadmap

## Status: PLANNED (V4.2)

GhostPay's UTXO JoinSplit architecture is designed to support
Proof of Innocence as an additive circuit constraint, following
Railgun's proven compliance model.

## What is POI?

POI allows users to prove their funds come from non-sanctioned sources
WITHOUT revealing their identity. This makes GhostPay both private AND
regulation-compliant.

## Architecture (Planned)

### Layer 1: Deposit-Time Compliance
- SanctionsList oracle integration (Chainalysis compatible)
- Sanctioned addresses cannot deposit
- All clean deposits flagged as compliant

### Layer 2: Withdraw-Time ZK Proof
- Separate POI circuit: `ProofOfInnocence(16)`
- Proves: "my UTXO exists in compliant deposits tree"
- Privacy preserved: WHICH deposit is not revealed
- Dual-proof: JoinSplit proof + POI proof

### Components Needed
- [ ] `contracts/src/SanctionsList.sol` — OFAC oracle
- [ ] `contracts/src/ShieldedPoolV4.sol` — `transactWithPOI()` function
- [ ] `circuits/poi.circom` — POI circuit (~4,500 constraints)
- [ ] `sdk/src/v4/poi/` — CompliantTree, POIProver, POIManager
- [ ] `sdk/src/x402/` — Wire format update (poiRequired, poiProof)
- [ ] Tests: 15+ Foundry, 10+ SDK, E2E POI flow

### Design Decisions
- POI is OPTIONAL (poiRequired flag, default: false)
- Backward compatible: existing transact() works without POI
- Follows Railgun V3 PPOI pattern (simplified for agent use case)
- Chainalysis SanctionsList interface compatible

### References
- Railgun PPOI: https://github.com/Railgun-Privacy/circuits-ppoi
- Chainalysis Oracle: 0x40C57923924B5c5c5455c48D93317139ADDaC8fb
- GhostPay POI Design Doc: (internal)

### Timeline
- Design: 1 week
- Circuit + Contract: 1 week
- SDK + x402 integration: 1 week
- Testing + Deploy: 1 week
- TOTAL: ~4 weeks (post Base Batch acceptance)
