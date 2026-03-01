# GhostPay: Privacy Infrastructure for the Agent Economy

## Abstract

GhostPay is a privacy-preserving payment protocol for AI agents on Base.
It combines ZK-UTXO architecture with Coinbase's x402 payment standard
to enable private, verifiable micropayments between autonomous agents.
GhostPay is designed as the missing privacy layer for ERC-8004 agent identity
and x402 payment infrastructure.

## The Problem

### AI Agents Have No Financial Privacy

The agent economy is growing rapidly on Base:

- **$50M+** cumulative x402 payment volume across all chains (Q1 2026)
- **120M+** x402 transactions processed
- **24,000+** agents registered on ERC-8004 (Ethereum mainnet, Jan 2026)
- **Base leads** with $21.5M in x402 volume and 70M+ transactions
- **ZERO privacy**: every agent payment is publicly visible on-chain

### Why This Matters

- **Strategy Leakage**: Competing agents can monitor each other's API spending,
  data purchases, and trading patterns in real-time
- **MEV Extraction**: $1B+ extracted from visible on-chain transactions annually
- **Competitive Intelligence**: Any observer can reconstruct an agent's entire
  operational strategy from its payment history
- **Front-running**: Agents' intended actions are visible before execution

### The Privacy Gap in Agent Infrastructure

Current agent stack:

| Layer | Standard | Privacy |
|-------|----------|---------|
| Identity & Trust | ERC-8004 | Public (by design) |
| Payment Protocol | x402 | Public (no privacy) |
| Settlement | Base L2 | Public (transparent) |

GhostPay fills the missing privacy layer.

## The Solution

### GhostPay: Private Payments for Base

GhostPay brings Railgun-level privacy to Base's agent economy:

**ZK-UTXO Architecture**
- Groth16 zero-knowledge proofs with Poseidon hashing
- JoinSplit transactions (1-input-2-output, 2-input-2-output)
- Encrypted amounts — on-chain observers see nothing
- Stealth addresses — recipients are unlinkable
- Nullifier-based double-spend prevention

**x402 Native Integration**
- Custom payment scheme: `zk-exact-v2`
- Drop-in Express middleware for API providers
- Agent SDK for private payments
- Compatible with existing x402 buyer/seller flow

**ERC-8004 Complementary**
- Agent identity remains PUBLIC (ERC-8004 Identity Registry)
- Agent reputation remains PUBLIC (ERC-8004 Reputation Registry)
- Agent payments become PRIVATE (GhostPay)
- "Verifiable agents, private payments"

### How It Works

```
Agent discovers API via ERC-8004 registry
    |
Agent requests API -> receives HTTP 402
    |
Agent generates ZK proof (JoinSplit, publicAmount=0)
    |
Proof + encrypted notes sent in Payment header
    |
Server decrypts notes, verifies amount off-chain
    |
Server submits transact() on-chain (relayer)
    |
Agent receives API response -> HTTP 200
    |
On-chain: only cryptographic commitments visible
          sender, receiver, amount = HIDDEN
```

### Privacy Model

| What | Visible? |
|------|----------|
| Agent uses GhostPay (deposit) | Yes (acceptable, like using a bank) |
| Payment amount | No (encrypted + ZK proof) |
| Payment recipient | No (stealth addresses) |
| Payment sender (in transfers) | No (nullifier-based) |
| Transaction linkability | No (UTXO model breaks links) |
| Agent identity (ERC-8004) | Yes (by design — reputation needs it) |

## Architecture

### Protocol Stack

```
+------------------------------------------+
|  Agent Frameworks                        |
|  (Virtuals, ElizaOS, GAME, ai16z)       |
+------------------------------------------+
|  ERC-8004: Identity + Reputation         |
|  (Agent discovery & trust)               |
+------------------------------------------+
|  GhostPay: Payment Privacy Layer         |
|  (ZK-UTXO + stealth + encrypted notes)  |
+------------------------------------------+
|  x402: Payment Protocol                  |
|  (HTTP 402 -> pay -> 200)                |
+------------------------------------------+
|  Base L2 (Coinbase)                      |
+------------------------------------------+
```

### Core Components

1. **ShieldedPoolV4** — Solidity contract managing the UTXO pool, Merkle tree (depth 20, ~1M leaves), nullifier tracking, and protocol fees
2. **JoinSplit Circuits** — Circom/Groth16 circuits for 1x2 and 2x2 private transactions
3. **TypeScript SDK** — UTXO engine, note encryption (HKDF + AES-256-GCM), stealth addresses, Merkle tree sync
4. **x402 Middleware** — Express middleware for API providers, payment verification, server-as-relayer
5. **Stealth Registry** — ECDH-based stealth address system for recipient privacy

### Smart Contracts (Base Sepolia — Live)

| Contract | Address |
|----------|---------|
| ShieldedPoolV4 | `0x17B6209385c2e36E6095b89572273175902547f9` |
| Groth16Verifier_1x2 | `0xe473aF953d269601402DEBcB2cc899aB594Ad31e` |
| Groth16Verifier_2x2 | `0x10D5BB24327d40c4717676E3B7351D76deb33848` |
| PoseidonHasher | `0x3ae70C9741a9959fA32bC9BC09959d3d319Ee3Cd` |

All contracts verified on Blockscout. Deploy block: `38256581`.

## Revenue Model

### Fee Structure

| Fee Type | Amount | Recipient |
|----------|--------|-----------|
| Protocol fee (deposit/withdraw) | max(0.1%, $0.005) | Treasury (governance) |
| Relayer fee (per TX) | $0.01-0.05 | Server operator |
| Facilitator fee (Phase 2) | $0.01-0.05/TX | GhostPay facilitator |
| Enterprise SDK license | $50K/year | GhostPay team |

### Unit Economics

- Base L2 gas cost per TX: ~$0.02
- Protocol fee per TX: >= $0.005
- Relayer fee per TX: $0.01-0.05
- **Net margin per TX: positive from day 1**

### Market Opportunity

- x402 cumulative volume: $50M+ (Q1 2026), growing rapidly
- Base leads in total x402 volume ($21.5M) and transactions (70M+)
- GhostPay target: 5% of Base x402 private payment volume

### Revenue Projections

| Year | x402 Base Volume (est.) | GhostPay 5% Share | Protocol + Fees | Enterprise | Total |
|------|------------------------|-------------------|-----------------|------------|-------|
| 2026 | $50-200M | $2.5-10M | $30-125K | $100K | $130-225K |
| 2027 | $500M-2B | $25-100M | $300K-1.25M | $250K | $550K-1.5M |
| 2028 | $2-10B | $100-500M | $1.5-5M | $500K | $2-5.5M |

### Operational Costs

| Item | Monthly Cost |
|------|-------------|
| Server (VPS) | $30-100 |
| RPC node | $0-49 |
| Gas (ETH for relaying) | Volume-dependent |
| **Total fixed** | **~$50-150/month** |

## Competitive Landscape

| Feature | GhostPay | Railgun | Tornado Cash | Aztec |
|---------|----------|---------|-------------|-------|
| Base L2 | Yes | No | No (sanctioned) | No |
| x402 native | Yes | No | No | No |
| ERC-8004 compatible | Yes | No | No | No |
| Agent-first SDK | Yes | No | No | No |
| UTXO model | Yes | Yes | No (fixed amounts) | Yes |
| Encrypted amounts | Yes | Yes | No | Yes |
| Live on testnet | Yes | N/A | N/A | No (different chain) |

**GhostPay is the only privacy protocol on Base with x402 and ERC-8004 integration.**

## Compliance & Risk Management

### Regulatory Approach

- **BSL-1.1 License**: Commercial fork protection (Uniswap model), converts to GPL-2.0 in 2028
- **POI Roadmap**: Proof of Innocence system planned (Railgun model) — proves funds are from non-sanctioned sources without revealing identity
- **Deposit Screening**: On-chain deposit screening planned for mainnet launch
- **Coinbase Alignment**: Built on Base (Coinbase L2) with x402 (Coinbase protocol), aligned with Coinbase's privacy vision

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Regulatory (Tornado Cash precedent) | POI roadmap, deposit screening planned, BSL license |
| Smart contract vulnerability | 2 internal audits, 259 tests, professional audit planned |
| Market timing (early) | First-mover advantage, no competition on Base |
| Solo developer | 80+ PRs in major projects, proven execution, team expansion planned |

## Roadmap

| Phase | Timeline | Deliverables |
|-------|----------|-------------|
| **V4.3** (Current) | Live | ZK-UTXO pool, x402 middleware, stealth addresses, protocol fees, 259 tests, Base Sepolia deployment |
| **V4.5** | Weeks 1-8 (Program) | GhostPay Facilitator Service (x402-standard compatible), ERC-8004 integration (registration file + reputation proofs), POI implementation, multi-party trusted setup ceremony, professional security audit, Base mainnet deployment |
| **V5** | Months 6-12 | Decentralized relayer network (stake + slash), view tags for note scanning optimization, ZK reputation proofs (ERC-8004 Level 3), multi-token support (USDT, ETH, DAI), circuit-level fee for private transfers |
| **V5+** | Year 2+ | Cross-chain privacy (CCTP V2), Halo2 migration (no ceremony), facilitator network expansion |

## Team

### Himess — Founder & Solo Developer

- 5+ years in crypto/blockchain development
- **80+ merged PRs** across major infrastructure: reth, revm, Base, Optimism, Miden VM, Celestia
- **Zama Developer Program** — FHEVM Bootcamp curriculum (328 tests, 20 modules)
- **Arc x Lablab AI Hackathon Winner** — ArcPay SDK, Creator Role on Arc Discord
- **MixVM** — Cross-chain privacy bridge (CCTP V2 + LayerZero), noticed by Circle internal team
- **Miden Pioneer Program** participant
- Turkish blockchain developer, open-source contributor

### Execution Proof

| Metric | Value |
|--------|-------|
| GhostPay V4 development time | ~48 hours (V3 -> V4.3) |
| Test coverage | 259 tests (132 Foundry + 127 SDK) |
| Internal audits completed | 2 (46+ findings resolved) |
| Lines of Solidity | ~800+ |
| Lines of TypeScript | ~3000+ |
| Circom circuits | 2 (1x2 + 2x2 JoinSplit) |
| Documentation pages | 6 (Protocol, Circuits, Stealth, Ceremony, POI Roadmap, Audit) |

## The Ask

**Base Batches Season 3 — What we'll build:**

1. **GhostPay Facilitator** — Any x402 server adds privacy by changing one URL. No code changes. Drop-in privacy-as-a-service.
2. **ERC-8004 Integration** — GhostPay as the payment privacy layer for the 24,000+ registered agents. Verifiable agents, private payments.
3. **Mainnet Launch** — Multi-party ceremony, professional audit, Base mainnet deployment.
4. **First Enterprise Integration** — Partner with 1-2 agent frameworks (Virtuals, ElizaOS) for SDK integration.

**Grant usage:**

| Allocation | Amount |
|------------|--------|
| Professional security audit | 40% |
| Infrastructure (facilitator, RPC, hosting) | 20% |
| Multi-party trusted setup ceremony | 10% |
| Team expansion (1 additional developer) | 20% |
| Legal consultation | 10% |

## Links

- **GitHub**: https://github.com/Himess/ghostpay
- **Contracts (Base Sepolia)**: Verified on Blockscout
- **Documentation**: See /docs in repository

---

*GhostPay is licensed under the Business Source License 1.1.
Commercial use requires a license. Converts to GPL-2.0 on March 1, 2028.*
