# GhostPay Protocol Specification

## Overview

GhostPay implements a privacy-preserving payment protocol for HTTP 402 flows. It combines:

- **Poseidon hash commitments** for hiding note values
- **Groth16 ZK proofs** for proving note ownership without revealing the note
- **Merkle tree inclusion** for proving a commitment exists in the pool
- **Nullifier tracking** for preventing double-spends
- **ECDH stealth addresses** for private receiving

## `zk-exact` Scheme

### Wire Format

The `zk-exact` scheme extends x402 V2 with ZK proof payloads.

#### 402 Response (Server → Client)

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "zk-exact",
      "network": "eip155:84532",
      "amount": "1000000",
      "payTo": "0xRecipientAddress",
      "maxTimeoutSeconds": 300,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "poolAddress": "0xShieldedPoolAddress",
      "relayer": "0xRelayerAddress",
      "relayerFee": "50000"
    }
  ],
  "resource": {
    "url": "https://api.example.com/data",
    "method": "GET"
  }
}
```

#### Payment Header (Client → Server)

Base64-encoded JSON in the `Payment` HTTP header:

```json
{
  "x402Version": 2,
  "accepted": { "...same as requirement..." },
  "payload": {
    "from": "shielded",
    "nullifierHash": "123...",
    "newCommitment": "456...",
    "merkleRoot": "789...",
    "proof": "0xTxHash",
    "relayer": "0xRelayerAddress",
    "fee": "50000"
  }
}
```

### Payment Flow

1. **Agent** sends HTTP request to paid endpoint
2. **Server** responds 402 with `zk-exact` requirements
3. **Agent** selects matching requirement, creates ZK proof
4. **Relayer** submits `ShieldedPool.withdraw()` on-chain
5. **Agent** retries request with `Payment` header containing proof TX
6. **Server** verifies payment was settled, returns data

## ShieldedPool Contract

### State

- **Merkle tree**: depth 20, Poseidon hash, tracks all commitments
- **Root history**: ring buffer of 30 recent roots
- **Nullifier set**: spent nullifier hashes (prevents double-spend)
- **Commitment set**: existing commitments (prevents duplicates)

### deposit(amount, commitment)

1. Transfer USDC from sender to pool
2. Insert commitment into Merkle tree
3. Record commitment in set
4. Emit `Deposited` event

### withdraw(recipient, amount, nullifierHash, newCommitment, merkleRoot, relayer, fee, proof[8])

1. Verify nullifier not spent
2. Verify merkleRoot is in root history
3. Verify Groth16 proof on-chain with 7 public signals
4. Mark nullifier as spent
5. Insert change commitment (if non-zero)
6. Transfer `amount` USDC to recipient
7. Transfer `fee` USDC to relayer

### Public Signal Order

snarkjs puts circuit outputs before inputs:

| Index | Signal | Type |
|-------|--------|------|
| 0 | newCommitment | output |
| 1 | root | public input |
| 2 | nullifierHash | public input |
| 3 | recipient | public input |
| 4 | amount | public input |
| 5 | relayer | public input |
| 6 | fee | public input |

## Security Considerations

### Privacy Guarantees

- **Deposit amounts visible** — on-chain USDC transfer is public
- **Withdrawals unlinkable** — ZK proof reveals nothing about the source note
- **Relayer knows recipient** — but not the depositor
- **Change commitments** — enable partial spends without revealing balance

### Attack Vectors

- **Double-spend**: Prevented by nullifier set (on-chain mapping)
- **Root front-running**: Mitigated by 30-root history buffer
- **Proof forgery**: Prevented by on-chain Groth16 verification
- **Relayer censorship**: Anyone can run a relayer
- **Amount correlation**: Variable amounts reduce correlation attacks

### Trust Assumptions

- Circuit trusted setup (Powers of Tau ceremony)
- Poseidon hash security (algebraic hash, well-studied)
- BN254 curve security (128-bit)
- Groth16 soundness
