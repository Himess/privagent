# PrivAgent: Privacy Infrastructure for the Agent Economy

## Abstract

PrivAgent is a privacy-preserving payment protocol for AI agents on Base.
It combines ZK-UTXO architecture with Coinbase's x402 payment standard
to enable private, verifiable micropayments between autonomous agents.
PrivAgent is designed as the missing privacy layer for ERC-8004 agent identity
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

PrivAgent fills the missing privacy layer.

## The Solution

### PrivAgent: Private Payments for Base

PrivAgent brings Railgun-level privacy to Base's agent economy:

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
- Agent payments become PRIVATE (PrivAgent)
- "Verifiable agents, private payments"

**Circuit-Level Fee (V4.4)**
- Protocol fee enforced at ZK circuit level: `sum(inputs) + publicAmount = sum(outputs) + protocolFee`
- Fee collected on ALL transaction types including private transfers
- No way to bypass — mathematically enforced by zero-knowledge proof
- Fee: max(0.1%, $0.01 minimum)

**View Tags (V4.4)**
- 1-byte Poseidon-based tag for each encrypted note
- ~50x speedup for note scanning (500K notes → ~10K decrypt attempts)
- Privacy-preserving: nonce-based tags prevent recipient clustering

**Hybrid Relayer (V4.4)**
- Self-relay: server submits transactions directly
- External relay: server delegates to PrivAgent relayer — zero gas for API providers
- Agents operate with USDC only — no ETH funding required

**PrivAgent Facilitator (V4.4)**
- x402-standard compatible privacy facilitator
- Any x402 server adds privacy by changing one URL — zero code changes
- Endpoints: /verify (settle), /info (discovery), /health
- Scheme: `zk-exact-v2`

**ERC-8004 Level 1 Integration (V4.4)**
- Agent registration file spec with PrivAgent payment method
- Payment proof for feedback: nullifier-based sybil resistance
- Helper SDK: `privAgentPaymentMethod()`, `paymentProofForFeedback()`

**Security Hardening (V4.4)**
- 28 audit findings fixed across 3 deep audits (score: 7.5 → 9.0/10)
- On-chain TX verification before UTXO confirmation (prevents fake TX hash attacks)
- Race condition prevention: nullifier mutex for concurrent requests
- BN254 field-range validation for all nullifiers and commitments (on-chain)
- API key auth + per-IP rate limiting + SSRF protection on relayer/facilitator
- Timing-safe comparisons, 30s proof generation timeout, secp256k1 pubkey validation
- Build integrity: snarkjs zkey verify + PTAU SHA-256 hash check
- Mandatory verificationKeys config (prevents gas griefing attacks)

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

**Facilitator Mode (V4.4):**
```
Agent → x402 Server → PrivAgent Facilitator → pool.transact() → Base
(Server changes only facilitator URL — zero code changes for privacy)
```

### Privacy Model

| What | Visible? |
|------|----------|
| Agent uses PrivAgent (deposit) | Yes (acceptable, like using a bank) |
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
|  PrivAgent: Payment Privacy Layer         |
|  (ZK-UTXO + stealth + encrypted notes)  |
+------------------------------------------+
|  x402: Payment Protocol                  |
|  (HTTP 402 -> pay -> 200)                |
+------------------------------------------+
|  Base L2 (Coinbase)                      |
+------------------------------------------+
```

### Core Components

1. **ShieldedPoolV4** — Solidity contract managing the UTXO pool, Merkle tree (depth 20, ~1M leaves), nullifier tracking, protocol fees, field-range validation
2. **JoinSplit Circuits** — Circom/Groth16 circuits for 1x2 and 2x2 private transactions
3. **TypeScript SDK** — UTXO engine, note encryption (HKDF + AES-256-GCM), stealth addresses, Merkle tree sync, atomic note storage, timing-safe auth
4. **x402 Middleware** — Express middleware for API providers, payment verification, server-as-relayer
5. **Stealth Registry** — ECDH-based stealth address system for recipient privacy
6. **Relayer/Facilitator** — Hybrid relay system for gas-free agent payments, x402-compatible facilitator endpoint
7. **ERC-8004 Integration** — Agent registration helpers, payment proof for reputation feedback
8. **View Tags** — Note scanning optimization with 1-byte pre-filtering
9. **Structured Logger** — Configurable logging for all SDK operations

### Smart Contracts (Base Sepolia — Live)

| Contract | Address |
|----------|---------|
| ShieldedPoolV4 | `0x8F1ae8209156C22dFD972352A415880040fB0b0c` |
| Groth16Verifier_1x2 | `0xe473aF953d269601402DEBcB2cc899aB594Ad31e` |
| Groth16Verifier_2x2 | `0x10D5BB24327d40c4717676E3B7351D76deb33848` |
| PoseidonHasher | `0x3ae70C9741a9959fA32bC9BC09959d3d319Ee3Cd` |

All contracts verified on Blockscout. Deploy block: `38347380`.

## Revenue Model

### Fee Structure

| Fee Type | Amount | Recipient |
|----------|--------|-----------|
| Protocol fee (ALL transactions) | max(0.1%, $0.01) | Treasury (governance) |
| Relayer fee (per TX) | $0.01-0.05 | Server operator / Relayer |
| Facilitator fee | $0.01-0.05/TX | PrivAgent facilitator |
| Enterprise SDK license | $50K/year | PrivAgent team |

### Unit Economics

- Base L2 gas cost per TX: ~$0.02
- Protocol fee per TX: >= $0.01
- Relayer fee per TX: $0.01-0.05
- **Net margin per TX: positive from day 1**

### Market Context: The Agent Payment Explosion

The agent economy is experiencing exponential growth, validated by third-party data:

**x402 Protocol (Current State — Q1 2026):**
- $43M+ cumulative payment volume across all chains
- 140M+ transactions processed
- 406,700+ unique buyers, 81,000+ unique sellers
- ~500% year-over-year growth rate
- x402 Foundation members: Coinbase, Cloudflare, Google Cloud, Visa
- Stripe added x402 support in February 2026

*Sources: joinedcrypto.com (Jan 2026), FourWeekMBA (Mar 2026), Gate News (Dec 2025)*

**AI Agent Market:**
- $7.6B (2025) → projected $52-182B by 2030-2033 (45-50% CAGR)
- 1 billion+ AI agents projected operational by end of 2026 (IBM, Salesforce)
- a16z Crypto projects up to $30 trillion in autonomous transactions by 2030
- 50% of enterprises will deploy autonomous AI agents by 2027 (Deloitte)

*Sources: Grand View Research, MarketsandMarkets, Deloitte, a16z State of Crypto 2025*

**Key Catalysts (2026):**
- Stripe x402 integration → access to millions of existing merchants
- Google Cloud Agent Payments Protocol → enterprise adoption
- Visa as x402 Foundation member → traditional finance bridge
- Base leading x402 volume → Coinbase ecosystem advantage

### PrivAgent Revenue Model

**Fee Structure:** max(0.1%, $0.01 minimum) on ALL transactions (circuit-level enforcement)

**Revenue Streams:**
1. Protocol fee: Collected on every deposit, transfer, and withdrawal
2. Facilitator fee: $0.01-0.05/TX for privacy-as-a-service
3. Enterprise SDK: $50K/year per integration

### Growth Scenarios

**Assumptions:**
- Average x402 TX value: ~$0.30 (derived: $43M ÷ 140M TX = ~$0.31)
- x402 annual growth: 300-500% (based on observed 500% rate, discounted for maturation)
- PrivAgent privacy adoption: 3-10% of Base x402 volume (conservative — privacy is opt-in)
- Min fee ($0.01) applies to ~90% of transactions (micropayments dominant)

**2026 Conservative:**

| Metric | Value | Basis |
|--------|-------|-------|
| Total x402 volume (all chains) | ~$200M | $43M × 4-5x growth |
| Base share (~50%) | ~$100M | Base leads in x402 adoption |
| PrivAgent privacy share (3%) | ~$3M | Early adoption, few integrations |
| Transaction count | ~10M | $3M ÷ $0.30 avg |
| Protocol fee revenue | ~$100K | 10M TX × $0.01 min fee |
| Facilitator fee | ~$50K | Subset of TX through facilitator |
| Enterprise licenses | $50K | 1 integration |
| **Total revenue** | **~$200K** | |

**2026 Optimistic:**

| Metric | Value | Basis |
|--------|-------|-------|
| Total x402 volume (all chains) | ~$500M | Stripe + Google Cloud catalyst |
| Base share (~50%) | ~$250M | |
| PrivAgent privacy share (5%) | ~$12.5M | Agent frameworks integrated |
| Transaction count | ~40M | $12.5M ÷ $0.30 avg |
| Protocol fee revenue | ~$400K | 40M TX × $0.01 |
| Facilitator fee | ~$200K | |
| Enterprise licenses | $150K | 2-3 integrations |
| **Total revenue** | **~$750K** | |

**2027 Growth (if x402 reaches mainstream):**

| Metric | Value | Basis |
|--------|-------|-------|
| Total x402 volume (all chains) | ~$2-5B | Stripe + enterprise adoption at scale |
| Base share (~45%) | ~$1-2.25B | |
| PrivAgent privacy share (7%) | ~$70-160M | Privacy as default for agent fleets |
| Transaction count | ~230-530M | |
| Protocol fee revenue | ~$2.3-5.3M | |
| Facilitator + enterprise | ~$700K-1.5M | |
| **Total revenue** | **~$3-7M** | |

**2028+ Upside Scenario:**
- a16z projects $30T in autonomous transactions by 2030
- If even 0.1% flows through PrivAgent: $30B × 0.001 = $30M volume
- At $0.01/TX on 100M transactions: $1M protocol fee alone
- With enterprise + facilitator: $3-5M total

### Revenue Sensitivity Analysis

The dominant revenue driver is **transaction count**, not volume (because min fee applies to most micropayments):

| Metric | Impact on Revenue |
|--------|-------------------|
| 10M TX/year | ~$100K protocol fee |
| 50M TX/year | ~$500K protocol fee |
| 200M TX/year | ~$2M protocol fee |
| 500M TX/year | ~$5M protocol fee |
| 1B TX/year | ~$10M protocol fee |

For context: x402 already processes 140M+ cumulative transactions in its first 8 months. If PrivAgent captures even 1% of x402 transaction count, that's millions of transactions per year.

### Path to Profitability

| | Month 1-6 | Month 7-12 | Year 2 |
|---|-----------|------------|--------|
| Monthly cost | ~$150 | ~$300 | ~$500 |
| Monthly revenue | ~$0 | ~$5-20K | ~$50-250K |
| Status | Building | Break-even | Profitable |

**Key insight:** PrivAgent's operational costs are minimal (~$150/month for VPS + RPC). Even 500K transactions/month ($5K revenue) achieves profitability. This is achievable with a single agent framework integration.

### Operational Costs

| Item | Monthly Cost |
|------|-------------|
| Server (VPS) | $30-100 |
| RPC node | $0-49 |
| Gas (ETH for relaying) | Volume-dependent |
| **Total fixed** | **~$50-150/month** |

## Competitive Landscape

| Feature | PrivAgent | Railgun | Tornado Cash | Aztec |
|---------|----------|---------|-------------|-------|
| Base L2 | Yes | No | No (sanctioned) | No |
| x402 native | Yes | No | No | No |
| ERC-8004 compatible | Yes | No | No | No |
| Agent-first SDK | Yes | No | No | No |
| UTXO model | Yes | Yes | No (fixed amounts) | Yes |
| Encrypted amounts | Yes | Yes | No | Yes |
| Live on testnet | Yes | N/A | N/A | No (different chain) |
| Circuit-level fee | Yes (V4.4) | No | No | No |
| View tags | Yes (V4.4) | Yes | No | No |
| Hybrid relayer | Yes (V4.4) | Decentralized | N/A | N/A |
| x402 facilitator | Yes (V4.4) | No | No | No |
| No ETH required | Yes (V4.4) | No | No | No |
| Field-range validation | Yes (V4.4) | Yes | N/A | Yes |
| Audit score | 9.0/10 (V4.4) | N/A | N/A | N/A |

**PrivAgent is the only privacy protocol on Base with x402 and ERC-8004 integration.**

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
| Smart contract vulnerability | 3 deep audits (28 findings fixed, 9.0/10), 226 tests, professional audit planned |
| Market timing (early) | First-mover advantage, no competition on Base |
| Solo developer | 80+ PRs in major projects, proven execution, team expansion planned |

## Roadmap

| Phase | Timeline | Deliverables |
|-------|----------|-------------|
| **V4.3** | ✅ Complete | ZK-UTXO pool, x402 middleware, stealth addresses, protocol fees, Base Sepolia deployment |
| **V4.4** | ✅ Complete | Circuit-level fee, view tags (50x speedup), hybrid relayer, PrivAgent facilitator, ERC-8004 Level 1, security hardening (28 findings fixed, 9.0/10), 226 tests |
| **V4.5** | Weeks 1-8 (Program) | PrivAgent Facilitator deploy, ERC-8004 Level 2 (reputation + sybil resistance), POI implementation, multi-party trusted setup ceremony, professional security audit, Base mainnet deployment |
| **V5** | Months 6-12 | Decentralized relayer network (stake + slash), ZK reputation proofs (ERC-8004 Level 3), multi-token support |
| **V5+** | Year 2+ | Rapidsnark integration (optional faster proofs), facilitator network expansion, governance |

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
| PrivAgent development time | ~80 hours (V3 → V4.4) |
| Test coverage | 226 tests (117 Foundry + 109 SDK) |
| Internal audits completed | 3 deep audits (28 critical/high findings fixed) |
| Audit score | 7.5 → 9.0/10 after security hardening |
| Lines of Solidity | ~900+ |
| Lines of TypeScript | ~4000+ |
| Circom circuits | 2 (1x2 + 2x2 JoinSplit with protocolFee) |
| Documentation pages | 10+ (Protocol, Circuits, Stealth, Ceremony, POI Roadmap, Deep Audit, TODO, Roadmap, Lightpaper) |

## The Ask

**Base Batches Season 3 — What we've built and what we'll build:**

**Already built (V4.4 — complete):**
- Circuit-level fee enforcement on all transactions
- View tags for 50x note scanning optimization
- Hybrid relayer with external relay support
- x402-compatible PrivAgent Facilitator
- ERC-8004 Level 1 integration (registration + payment proof)
- Security hardening: 28 findings fixed (TX verification, race conditions, field-range validation, auth, rate limiting)
- 226 tests passing (117 Foundry + 109 SDK), 3 deep audits, score 9.0/10

**What we'll build in the program (V4.5):**

1. **PrivAgent Facilitator Deploy** — Any x402 server adds privacy by changing one URL. No code changes. Drop-in privacy-as-a-service.
2. **ERC-8004 Integration** — PrivAgent as the payment privacy layer for the 24,000+ registered agents. Verifiable agents, private payments.
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

- **GitHub**: https://github.com/Himess/privagent
- **Contracts (Base Sepolia)**: Verified on Blockscout
- **Documentation**: See /docs in repository

---

*PrivAgent is licensed under the Business Source License 1.1.
Commercial use requires a license. Converts to GPL-2.0 on March 1, 2028.*
