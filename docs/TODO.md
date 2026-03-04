# PrivAgent — Development TODO & Roadmap

> Last updated: March 2026
> Status legend: Done | In Progress | Planned | Idea

---

## V4.3 — Foundation (Base Sepolia Live) - Done

### Completed
- [x] ZK-UTXO JoinSplit architecture (1x2 + 2x2 circuits)
- [x] ShieldedPoolV4 contract (Merkle tree depth 20, nullifiers, encrypted notes)
- [x] Groth16 proof generation + verification
- [x] Poseidon hashing (contract + SDK + circuit)
- [x] Stealth address system (ECDH + StealthRegistry)
- [x] x402 V2 middleware (Express/Hono)
- [x] x402 buyer SDK (PrivAgentClient)
- [x] Note encryption (HKDF + AES-256-GCM)
- [x] Base Sepolia deployment + Blockscout verification
- [x] 195 tests (86 Foundry + 109 SDK)
- [x] 3x internal security audit (46+ findings resolved)
- [x] Protocol fee mechanism (max 0.1%, min $0.01)
- [x] BSL-1.1 license + copyright headers
- [x] Batch nullifier duplicate check
- [x] Tree depth 16 -> 20 (1M leaves)
- [x] HKDF key derivation (domain separation)
- [x] V3 -> legacy migration
- [x] Demo web app (Next.js 14)
- [x] Integration examples (Virtuals, ElizaOS, Express, Basic)
- [x] Documentation (Protocol, Circuits, Stealth, Ceremony, POI Roadmap)

---

## V4.4 — Advanced Features - Done

### Circuit-Level Fee - Done
- [x] Add protocolFee as public input to JoinSplit circuits
- [x] Balance constraint: sum(in) + public = sum(out) + fee
- [x] Circuit recompile + Phase 2 trusted setup
- [x] New verifier contracts generated + deployed
- [x] Contract: fee collected on ALL TX types (including private transfers)
- [x] SDK: proof generation includes protocolFee input
- [x] Min fee updated: $0.005 -> $0.01
- [x] Tests: 6+ new tests

### View Tags - Done
- [x] Contract: NewCommitment event + viewTag (uint8)
- [x] Contract: viewTags[] validation in transact()
- [x] SDK: viewTag.ts (generateViewTag, checkViewTag)
- [x] SDK: note scanning pre-filter with view tags (~50x speedup)
- [x] SDK: view tag generation in proof/TX creation
- [x] Tests: 4+ new tests

### Hybrid Relayer - Done
- [x] SDK: RelayMode type (self-relay | external-relay)
- [x] SDK: middleware config with mode parameter
- [x] SDK: externalRelay.ts (relay client + relayer info)
- [x] SDK: relayerServer.ts (example relayer server)
- [x] SDK: ShieldedWallet relayer config option
- [x] Tests: 6+ new tests

### PrivAgent Facilitator - Done
- [x] SDK: facilitatorServer.ts (x402-compatible wrapper)
- [x] Endpoints: /verify, /info, /health
- [x] x402 scheme: zk-exact-v2
- [x] Reuses relayer logic internally
- [x] Tests: 5+ new tests

### ERC-8004 Level 1 Integration - Done
- [x] SDK: sdk/src/erc8004/index.ts (helpers)
- [x] privAgentPaymentMethod() -- registration file generator
- [x] paymentProofForFeedback() -- nullifier-based proof
- [x] verifyPaymentProof() -- on-chain verification
- [x] examples/erc8004-integration/ (full example)
- [x] Agent registration JSON spec
- [x] Tests: 4+ new tests

---

## V4.5 — Production Ready (Base Batch Program, Weeks 1-8) - Planned

### Facilitator Deploy
- [ ] Deploy facilitator.privagent.xyz
- [ ] Health monitoring + status page
- [ ] Rate limiting + DDoS protection
- [ ] Apply to x402 facilitator listing (Coinbase)

### ERC-8004 Level 2 — Reputation + Payment Proof
- [ ] Link nullifiers to ERC-8004 feedback system
- [ ] Sybil resistance: only payers can leave reviews
- [ ] Integration with ERC-8004 Reputation Registry
- [ ] ERC-8004 team outreach (Erik Reppel/Coinbase, Marco De Rossi/MetaMask)

### Proof of Innocence (POI)
- [ ] Compliance Merkle tree (clean deposits only)
- [ ] POI circuit: prove deposit source non-sanctioned
- [ ] POI verifier contract
- [ ] SDK: automatic POI proof on withdraw

### Multi-Party Trusted Setup Ceremony
- [ ] Platform: PSE p0tion
- [ ] 10-20 independent contributors (request Coinbase support)
- [ ] Phase 2 for 1x2 + 2x2 circuits
- [ ] Publish transcript + verification

### Professional Security Audit
- [ ] Budget: ~$20K (40% of grant)
- [ ] Firms: OpenZeppelin, Trail of Bits, Zellic, Spearbit
- [ ] Fix all findings
- [ ] Publish report

### Base Mainnet Deployment
- [ ] All prerequisites completed (ceremony + audit + POI)
- [ ] Deploy contracts to Base mainnet
- [ ] Blockscout verify
- [ ] Treasury + fee activation
- [ ] Monitoring + alerting

---

## V5 — Scale (Months 6-12) - Planned

### Decentralized Relayer Network
- [ ] Relayer registry contract (stake ETH to become relayer)
- [ ] Competitive fee market
- [ ] Slash conditions: failed TX, censorship, downtime
- [ ] Permissionless relayer joining
- [ ] Documentation: "How to run a PrivAgent relayer"

### ZK Reputation (ERC-8004 Level 3)
- [ ] ZK reputation circuit design
- [ ] Prove "reputation > X" without revealing exact score
- [ ] Integration with ERC-8004 Validation Registry

### Multi-Token Support (Low Priority)
- [ ] Extend commitment with tokenAddress
- [ ] Single pool, shared anonymity set
- [ ] USDC, USDT, ETH, DAI

---

## V5+ — Long Term - Idea

### Rapidsnark Integration
- [ ] Native C++ prover (10x faster proofs)
- [ ] Dual mode: rapidsnark if available, snarkjs fallback
- [ ] Low priority — agents tolerate 3.5s proof time

### Governance
- [ ] Governance token (if appropriate)
- [ ] Fee parameter voting
- [ ] Treasury management

### Removed from Roadmap
- ~~Halo2 Migration~~ — Groth16 is industry standard, migration cost too high
- ~~Cross-Chain Privacy~~ — PrivAgent is Base-exclusive by design

---

## Non-Technical TODO

### Base Batches Season 3
- [x] Light paper
- [x] README
- [ ] Demo video (3-4 minutes)
- [ ] Devfolio application
- [ ] Deploy demo to Vercel
- [ ] Submit by March 7, 2026

### Business Development
- [ ] Virtuals team (SDK integration)
- [ ] ElizaOS team (plugin)
- [ ] GAME Framework team
- [ ] x402 Foundation
- [ ] ERC-8004 team
- [ ] Coinbase Ventures

### Content
- [ ] Blog: "Building ZK Privacy on Base"
- [ ] Turkish educational content
- [ ] Twitter/X announcement thread
- [ ] Developer tutorial

---

## Priority Matrix

### Critical (This Week — Deadline March 7)
1. ~~V4.4 features~~ (Done)
2. Light paper finalization
3. Demo video
4. Devfolio application

### High (8 Weeks — Program)
1. Facilitator deploy
2. ERC-8004 Level 2
3. POI
4. Ceremony + audit
5. Mainnet deploy

### Medium (6-12 Months)
1. Decentralized relayer network
2. ZK reputation
3. Enterprise partnerships

### Low (Year 2+)
1. Multi-token
2. Rapidsnark
3. Governance

---

## V4.5 — Pre-Mainnet Priorities

### Critical
- [ ] Multi-party trusted setup ceremony (3+ contributors)
- [ ] Fix change UTXO privacy leak (encrypt to buyer, not server)
- [ ] Remove ShieldedWallet privateKey public getter
- [ ] Add TimelockController + multisig for admin functions

### High
- [ ] Fix pool insolvency from private transfer fees
- [ ] Make off-chain proof verification mandatory ✅ (done in V4.4.1)
- [ ] Encrypt FileNoteStore at rest (AES-256-GCM)
- [ ] Zero ECDH key material after use
- [ ] Add protocolFee circuit test coverage

### Medium
- [ ] Gas optimization pass (~850K → target 600K)
- [ ] Multi-token support (beyond USDC)
- [ ] Faster proving (PLONK/Halo2 evaluation)
