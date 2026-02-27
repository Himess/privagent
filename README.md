# GhostPay

Privacy-preserving x402 payment protocol on Base. AI agents pay for API access using ZK proofs — deposits are visible, but payments are unlinkable to the depositor.

## Architecture

```
Agent deposits USDC → ShieldedPool (Merkle tree)
                          ↓
Agent requests API → 402 (zk-exact scheme)
                          ↓
Agent creates ZK proof → Payment header
                          ↓
Relayer submits withdraw TX → USDC to seller
                          ↓
Agent gets API response ← 200 OK
```

**Core stack:** Poseidon hashing + Groth16 ZK proofs + ECDH stealth addresses + x402 HTTP payment protocol

## Packages

| Package | Description |
|---------|-------------|
| `contracts/` | Foundry — ShieldedPool, PoseidonHasher, StealthRegistry, Groth16Verifier |
| `circuits/` | Circom — privatePayment circuit (depth 20 Merkle tree) |
| `sdk/` | TypeScript SDK — poseidon, merkle, proof, notes, stealth, pool client, x402 modules |
| `relayer/` | Express 5 relayer — accepts proofs, submits withdrawals on-chain |
| `demo/` | Two-agent demo — seller (paywall) + buyer (ghostFetch) |

## Quick Start

```bash
# Install
pnpm install

# Build circuits (requires circom + snarkjs)
cd circuits && bash scripts/build.sh

# Build & test contracts
cd contracts && forge build && forge test -vvv

# Test SDK
cd sdk && pnpm test

# Test relayer
cd relayer && pnpm test

# Deploy to Base Sepolia
cd contracts && forge script script/Deploy.s.sol --rpc-url base-sepolia --broadcast --verify
```

## x402 `zk-exact` Scheme

GhostPay extends the x402 HTTP payment protocol with a ZK-native scheme:

```
GET /api/weather HTTP/1.1
→ 402 Payment Required
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "zk-exact",
    "network": "eip155:84532",
    "amount": "1000000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xSeller...",
    "poolAddress": "0xPool..."
  }]
}

→ Agent creates ZK proof, relayer submits withdraw TX
→ Retry with Payment header
→ 200 OK + data
```

## Gas Costs (Estimates)

| Operation | Gas |
|-----------|-----|
| Deposit | ~830K (Poseidon Merkle insert, depth 20) |
| Withdraw | ~1.5M (Groth16 verify + Merkle insert + USDC transfer) |

## Test Results

- **Contracts:** 14 tests passing (Foundry)
- **SDK:** 30 tests passing (vitest)
- **Relayer:** 5 tests passing (vitest + supertest)
- **Circuit:** 2 tests (requires build artifacts)

## Key Design Decisions

- **Variable amounts** — x402 needs arbitrary payment amounts (not fixed denominations)
- **Depth 20** — ~1M deposit anonymity set, Groth16 verify still constant ~224K gas
- **30-root history** — compact ring buffer for recent Merkle roots
- **Change commitments** — partial withdrawal support via circuit-computed `newCommitment`
- **Relayer model** — gas abstraction, agents don't need ETH for withdrawals

## Security Model

- On-chain Groth16 proof verification prevents invalid withdrawals
- Nullifier tracking prevents double-spending
- Poseidon commitments hide balance + randomness
- Stealth addresses enable private receiving
- Root history prevents front-running with stale roots

## License

MIT
