# PrivAgent Development Guide

## Prerequisites

- Node.js 20+
- pnpm 9+
- Foundry (forge, cast, anvil)
- circom 2.0+ (only for circuit compilation)
- snarkjs 0.7+ (only for circuit compilation)

## Setup

```bash
# Clone
git clone https://github.com/Himess/privagent.git
cd privagent

# Install dependencies
pnpm install

# Copy env
cp .env.example .env
# Edit .env with your keys
```

## Contracts

```bash
cd contracts

# Build
forge build

# Test
forge test -vvv

# Deploy (requires PRIVATE_KEY in .env)
forge script script/DeployV4.s.sol --rpc-url base-sepolia --broadcast
```

## SDK

```bash
cd sdk

# Build
pnpm build

# Test (109 tests)
pnpm test

# Type check
pnpm tsc --noEmit
```

## Circuits

Only needed if modifying circuit logic:

```bash
cd circuits

# Install circomlib
npm install

# Build V4 circuits (1x2 + 2x2)
bash scripts/build-v4.sh
```

## Demo (E2E on Base Sepolia)

```bash
# Run full E2E test
PRIVATE_KEY=0x... npx tsx demo/e2e-v4-test.ts

# Run seller + buyer separately
cd demo
pnpm seller-v4  # starts Express server on :3001
pnpm buyer-v4   # deposits + pays via privAgentFetch
```

## Project Structure

```
privagent/
  contracts/   Foundry — ShieldedPoolV4, PoseidonHasher, Verifiers
  circuits/    Circom — JoinSplit (1x2, 2x2), MerkleProof
  sdk/         TypeScript SDK — v4/ + x402/
  demo/        E2E examples
  relayer/     Deprecated (replaced by server-as-relayer)
  docs/        Protocol specs
```

## Testing

```bash
# All contract tests
cd contracts && forge test -vvv

# All SDK tests
cd sdk && pnpm test

# Specific test file
cd sdk && pnpm vitest run src/v4/utxo.test.ts
```

## Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `PRIVATE_KEY` | Deployer/relayer wallet |
| `BASE_SEPOLIA_RPC` | RPC endpoint |
| `BASESCAN_API_KEY` | Contract verification |
