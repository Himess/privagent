# GhostPay

Privacy-preserving x402 payment protocol on Base. AI agents pay for API access using ZK proofs — all transfer amounts are **hidden on-chain**.

## Architecture (V4 — JoinSplit UTXO)

```
Agent deposits USDC → ShieldedPoolV4 (Poseidon Merkle tree, depth 16)
                          ↓
Agent requests API → 402 (zk-exact-v2 scheme)
                          ↓
Agent generates JoinSplit proof (publicAmount=0, amounts HIDDEN)
                          ↓
Encrypted output notes → Payment header (base64)
                          ↓
Server decrypts note → verifies amount off-chain → calls transact()
                          ↓
Agent gets API response ← 200 OK + X-Payment-TxHash
```

**Core stack:** Poseidon(3) UTXO commitments + JoinSplit Groth16 proofs + ECDH note encryption (AES-256-GCM) + x402 HTTP payment protocol

**Server-as-relayer:** The buyer generates a JoinSplit proof client-side and sends it in the `Payment` header. The server (seller) decrypts the encrypted output notes to verify the payment amount off-chain, then submits `ShieldedPoolV4.transact()` on-chain — buyers don't need ETH for gas.

**Amounts HIDDEN:** Unlike V3 where withdrawal amounts were public, V4 uses a UTXO model where `publicAmount=0` for all private transfers. The server verifies amounts by decrypting ECDH-encrypted notes, not from on-chain data.

## V3 vs V4

| Aspect | V3 (old) | V4 (current) |
|--------|----------|--------------|
| Model | Single-note withdraw | UTXO JoinSplit (N→M) |
| Amounts | PUBLIC in withdraw() | HIDDEN (publicAmount=0) |
| Verification | On-chain only | Off-chain note decryption + on-chain proof |
| Entry point | deposit() + withdraw() | transact() (single entry) |
| Tree depth | 20 (~1M leaves) | 16 (65K leaves) |
| Circuits | 1 (privatePayment) | 2 (joinSplit_1x2, joinSplit_2x2) |
| Coin selection | Single note | Multi-UTXO (exact/smallest/accumulate) |
| Note encryption | None | ECDH + AES-256-GCM |
| Scheme | zk-exact | zk-exact-v2 |

## Packages

| Package | Description |
|---------|-------------|
| `contracts/` | Foundry — ShieldedPoolV4 (JoinSplit UTXO pool), PoseidonHasher, Groth16Verifier_1x2, Groth16Verifier_2x2 |
| `circuits/` | Circom — JoinSplit circuit (Poseidon(3) commitments, variable N×M, depth 16) |
| `sdk/` | TypeScript SDK — v4/ (UTXO, keypair, coinSelection, extData, noteEncryption, joinSplitProver, shieldedWallet, treeSync), x402/ (zkExactSchemeV2, middlewareV2, zkFetchV2) |
| `demo/` | Two-agent demo — seller-v4 (ghostPaywallV4) + buyer-v4 (ghostFetchV4) + E2E test |
| `relayer/` | **Deprecated** — standalone relayer replaced by server-as-relayer middleware |

## Quick Start

```bash
# Install
pnpm install

# Build circuits (requires circom + snarkjs)
cd circuits && bash scripts/build-v4.sh

# Build & test contracts
cd contracts && forge build && forge test -vvv

# Test SDK (116 tests)
cd sdk && pnpm test

# Run E2E on Base Sepolia
PRIVATE_KEY=0x... npx tsx demo/e2e-v4-test.ts
```

## Deployed Contracts (Base Sepolia)

### V4 (Current — JoinSplit UTXO)

| Contract | Address |
|----------|---------|
| PoseidonHasher | `0x3ae70C9741a9959fA32bC9BC09959d3d319Ee3Cd` |
| Groth16Verifier_1x2 | `0xe473aF953d269601402DEBcB2cc899aB594Ad31e` |
| Groth16Verifier_2x2 | `0x10D5BB24327d40c4717676E3B7351D76deb33848` |
| ShieldedPoolV4 | `0x17B6209385c2e36E6095b89572273175902547f9` |

Deploy block: `38256581`

### V3 (Legacy — Single-note)

| Contract | Address |
|----------|---------|
| PoseidonHasher | `0x27d2b5247949606f913Db8c314EABB917fcffd96` |
| Groth16Verifier | `0x605002BbB689457101104e8Ee3C76a8d5D23e5c8` |
| ShieldedPool | `0xbA5c38093CefBbFA08577b08b0494D5c7738E4F6` |
| StealthRegistry | `0x5E3ef9A91AD33270f84B32ACFF91068Eea44c5ee` |

Deploy block: `38229334`

## x402 `zk-exact-v2` Scheme (V4)

```
GET /api/weather HTTP/1.1
→ 402 Payment Required
{
  "x402Version": 4,
  "accepts": [{
    "scheme": "zk-exact-v2",
    "network": "eip155:84532",
    "amount": "1000000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "poolAddress": "0x17B6209385c2e36E6095b89572273175902547f9",
    "payToPubkey": "12345...",
    "serverEcdhPubKey": "0x02abc..."
  }]
}

→ Agent: coin selection → JoinSplit proof (publicAmount=0) → encrypt output notes
→ Retry with Payment header (base64 V4PaymentPayload)
→ Server: decrypt note → verify amount → transact() on-chain
→ 200 OK + X-Payment-TxHash header
```

## Commitment Scheme (V4)

```
commitment = Poseidon(amount, pubkey, blinding)       // 3-input — amount HIDDEN
nullifier  = Poseidon(commitment, pathIndex, privkey) // 3-input — prevents double-spend
```

Amount is bound to the commitment. The circuit enforces balance conservation: `sum(inputs) + publicAmount === sum(outputs)`. For private transfers, `publicAmount=0` so amounts never appear on-chain.

## Note Encryption (V4)

Buyer encrypts output UTXOs using ECDH so the server can verify amounts off-chain:

```
sharedSecret = ECDH(buyerEcdhPrivKey, serverEcdhPubKey)
key = SHA-256(sharedSecret)
plaintext = amount(8 bytes) + pubkey(32 bytes) + blinding(32 bytes)
ciphertext = AES-256-GCM(key, iv, plaintext)
output = iv(12) + tag(16) + ciphertext(72) = 100 bytes
```

## Gas Costs (Measured on Base Sepolia)

| Operation | Gas | Time |
|-----------|-----|------|
| Deposit (1x2 JoinSplit) | ~950K | ~4s |
| Private transfer (1x2) | ~900K | ~3.5s |
| Private transfer (2x2) | ~1.1M | ~4.5s |

## Test Results

- **Contracts:** 125 tests passing (Foundry — V3 + V4 + StealthRegistry + Edge Cases + Invariants + Fuzz)
- **SDK:** 116 tests passing (vitest)
- **Total:** 241 tests
- **E2E:** Full flow on Base Sepolia (deposit → 402 → JoinSplit proof → server decrypt → transact → 200)

## Circuit Constraints (V4)

| Circuit | Non-linear | Total |
|---------|-----------|-------|
| joinSplit_1x2 | 5,572 | ~11K |
| joinSplit_2x2 | 10,375 | ~20K |

Uses `powersOfTau28_hez_final_17.ptau` (Hermez, 54 contributors). See `circuits/CEREMONY.md`.

## Key Design Decisions

- **UTXO JoinSplit model** — N inputs → M outputs, like Tornado Cash Nova / Railgun
- **Amounts HIDDEN** — publicAmount=0 for private transfers, server decrypts notes off-chain
- **Poseidon(3) commitment** — amount + pubkey + blinding binding
- **Variable circuits** — 1x2 (single payment + change) and 2x2 (consolidation + payment)
- **ECDH note encryption** — secp256k1 shared secret → AES-256-GCM, only server can decrypt
- **extDataHash binding** — recipient, relayer, fee, encrypted outputs bound to proof
- **Server-as-relayer** — buyer sends raw proof, server submits TX (gas abstraction)
- **Coin selection** — exact match → smallest sufficient → smallest-first accumulation
- **120-bit range checks** — prevents field overflow attacks on amounts
- **Conditional root check** — ForceEqualIfEnabled pattern for dummy inputs (amount=0)

## Security Model

- On-chain Groth16 proof verification prevents invalid transactions
- ReentrancyGuard on transact() (H1)
- Pausable by owner for emergency circuit break (H3)
- Nullifier tracking prevents double-spending
- extDataHash prevents front-running and binds external data to proof
- ECDH encrypted notes — only server can decrypt and verify amounts
- Pre-flight root + nullifier checks prevent gas griefing (H2)
- Off-chain proof verification before on-chain submit (P2)
- 120-bit range checks prevent field overflow in amounts
- Note locking prevents concurrent double-spend (C4)

## Documentation

- [Protocol Specification](docs/PROTOCOL.md)
- [Circuit Documentation](docs/CIRCUITS.md)
- [Stealth Address Design](docs/STEALTH.md)
- [Trusted Setup Ceremony](circuits/CEREMONY.md)
- [Audit Report](AUDIT.md)

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| V3 | Single-note privacy + x402 | Complete |
| V4.0 | UTXO JoinSplit + encrypted amounts | Live on Base Sepolia |
| V4.1 | Multi-tree rollover + 4x2 circuit | Planned |
| V4.2 | Proof of Innocence (OFAC compliance) | Planned |
| V4.3 | Rapidsnark + production optimization | Planned |
| V5.0 | Base Mainnet + professional audit | Planned |

### POI (Proof of Innocence)
GhostPay's UTXO architecture supports adding POI as an additive circuit
constraint without breaking existing deposits. See [POI Roadmap](docs/POI-ROADMAP.md).

## License

MIT
