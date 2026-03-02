# GhostPay Roadmap

## Timeline

```
2026 Q1          2026 Q2            2026 Q3            2026 Q4          2027+
──────────────────────────────────────────────────────────────────────────────
V4.3 Done        V4.5                V5 Alpha           V5 Stable
V4.4 Done
     [WE ARE HERE]

├── ZK-UTXO       ├── Facilitator    ├── Decentralized  ├── ZK reputation
├── x402           │   deploy          │   relayers       ├── Multi-token
├── Stealth        ├── ERC-8004 L2    ├── Scale          └── Governance
├── Fee            ├── POI            └── Partnerships
├── BSL            ├── Ceremony
├── ViewTags       ├── Audit
├── CircuitFee     ├── MAINNET
├── Relayer        └── Enterprise #1
├── Facilitator
└── ERC-8004 L1
```

## Phase Details

### V4.3 — Foundation - Done
**Status: Live on Base Sepolia**

Core protocol: ZK-UTXO JoinSplit, x402 middleware, stealth addresses,
protocol fees, BSL-1.1 license. Tree depth 20 (1M capacity).

### V4.4 — Advanced Features - Done
**Status: Complete (Base Sepolia, 195 tests)**

- **Circuit-Level Fee**: Protocol fee on ALL transactions including private transfers
- **View Tags**: ~50x note scanning speedup (1-byte tag pre-filtering)
- **Hybrid Relayer**: Self-relay + external relay modes
- **GhostPay Facilitator**: x402-standard compatible privacy facilitator
- **ERC-8004 Level 1**: Agent registration spec + payment proof helpers

### V4.5 — Production Ready - Planned
**Status: Planned (Base Batch Program, 8 weeks)**

- **Facilitator Deploy**: facilitator.ghostpay.xyz live service
- **ERC-8004 Level 2**: Reputation + sybil-resistant feedback
- **POI**: Proof of Innocence (Railgun model)
- **Ceremony**: Multi-party trusted setup (10+ contributors)
- **Audit**: Professional security audit
- **Mainnet**: Base mainnet deployment

### V5 — Scale - Planned
**Status: Design Phase (6-12 months)**

- **Decentralized Relayers**: Stake + slash, permissionless, competitive fees
- **ZK Reputation**: ERC-8004 Level 3 — prove "rating > X" via ZK
- **Multi-Token**: USDC + USDT + ETH + DAI (shared anonymity set)

### V5+ — Long Term
- Rapidsnark integration (faster proofs)
- Governance + token (if appropriate)

**Not on roadmap**: ~~Halo2~~, ~~Cross-chain~~ — Base-exclusive by design.

## Architecture Evolution

```
V4.3 (Now):
Agent -> GhostPay SDK -> Server (self-relay) -> Base
                         ^ server sends TX

V4.4 (This Week):
Agent -> GhostPay SDK -> Server -> GhostPay Relayer -> Base
                         ^ server does NOT send TX (optional)

V4.5 (Program):
Agent -> GhostPay SDK -> x402 Server -> GhostPay Facilitator -> Base
                         ^ server changes 1 URL, zero code changes

V5 (Post-launch):
Agent -> GhostPay SDK -> Decentralized Relayer Network -> Base
                         ^ permissionless, stake + slash
```

## Revenue Model

Fee: max(0.1%, $0.01) protocol fee on all transactions.

| Year | Est. Volume | Protocol Fee | Enterprise | Total |
|------|-------------|-------------|------------|-------|
| 2026 | $50M | ~$1M | $150K | ~$1.15M |
| 2027 | $300M | ~$6M | $250K | ~$6.25M |
| 2028 | $1B+ | ~$10-20M | $500K | ~$10-20M |

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| V4.3 complete | March 2026 | Done |
| V4.4 complete | March 2026 | Done |
| Base Batch application | March 7, 2026 | Planned |
| Facilitator deploy | April 2026 | Planned |
| ERC-8004 Level 2 | May 2026 | Planned |
| Multi-party ceremony | May 2026 | Planned |
| Professional audit | May 2026 | Planned |
| POI implementation | June 2026 | Planned |
| Base mainnet | July 2026 | Planned |
| First enterprise integration | August 2026 | Planned |
| Decentralized relayers | October 2026 | Planned |
| ZK reputation | Q1 2027 | Planned |
