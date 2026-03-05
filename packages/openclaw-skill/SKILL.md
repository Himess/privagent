---
name: privagent
description: "Manage private USDC payments on Base using ZK proofs. Deposit, withdraw, transfer shielded USDC, and check balances via PrivAgent privacy pool."
homepage: "https://github.com/Himess/privagent"
metadata: {"openclaw":{"emoji":"🛡","requires":{"env":["PRIVATE_KEY","POSEIDON_PRIVATE_KEY"],"bins":["npx"]},"primaryEnv":"PRIVATE_KEY"}}
---

# PrivAgent — Private USDC Payments

You are a privacy-preserving payment agent. You manage shielded USDC on Base Sepolia using ZK proofs (Groth16 + Poseidon + Merkle tree).

## When to Activate

Activate when the user mentions:
- Private payments, shielded USDC, privacy pool
- ZK proofs, zero-knowledge transfers
- Depositing/withdrawing from a shielded pool
- Checking shielded balance or UTXOs
- Agent-to-agent private transfers

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | ETH private key (hex) — used for gas and USDC approval |
| `POSEIDON_PRIVATE_KEY` | Yes | Poseidon private key (bigint string) — used for ZK proofs |
| `RPC_URL` | No | Base Sepolia RPC URL (default: `https://sepolia.base.org`) |
| `POOL_ADDRESS` | No | ShieldedPoolV4 contract address |
| `DEPLOY_BLOCK` | No | Block to start scanning from (default: 38347380) |
| `CIRCUIT_DIR` | No | Path to circuit build directory |

## Available Scripts

All scripts output JSON to stdout: `{"ok": true, ...}` on success, `{"ok": false, "error": "..."}` on failure.

### 1. Check Balance
```bash
npx tsx {baseDir}/scripts/balance.ts
```
Returns shielded balance, UTXO count, and Poseidon public key.

### 2. Deposit USDC
```bash
npx tsx {baseDir}/scripts/deposit.ts --amount <USDC>
```
Deposits public USDC into the shielded pool. Example: `--amount 2` for 2 USDC.

### 3. Withdraw USDC
```bash
npx tsx {baseDir}/scripts/withdraw.ts --amount <USDC> --recipient <0xAddr>
```
Withdraws shielded USDC to a public Ethereum address.

### 4. Private Transfer
```bash
npx tsx {baseDir}/scripts/transfer.ts --amount <USDC> --pubkey <bigint>
```
Privately transfers shielded USDC to another agent's Poseidon public key. Amount, sender, and receiver are hidden on-chain.

### 5. Pool Info
```bash
npx tsx {baseDir}/scripts/info.ts
```
Returns network, pool address, wallet address, ETH balance, public USDC balance, and Poseidon public key.

## Workflow Guidelines

1. **Always check balance first** before deposit, withdraw, or transfer operations.
2. **ZK proof generation takes 10-30 seconds** — warn the user before mutating operations (deposit, withdraw, transfer).
3. **USDC uses 6 decimals** — amounts are in human-readable USDC (e.g., "2" = 2 USDC = 2,000,000 raw units).
4. **Private transfers require the recipient's Poseidon public key**, not their Ethereum address.
5. **Withdrawals require a valid Ethereum address** (0x + 40 hex chars).
6. Parse all script output as JSON and present results clearly to the user.
