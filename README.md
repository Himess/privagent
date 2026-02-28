# GhostPay

Privacy-preserving x402 payment protocol on Base. AI agents pay for API access using ZK proofs — deposits are visible, but payments are unlinkable to the depositor.

## Architecture

```
Agent deposits USDC → ShieldedPool (Poseidon Merkle tree)
                          ↓
Agent requests API → 402 (zk-exact scheme)
                          ↓
Agent creates ZK proof → Payment header (raw proof, no TX)
                          ↓
Server calls withdraw() → USDC to stealth address
                          ↓
Agent gets API response ← 200 OK + X-Payment-TxHash
```

**Core stack:** Poseidon(3) commitments + Groth16 ZK proofs + secp256k1 ECDH stealth addresses + x402 HTTP payment protocol

**Server-as-relayer:** The buyer generates a ZK proof client-side and sends it in the `Payment` header. The server (seller) submits `ShieldedPool.withdraw()` on-chain — buyers don't need ETH for gas.

## Packages

| Package | Description |
|---------|-------------|
| `contracts/` | Foundry — ShieldedPool (ReentrancyGuard + Pausable + Ownable), PoseidonHasher, StealthRegistry, Groth16Verifier |
| `circuits/` | Circom — privatePayment circuit (Poseidon(3), depth 20, conditional newCommitment) |
| `sdk/` | TypeScript SDK — poseidon, merkle, proof, notes, stealth (secp256k1 ECDH), pool client, x402 modules |
| `demo/` | Two-agent demo — seller (ghostPaywall) + buyer (ghostFetch) + E2E test |
| `relayer/` | **Deprecated** — standalone relayer replaced by server-as-relayer middleware |

## Quick Start

```bash
# Install
pnpm install

# Build circuits (requires circom + snarkjs)
cd circuits && bash scripts/build.sh

# Build & test contracts (31 tests)
cd contracts && forge build && forge test -vvv

# Test SDK (63 tests)
cd sdk && pnpm test

# Run E2E on Base Sepolia
PRIVATE_KEY_SELLER=0x... PRIVATE_KEY_BUYER=0x... npx tsx demo/e2e-test.ts
```

## Deployed Contracts (Base Sepolia — V3)

| Contract | Address |
|----------|---------|
| PoseidonHasher | `0x27d2b5247949606f913Db8c314EABB917fcffd96` |
| Groth16Verifier | `0x605002BbB689457101104e8Ee3C76a8d5D23e5c8` |
| ShieldedPool | `0xbA5c38093CefBbFA08577b08b0494D5c7738E4F6` |
| StealthRegistry | `0x5E3ef9A91AD33270f84B32ACFF91068Eea44c5ee` |

Deploy block: `38229334`

## x402 `zk-exact` Scheme

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
    "poolAddress": "0xPool...",
    "stealthMetaAddress": { "spendingPubKey": "0x04...", "viewingPubKey": "0x04..." }
  }]
}

→ Agent generates ZK proof client-side (no TX)
→ Retry with Payment header (base64 encoded, proof as string[8])
→ Server calls withdraw() on-chain as relayer
→ 200 OK + X-Payment-TxHash header
```

## Commitment Scheme (V3)

```
commitment = Poseidon(amount, nullifierSecret, randomness)    // 3-input
nullifierHash = Poseidon(nullifierSecret, commitment)
newCommitment = change > 0 ? Poseidon(change, newSecret, newRandom) : 0
```

Amount is bound to the commitment — the circuit enforces `balance >= amount + fee` where `balance` is the preimage of the Merkle leaf.

## Stealth Addresses (V3 — secp256k1 ECDH)

Seller publishes a stealth meta-address (spending + viewing public keys). Buyer derives a one-time stealth address using ECDH:

```
ephemeralKey = random secp256k1 private key
sharedSecret = ECDH(ephemeralKey, viewingPubKey)
stealthPubKey = spendingPubKey + hash(sharedSecret) * G
stealthAddress = keccak256(stealthPubKey)[12:]
```

Only the seller can recover the stealth private key using their spending + viewing private keys.

## Gas Costs (Measured on Base Sepolia)

| Operation | Gas |
|-----------|-----|
| Deposit | ~851K (Poseidon Merkle insert, depth 20) |
| Withdraw | ~1.03M (Groth16 verify + Merkle insert + USDC transfer) |
| Proof Gen | ~3.5s (Node.js, snarkjs, incl. network) |

## Test Results

- **Contracts:** 31 tests passing (Foundry)
- **SDK:** 63 tests passing (vitest)
- **E2E:** Full flow on Base Sepolia (deposit → 402 → ZK proof → server withdraw → 200)

## Circuit Constraints

| Component | Non-linear | Linear |
|-----------|-----------|--------|
| Total | 5,762 | 6,442 |

Uses `powersOfTau28_hez_final_14.ptau` (Hermez, 54 contributors). See `circuits/CEREMONY.md`.

## Key Design Decisions

- **Variable amounts** — x402 needs arbitrary payment amounts (not fixed denominations)
- **Poseidon(3) commitment** — amount + nullifierSecret + randomness binding (C6+C7 fix)
- **Depth 20** — ~1M deposit anonymity set, Groth16 verify still constant ~224K gas
- **100-root history** — ring buffer for recent Merkle roots (M1 fix)
- **Conditional newCommitment** — IsZero circuit gate: full-spend outputs 0 (C2 fix)
- **Server-as-relayer** — buyer sends raw proof, server submits TX (gas abstraction)
- **secp256k1 ECDH stealth** — real EC keypairs with recoverable private keys (C1 fix)
- **Note locking** — pendingNullifiers Set prevents concurrent double-spend (C4 fix)

## Security Model

- On-chain Groth16 proof verification prevents invalid withdrawals
- ReentrancyGuard on deposit/withdraw (H1)
- Pausable by owner for emergency circuit break (H3)
- Nullifier tracking prevents double-spending
- Poseidon(3) commitments bind amount + nullifierSecret + randomness
- secp256k1 ECDH stealth addresses enable private receiving with recoverable keys
- Pre-flight root + nullifier checks prevent gas griefing (H2)
- Field bounds validation on Poseidon inputs (H9)
- Generic error messages prevent information leakage (L6)

## Documentation

- [Protocol Specification](docs/PROTOCOL.md)
- [Circuit Documentation](docs/CIRCUITS.md)
- [Stealth Address Design](docs/STEALTH.md)
- [Trusted Setup Ceremony](circuits/CEREMONY.md)
- [Audit Report](AUDIT.md)

## License

MIT
