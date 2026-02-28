# GhostPay Basic Transfer — Private USDC

Deposit, privately transfer, and withdraw USDC using GhostPay.

## Setup

```bash
npm install ghostpay-sdk ethers
```

## Flow

```
1. Deposit USDC → ShieldedPoolV4 (public deposit, creates shielded UTXO)
2. Private transfer → another agent's pubkey (hidden amount, hidden parties)
3. Withdraw → recipient address (public withdrawal, amount revealed)
```

## Key Concepts

- **UTXO Model**: Each deposit creates output UTXOs (commitments in Merkle tree)
- **JoinSplit**: Spend N inputs, create M outputs (1x2 or 2x2 circuits)
- **publicAmount=0**: Private transfers don't move USDC on-chain
- **Nullifiers**: Prevent double-spending of UTXOs
- **Note Encryption**: ECDH + AES-256-GCM for private note sharing
