# PrivAgent Protocol Overview

PrivAgent is a privacy-preserving payment protocol for AI agents on Base, using ZK proofs to enable private USDC transactions.

## Architecture

- **ShieldedPoolV4**: On-chain smart contract that holds shielded USDC deposits
- **JoinSplit UTXO Model**: Private balances are tracked as encrypted UTXOs (Unspent Transaction Outputs)
- **Groth16 ZK Proofs**: Every transaction (deposit, withdraw, transfer) generates a zero-knowledge proof
- **Poseidon Hash**: Privacy-preserving hash function used for commitments and nullifiers
- **Merkle Tree**: Depth-20 tree storing all commitments, enabling membership proofs

## Key Concepts

### Deposit
Public USDC is locked in the ShieldedPoolV4 contract. A new UTXO commitment is added to the Merkle tree, representing the shielded balance.

### Withdraw
A ZK proof demonstrates ownership of a UTXO without revealing which one. The pool releases public USDC to the specified recipient address.

### Private Transfer
Shielded-to-shielded transfer. The sender proves ownership of input UTXOs and creates new output UTXOs for the recipient. Amount, sender, and receiver are hidden on-chain.

### Balance
Scanning on-chain events to find UTXOs belonging to the wallet's Poseidon keypair. Only the wallet owner can decrypt and identify their UTXOs.

## Contracts (Base Sepolia)

- **ShieldedPoolV4**: `0x8F1ae8209156C22dFD972352A415880040fB0b0c`
- **USDC**: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **Deploy Block**: 38347380

## Protocol Fee

- 0.1% (10 bps) with 0.01 USDC minimum
- Circuit-enforced (part of the ZK proof public signals)
- Surplus goes to the treasury
