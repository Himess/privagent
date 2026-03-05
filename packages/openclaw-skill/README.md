# @privagent/openclaw-skill

OpenClaw skill for PrivAgent — manage private USDC payments on Base using ZK proofs.

## Setup

```bash
cd packages/openclaw-skill
npm install
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | ETH private key (hex) |
| `POSEIDON_PRIVATE_KEY` | Yes | Poseidon private key (bigint string) |
| `RPC_URL` | No | Base Sepolia RPC (default: `https://sepolia.base.org`) |
| `POOL_ADDRESS` | No | ShieldedPoolV4 address |
| `DEPLOY_BLOCK` | No | Block to start scanning from |
| `CIRCUIT_DIR` | No | Path to circuit build directory |

## Scripts

All scripts output JSON to stdout.

```bash
# Check shielded balance
npx tsx scripts/balance.ts

# Deposit USDC into shielded pool
npx tsx scripts/deposit.ts --amount 2

# Withdraw from shielded pool
npx tsx scripts/withdraw.ts --amount 1 --recipient 0x1234...

# Private transfer to another agent
npx tsx scripts/transfer.ts --amount 1 --pubkey 67890

# Pool and wallet info
npx tsx scripts/info.ts
```

## Tests

```bash
npm test
```

## License

BUSL-1.1
