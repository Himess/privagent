# GhostPay Protocol Specification (V3)

## Overview

GhostPay implements a privacy-preserving payment protocol for HTTP 402 flows. It combines:

- **Poseidon(3) hash commitments** for binding amount + nullifierSecret + randomness
- **Groth16 ZK proofs** for proving note ownership without revealing the note
- **Merkle tree inclusion** for proving a commitment exists in the pool
- **Nullifier tracking** for preventing double-spends
- **secp256k1 ECDH stealth addresses** for private receiving
- **Server-as-relayer** — buyer sends raw proof, server submits withdrawal on-chain

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
      "relayerFee": "50000",
      "stealthMetaAddress": {
        "spendingPubKey": "0x04abc...",
        "viewingPubKey": "0x04def..."
      }
    }
  ],
  "resource": {
    "url": "https://api.example.com/data",
    "method": "GET"
  }
}
```

#### Payment Header (Client → Server)

Base64-encoded JSON in the `Payment` HTTP header (using `Buffer.from().toString("base64")`):

```json
{
  "x402Version": 2,
  "accepted": { "...same as requirement..." },
  "payload": {
    "from": "shielded",
    "nullifierHash": "123456789...",
    "newCommitment": "987654321...",
    "merkleRoot": "555...",
    "recipient": "0xStealthAddress",
    "amount": "1000000",
    "proof": ["1234...", "5678...", "9012...", "3456...", "7890...", "1234...", "5678...", "9012..."],
    "relayer": "0xRelayerAddress",
    "fee": "50000",
    "ephemeralPubKey": "0x04..."
  }
}
```

Key V3 changes:
- `proof` is `string[]` (8 bigint elements), not a TX hash
- `recipient` is included (stealth address)
- `amount` is included for server validation
- `ephemeralPubKey` is a single compressed/uncompressed public key string
- Encoding uses `Buffer` (not `btoa/atob`) for proper binary handling

### Payment Flow (V3 — Server-as-Relayer)

1. **Agent** sends HTTP request to paid endpoint
2. **Server** responds 402 with `zk-exact` requirements (includes stealthMetaAddress)
3. **Agent** derives stealth address via ECDH, generates ZK proof client-side (no TX)
4. **Agent** retries request with `Payment` header containing raw proof
5. **Server** decodes proof, runs pre-flight checks (root known? nullifier unused?)
6. **Server** calls `ShieldedPool.withdraw()` on-chain as relayer
7. **Server** sets `X-Payment-TxHash` response header, returns data

### Differences from Standard x402

| Aspect | Standard x402 | GhostPay zk-exact |
|--------|---------------|-------------------|
| Payment | ERC-3009 transfer | ZK proof + on-chain withdraw |
| Privacy | Public transfer | Unlinkable to depositor |
| Gas | Buyer pays | Server pays (relayer) |
| Proof | TX hash | 8 bigint array |
| Recipient | Direct address | Stealth address (ECDH) |

## ShieldedPool Contract (V3)

### Security Features

- `ReentrancyGuard` — prevents reentrancy on deposit/withdraw (H1)
- `Pausable` — emergency circuit breaker, owner-only (H3)
- `Ownable` — access control for pause/unpause
- Custom errors — gas-efficient error handling (L2)
- Indexed events — efficient log filtering (L1)
- `MAX_DEPOSIT = 1_000_000_000_000` — 1M USDC cap (M6)

### State

- **Merkle tree**: depth 20, Poseidon hash, ~1M leaf capacity
- **Root history**: ring buffer of 100 recent roots (M1)
- **Nullifier set**: spent nullifier hashes (prevents double-spend)
- **Commitment set**: existing commitments

### deposit(amount, commitment)

1. Validate: amount > 0, amount <= MAX_DEPOSIT, commitment != 0
2. Transfer USDC from sender to pool
3. Insert commitment into Merkle tree
4. Emit `Deposited(commitment, leafIndex, amount, timestamp)` event

### withdraw(recipient, amount, nullifierHash, newCommitment, merkleRoot, relayer, fee, proof[8])

1. Verify nullifier not spent
2. Verify merkleRoot is in root history (100 entries)
3. Verify recipient != address(0), amount > 0
4. Verify pool has sufficient balance for amount + fee
5. Verify Groth16 proof on-chain with 7 public signals
6. Mark nullifier as spent (effects before interactions — CEI)
7. Insert change commitment if non-zero
8. Transfer `amount` USDC to recipient
9. Transfer `fee` USDC to relayer (if fee > 0)

### Public Signal Order

snarkjs puts circuit outputs before inputs:

| Index | Signal | Type |
|-------|--------|------|
| 0 | newCommitment | output (conditional: hash or 0) |
| 1 | root | public input |
| 2 | nullifierHash | public input |
| 3 | recipient | public input |
| 4 | amount | public input |
| 5 | relayer | public input |
| 6 | fee | public input |

## Commitment Scheme (V3)

```
commitment = Poseidon(amount, nullifierSecret, randomness)     // 3-input Poseidon
nullifierHash = Poseidon(nullifierSecret, commitment)          // 2-input Poseidon
newCommitment = isFullSpend ? 0 : Poseidon(change, newSecret, newRandom)
```

The 3-input commitment binds the amount to the note (C7 fix) and includes the nullifier secret (C6 fix). This prevents:
- Depositing 1 USDC but claiming a 1000 USDC balance in the proof
- Creating two valid nullifiers for the same commitment

## Security Considerations

### Privacy Guarantees

- **Deposit amounts visible** — on-chain USDC transfer is public
- **Withdrawals unlinkable** — ZK proof reveals nothing about the source note
- **Server knows stealth recipient** — but cannot link it to the depositor
- **Change commitments** — enable partial spends without revealing balance
- **Stealth addresses** — each payment goes to a fresh one-time address

### Attack Mitigations

| Attack | Mitigation |
|--------|-----------|
| Double-spend | Nullifier set (on-chain mapping) |
| Root front-running | 100-root history buffer (M1) |
| Proof forgery | On-chain Groth16 verification |
| Gas griefing | Pre-flight root + nullifier checks (H2) |
| Reentrancy | OpenZeppelin ReentrancyGuard (H1) |
| Concurrent double-spend | Note locking with pendingNullifiers (C4) |
| Amount inflation | Poseidon(3) amount binding + circuit enforcement (C6+C7) |
| Information leakage | Generic error messages (L6) |
| Field overflow | Poseidon input bounds checking (H9) |

### Trust Assumptions

- Circuit trusted setup (Hermez Powers of Tau + single Phase 2 contributor)
- Poseidon hash security (algebraic hash, well-studied over BN254)
- BN254 curve security (~128-bit)
- Groth16 soundness
- Server honesty (relayer submits withdrawal correctly)
