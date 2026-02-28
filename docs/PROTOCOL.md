# GhostPay Protocol Specification

## Overview

GhostPay implements a privacy-preserving payment protocol for HTTP 402 flows. V4 uses a UTXO JoinSplit model where all transfer amounts are **hidden on-chain**.

**V3 → V4 upgrade:** Single-note withdraw (amounts PUBLIC) replaced with JoinSplit UTXO (amounts HIDDEN via `publicAmount=0` + encrypted note verification).

### Core Components

- **Poseidon(3) UTXO commitments** for binding amount + pubkey + blinding
- **JoinSplit Groth16 proofs** for proving UTXO ownership and balance conservation
- **Merkle tree inclusion** (depth 16) for proving a commitment exists in the pool
- **Nullifier tracking** for preventing double-spends
- **ECDH note encryption** (AES-256-GCM) for private amount verification
- **extDataHash binding** for preventing front-running
- **Server-as-relayer** — buyer sends raw proof, server submits on-chain

---

## `zk-exact-v2` Scheme (V4)

### Wire Format

The `zk-exact-v2` scheme extends x402 with JoinSplit ZK proof payloads and encrypted UTXO notes.

#### 402 Response (Server → Client)

```json
{
  "x402Version": 4,
  "accepts": [
    {
      "scheme": "zk-exact-v2",
      "network": "eip155:84532",
      "amount": "1000000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "poolAddress": "0x17B6209385c2e36E6095b89572273175902547f9",
      "payToPubkey": "12345678901234567890...",
      "serverEcdhPubKey": "0x02abc...",
      "relayer": "0xRelayerAddress",
      "relayerFee": "0"
    }
  ]
}
```

Key V4 fields:
- `x402Version: 4` (was 2 in V3)
- `scheme: "zk-exact-v2"` (was `"zk-exact"` in V3)
- `payToPubkey` — server's Poseidon public key (bigint string) for receiving shielded UTXOs
- `serverEcdhPubKey` — server's secp256k1 compressed public key (hex) for ECDH note decryption
- No `payTo` or `stealthMetaAddress` (V3 fields removed)

#### Payment Header (Client → Server)

Base64-encoded JSON in the `Payment` HTTP header:

```json
{
  "x402Version": 4,
  "scheme": "zk-exact-v2",
  "payload": {
    "proof": ["1234...", "5678...", "9012...", "3456...", "7890...", "1234...", "5678...", "9012..."],
    "root": "555...",
    "publicAmount": "0",
    "extDataHash": "789...",
    "nullifiers": ["123...", "456..."],
    "commitments": ["789...", "012..."],
    "nIns": 1,
    "nOuts": 2,
    "extData": {
      "recipient": "0x0000000000000000000000000000000000000000",
      "relayer": "0xRelayerAddress",
      "fee": "0",
      "encryptedOutput1": "0xaabb...",
      "encryptedOutput2": "0xccdd..."
    },
    "senderEcdhPubKey": "0x03def..."
  }
}
```

Key V4 changes from V3:
- `proof` is `string[8]` — Groth16 proof (pA[2] + pB[4] + pC[2]), pB swapped for Solidity
- `nullifiers` and `commitments` are arrays (variable-length per circuit)
- `nIns`/`nOuts` — circuit configuration (1x2 or 2x2)
- `extData` — complete external data with encrypted output notes
- `senderEcdhPubKey` — buyer's compressed secp256k1 public key (for ECDH decryption)
- `publicAmount: "0"` for all private transfers (amounts HIDDEN)
- No `recipient`/`amount` in payload (amount verified via note decryption)

---

### Payment Flow (V4 — JoinSplit)

```
1. Agent → Server:  GET /api/weather
2. Server → Agent:  402 { x402Version: 4, accepts: [{ scheme: "zk-exact-v2", ... }] }
3. Agent:           Parse requirements, select matching scheme
4. Agent:           Coin selection (exact → smallest → accumulate)
5. Agent:           Create output UTXOs (payment to server pubkey + change to self)
6. Agent:           Encrypt output notes via ECDH (buyer priv × server pub)
7. Agent:           Compute extDataHash = keccak256(recipient, relayer, fee, hash(enc1), hash(enc2)) % FIELD_SIZE
8. Agent:           Generate JoinSplit proof (publicAmount=0, all amounts private)
9. Agent → Server:  Retry with Payment header (base64 V4PaymentPayload)
10. Server:         Decode Payment header, validate structure
11. Server:         Decrypt encrypted output note via ECDH (server priv × buyer pub)
12. Server:         Verify decrypted amount >= required price
13. Server:         Pre-flight: isKnownRoot() + nullifier check
14. Server:         Off-chain proof verify (snarkjs groth16.verify)
15. Server:         Submit transact() on-chain as relayer
16. Server → Agent: 200 OK + X-Payment-TxHash header
```

### Differences from V3

| Aspect | V3 (zk-exact) | V4 (zk-exact-v2) |
|--------|---------------|-------------------|
| Amounts | PUBLIC in withdraw() | HIDDEN (publicAmount=0) |
| Entry point | withdraw(recipient, amount, ...) | transact(args, extData) |
| Verification | On-chain proof only | Note decryption + on-chain proof |
| Payload | nullifierHash, newCommitment, amount | nullifiers[], commitments[], extData |
| Stealth | ECDH stealth addresses | ECDH note encryption |
| Encoding | Buffer.from base64 | Buffer.from base64 |

### Differences from Standard x402

| Aspect | Standard x402 | GhostPay zk-exact-v2 |
|--------|---------------|----------------------|
| Payment | ERC-3009 transfer | JoinSplit ZK proof |
| Privacy | Public transfer | All amounts HIDDEN |
| Gas | Buyer pays | Server pays (relayer) |
| Proof | TX hash | 8-element bigint array |
| Amount verification | On-chain transfer | Off-chain note decryption |

---

## ShieldedPoolV4 Contract

### transact() — Single Entry Point

All operations (deposit, transfer, withdraw) go through a single `transact()` function:

```solidity
function transact(TransactArgs calldata args, ExtData calldata extData) external
```

#### TransactArgs

| Field | Type | Description |
|-------|------|-------------|
| `pA` | `uint256[2]` | Groth16 proof point A |
| `pB` | `uint256[2][2]` | Groth16 proof point B |
| `pC` | `uint256[2]` | Groth16 proof point C |
| `root` | `bytes32` | Merkle tree root |
| `publicAmount` | `int256` | >0 deposit, <0 withdraw, 0 transfer |
| `extDataHash` | `bytes32` | Hash of external data |
| `inputNullifiers` | `bytes32[]` | Spent UTXO nullifiers |
| `outputCommitments` | `bytes32[]` | New UTXO commitments |

#### ExtData

| Field | Type | Description |
|-------|------|-------------|
| `recipient` | `address` | Withdraw recipient (address(0) for transfer) |
| `relayer` | `address` | Relayer address |
| `fee` | `uint256` | Relayer fee |
| `encryptedOutput1` | `bytes` | Encrypted UTXO data for output 1 |
| `encryptedOutput2` | `bytes` | Encrypted UTXO data for output 2 |

### transact() Logic

1. Validate `extDataHash == keccak256(abi.encode(recipient, relayer, fee, keccak256(enc1), keccak256(enc2))) % FIELD_SIZE`
2. Validate all input nullifiers are unused
3. Validate root is in 100-entry history buffer
4. Select verifier by circuit config key (`nIns * 10 + nOuts`)
5. Build public signals and verify Groth16 proof on-chain
6. Mark all input nullifiers as spent, emit `NewNullifier` events
7. Insert all output commitments into Merkle tree, emit `NewCommitment` events
8. Handle public amount:
   - `publicAmount > 0`: deposit — transferFrom(sender, pool, amount)
   - `publicAmount < 0`: withdraw — transfer to recipient, fee to relayer
   - `publicAmount == 0`: pure private transfer (no USDC movement)

### Public Signal Order (V4)

| Index | Signal | Description |
|-------|--------|-------------|
| 0 | `root` | Merkle tree root |
| 1 | `publicAmount` | External amount (field-wrapped for negative) |
| 2 | `extDataHash` | External data hash |
| 3..3+nIns-1 | `inputNullifiers[i]` | Input nullifiers |
| 3+nIns..3+nIns+nOuts-1 | `outputCommitments[i]` | Output commitments |

For withdraw: `publicAmount` is field-wrapped: `FIELD_SIZE - uint256(-amount)`

### Security Features

- `ReentrancyGuard` — prevents reentrancy on transact()
- `Pausable` — emergency circuit breaker, owner-only
- `Ownable` — access control for pause/unpause and verifier management
- Custom errors — gas-efficient error handling
- Indexed events — efficient log filtering
- `MAX_DEPOSIT = 1_000_000_000_000` — 1M USDC cap
- `ROOT_HISTORY_SIZE = 100` — ring buffer for recent Merkle roots
- Variable verifier selection — supports 1x2 and 2x2 circuit configurations

---

## Commitment Scheme (V4)

```
commitment = Poseidon(amount, pubkey, blinding)          // 3-input Poseidon
nullifier  = Poseidon(commitment, pathIndex, privateKey) // 3-input Poseidon
publicKey  = Poseidon(privateKey)                        // 1-input Poseidon
```

### Key Differences from V3

| Aspect | V3 | V4 |
|--------|----|----|
| Commitment | `Poseidon(amount, nullifierSecret, randomness)` | `Poseidon(amount, pubkey, blinding)` |
| Nullifier | `Poseidon(nullifierSecret, commitment)` | `Poseidon(commitment, pathIndex, privateKey)` |
| Key model | Per-note secret | Per-wallet keypair |
| Spending | nullifierSecret proves ownership | privateKey proves ownership |

### Why pathIndex in Nullifier?

Including the Merkle tree leaf index (`pathIndex`) in the nullifier prevents the "same commitment, different position" attack. Without it, if the same commitment appears at two different positions, it could be spent twice. The pathIndex binds the nullifier to a specific tree insertion.

---

## extDataHash

External data is bound to the proof via a hash constraint:

```
extDataHash = uint256(keccak256(abi.encode(
    recipient,          // address
    relayer,            // address
    fee,                // uint256
    keccak256(encryptedOutput1),  // bytes32
    keccak256(encryptedOutput2)   // bytes32
))) % FIELD_SIZE
```

This prevents:
- Front-running (attacker can't substitute their recipient)
- Fee manipulation (fee is fixed at proof generation time)
- Note substitution (encrypted outputs are bound to proof)

---

## Note Encryption (V4)

### ECDH Key Exchange

Buyer and server each have secp256k1 keypairs. ECDH derives a shared secret:

```
sharedSecret = ECDH(buyerPrivKey, serverPubKey)  // = ECDH(serverPrivKey, buyerPubKey)
key = SHA-256(sharedSecret)
```

### Encryption (Buyer → Server)

```
plaintext = amount(8 bytes BE) + pubkey(32 bytes BE) + blinding(32 bytes BE)  // 72 bytes
iv = random(12 bytes)
ciphertext = AES-256-GCM(key, iv, plaintext)
output = iv(12) + authTag(16) + ciphertext(72) = 100 bytes
```

### Decryption (Server)

Server decrypts using its ECDH private key + buyer's public key (from `senderEcdhPubKey` field). Verifies decrypted `amount >= price`. This is the only way the server knows the payment amount — it's never visible on-chain.

---

## Security Considerations

### Privacy Guarantees

- **Deposit amounts visible** — on-chain USDC transferFrom is public
- **Transfer amounts HIDDEN** — publicAmount=0, amounts only in encrypted notes
- **Sender HIDDEN** — privateKey never exposed, nullifier is unlinkable
- **Receiver HIDDEN** — pubkey in commitment, encrypted in extData
- **Server knows payment amount** — but only via note decryption, not from chain
- **Change amounts HIDDEN** — change UTXO is also encrypted

### Attack Mitigations

| Attack | Mitigation |
|--------|-----------|
| Double-spend | Nullifier set (on-chain mapping) |
| Root front-running | 100-root history buffer |
| Proof forgery | On-chain Groth16 verification |
| Gas griefing | Pre-flight root + nullifier checks + off-chain proof verify |
| Reentrancy | OpenZeppelin ReentrancyGuard |
| Concurrent double-spend | UTXO pending lock (client-side) |
| Amount inflation | 120-bit range checks in circuit |
| Front-running | extDataHash binding |
| Note substitution | extDataHash includes keccak256(encryptedOutputs) |
| Field overflow | Amount range check: 0 ≤ amount < 2^120 |

### Trust Assumptions

- Circuit trusted setup (Hermez Powers of Tau + single Phase 2 contributor)
- Poseidon hash security (algebraic hash, well-studied over BN254)
- BN254 curve security (~128-bit)
- Groth16 soundness
- Server honesty (relayer submits transact() correctly)
- ECDH / AES-256-GCM security (note decryption)
