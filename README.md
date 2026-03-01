<div align="center">

# GhostPay

**Privacy Infrastructure for the Agent Economy**

*The missing privacy layer for x402 payments and ERC-8004 agents on Base*

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-259%20passing-brightgreen)]()
[![Base Sepolia](https://img.shields.io/badge/Base%20Sepolia-Live-blue)]()
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178c6)]()

[Light Paper](docs/LIGHTPAPER.md) · [Documentation](docs/) · [Examples](examples/)

</div>

---

## The Problem

AI agents transact $50M+ through x402 payments on Base — all publicly visible. Every agent's strategy, spending pattern, and business relationships are exposed on-chain. GhostPay fixes this.

## The Solution

GhostPay brings **Railgun-level privacy** to Base's agent economy:

- **ZK-UTXO Architecture** — Groth16 proofs, Poseidon hashing, encrypted amounts
- **x402 Native** — Drop-in middleware for any x402 API server
- **ERC-8004 Compatible** — Verifiable agents, private payments
- **Agent-First SDK** — Privacy payments with the ShieldedWallet API

```typescript
import { ShieldedWallet } from 'ghostpay-sdk';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

const wallet = new ShieldedWallet({
  provider,
  signer,
  poolAddress: '0x17B6209385c2e36E6095b89572273175902547f9',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  circuitDir: './circuits/build',
});
await wallet.initialize();
await wallet.deposit(10_000_000n);  // 10 USDC -> shielded
```

## Architecture

```
+-----------------------------------+
|  Agent Frameworks                 |
|  (Virtuals, ElizaOS, GAME)       |
+-----------------------------------+
|  ERC-8004: Identity + Trust       |
+-----------------------------------+
|  GhostPay: Privacy Layer          |
+-----------------------------------+
|  x402: Payment Protocol           |
+-----------------------------------+
|  Base L2                          |
+-----------------------------------+
```

## Privacy Model

| What | Visible? |
|------|----------|
| Payment amount | Hidden (encrypted + ZK) |
| Payment recipient | Hidden (stealth addresses) |
| Payment sender | Hidden (nullifier-based) |
| Transaction links | Broken (UTXO model) |
| Agent identity | Public (ERC-8004) |

## Quick Start

### For API Providers (Server)

Add private payments to your x402 API with the V4 middleware:

```typescript
import express from 'express';
import { ghostPaywallV4 } from 'ghostpay-sdk/x402';

const app = express();

app.use('/api/weather', ghostPaywallV4({
  poolAddress: '0x17B6209385c2e36E6095b89572273175902547f9',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  signer,          // ethers.Signer for on-chain relay
  price: '1000000' // 1 USDC (6 decimals)
}));

app.get('/api/weather', (req, res) => {
  res.json({ temp: 22, city: 'Istanbul' });
});
```

### For Agent Developers (Client)

```typescript
import { ShieldedWallet } from 'ghostpay-sdk';
import { ghostFetchV4, createGhostFetchV4 } from 'ghostpay-sdk/x402';

// Initialize wallet
const wallet = new ShieldedWallet({ provider, signer, poolAddress, usdcAddress, circuitDir });
await wallet.initialize();
await wallet.syncTree();

// Deposit once
await wallet.deposit(10_000_000n);  // 10 USDC

// Private API payment (x402 flow: 402 -> ZK proof -> private payment -> 200)
const fetch = createGhostFetchV4(wallet);
const response = await fetch('https://api.example.com/weather');
```

## Project Structure

```
ghostpay/
├── contracts/          # Solidity — ShieldedPoolV4, Verifiers, PoseidonHasher
│   ├── src/            # Contract source files
│   └── test/           # Foundry tests (132 tests)
├── circuits/           # Circom — JoinSplit (1x2, 2x2)
│   ├── src/            # Circuit source
│   └── build/          # Compiled circuits + verification keys
├── sdk/                # TypeScript SDK
│   ├── src/v4/         # UTXO engine, encryption, stealth (active)
│   ├── src/x402/       # x402 middleware + client (active)
│   └── src/legacy/     # V3 (deprecated)
├── app/                # Demo web app (Next.js 14)
├── examples/           # Integration examples
│   ├── virtuals-integration/
│   ├── eliza-plugin/
│   ├── express-server/
│   └── basic-transfer/
├── demo/               # E2E test scripts
└── docs/               # Protocol documentation
    ├── LIGHTPAPER.md
    ├── PROTOCOL.md
    ├── CIRCUITS.md
    ├── STEALTH.md
    └── POI-ROADMAP.md
```

## Contracts (Base Sepolia)

| Contract | Address | Verified |
|----------|---------|----------|
| ShieldedPoolV4 | `0x17B6209385c2e36E6095b89572273175902547f9` | Yes |
| Groth16Verifier_1x2 | `0xe473aF953d269601402DEBcB2cc899aB594Ad31e` | Yes |
| Groth16Verifier_2x2 | `0x10D5BB24327d40c4717676E3B7351D76deb33848` | Yes |
| PoseidonHasher | `0x3ae70C9741a9959fA32bC9BC09959d3d319Ee3Cd` | Yes |

Deploy block: `38256581`

## V3 vs V4

| Aspect | V3 (old) | V4 (current) |
|--------|----------|--------------|
| Model | Single-note withdraw | UTXO JoinSplit (N->M) |
| Amounts | PUBLIC in withdraw() | HIDDEN (publicAmount=0) |
| Verification | On-chain only | Off-chain note decryption + on-chain proof |
| Entry point | deposit() + withdraw() | transact() (single entry) |
| Tree depth | 20 (~1M leaves) | 20 (~1M leaves) |
| Circuits | 1 (privatePayment) | 2 (joinSplit_1x2, joinSplit_2x2) |
| Coin selection | Single note | Multi-UTXO (exact/smallest/accumulate) |
| Note encryption | None | ECDH + HKDF + AES-256-GCM |
| Scheme | zk-exact | zk-exact-v2 |
| Protocol fee | None | 0.1% (configurable) |

## Testing

```bash
# Foundry tests (contracts — 132 tests)
cd contracts && forge test -vvv

# SDK tests (TypeScript — 116 tests)
cd sdk && pnpm test

# Run E2E on Base Sepolia
PRIVATE_KEY=0x... npx tsx demo/e2e-v4-test.ts
```

**Total: 259 tests** (132 Foundry + 127 SDK)

## Fee Structure

| Fee | Amount | Recipient |
|-----|--------|-----------|
| Protocol fee | max(0.1%, $0.005) | Treasury |
| Relayer fee | $0.01-0.05/TX | Server operator |

Protocol fees apply to deposits and withdrawals. Private transfers are fee-free in V4.

## Roadmap

| Phase | Status | Features |
|-------|--------|----------|
| V4.3 | Live | ZK-UTXO, x402 middleware, stealth, protocol fees, BSL-1.1 |
| V4.5 | Building | GhostPay Facilitator, ERC-8004 integration, POI, mainnet |
| V5 | Planned | Decentralized relayers, ZK reputation, multi-token, view tags |

[Full roadmap](docs/LIGHTPAPER.md#roadmap)

## Documentation

| Document | Description |
|----------|-------------|
| [Light Paper](docs/LIGHTPAPER.md) | Vision, architecture, revenue model |
| [Protocol](docs/PROTOCOL.md) | Technical protocol specification |
| [Circuits](docs/CIRCUITS.md) | ZK circuit design and constraints |
| [Stealth](docs/STEALTH.md) | Stealth address system |
| [Trusted Setup](circuits/CEREMONY.md) | Trusted setup ceremony guide |
| [POI Roadmap](docs/POI-ROADMAP.md) | Proof of Innocence design |
| [Audit Report](AUDIT.md) | Internal audit findings |

## Integration Examples

| Example | Description |
|---------|-------------|
| [Virtuals Integration](examples/virtuals-integration/) | Add GhostPay to Virtuals agents |
| [ElizaOS Plugin](examples/eliza-plugin/) | ElizaOS action plugin |
| [Express Server](examples/express-server/) | Privacy paywall middleware |
| [Basic Transfer](examples/basic-transfer/) | Deposit -> transfer -> withdraw |

## Security

- 2 internal security audits completed (46+ findings resolved)
- 259 tests passing (132 Foundry + 127 SDK)
- Professional audit planned pre-mainnet
- Bug reports: security@ghostpay.xyz

## License

Licensed under [Business Source License 1.1](LICENSE).

| Use | Allowed? |
|-----|----------|
| Read and audit code | Yes |
| Deploy on testnets | Yes |
| Personal/non-commercial | Yes |
| Academic research | Yes |
| Security research | Yes |
| Contribute | Yes |
| Commercial mainnet deployment | License required |
| Commercial hosted service | License required |

Converts to GPL-2.0 on **March 1, 2028**.

For commercial licensing: license@ghostpay.xyz

---

<div align="center">

**Built for [Base Batches Season 3](https://base.org/batches)**

Privacy infrastructure for the next generation of autonomous agents.

</div>
