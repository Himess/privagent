# GhostPay

Privacy-preserving x402 payment protocol on Base. AI agents pay for API access using ZK proofs — all transfer amounts are **hidden on-chain**.

## Architecture (V4 — JoinSplit UTXO)

```
Agent deposits USDC → ShieldedPoolV4 (Poseidon Merkle tree, depth 20)
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

**Core stack:** Poseidon(3) UTXO commitments + JoinSplit Groth16 proofs + ECDH note encryption (HKDF + AES-256-GCM) + x402 HTTP payment protocol

**Server-as-relayer:** The buyer generates a JoinSplit proof client-side and sends it in the `Payment` header. The server (seller) decrypts the encrypted output notes to verify the payment amount off-chain, then submits `ShieldedPoolV4.transact()` on-chain — buyers don't need ETH for gas.

**Amounts HIDDEN:** Unlike V3 where withdrawal amounts were public, V4 uses a UTXO model where `publicAmount=0` for all private transfers. The server verifies amounts by decrypting ECDH-encrypted notes, not from on-chain data.

## Project Structure

```
ghostpay/
├── contracts/     # Solidity — ShieldedPoolV4, Verifiers, PoseidonHasher
├── circuits/      # Circom — JoinSplit (1x2, 2x2, depth 20)
├── sdk/           # TypeScript SDK
│   ├── src/v4/    # UTXO engine (active)
│   ├── src/x402/  # Payment protocol (active)
│   └── src/legacy/# V3 (deprecated)
├── app/           # Demo web app (Next.js)
├── examples/      # Integration examples
│   ├── virtuals-integration/
│   ├── eliza-plugin/
│   ├── express-server/
│   └── basic-transfer/
├── demo/          # E2E test scripts
└── docs/          # Protocol docs
```

## V3 vs V4

| Aspect | V3 (old) | V4 (current) |
|--------|----------|--------------|
| Model | Single-note withdraw | UTXO JoinSplit (N→M) |
| Amounts | PUBLIC in withdraw() | HIDDEN (publicAmount=0) |
| Verification | On-chain only | Off-chain note decryption + on-chain proof |
| Entry point | deposit() + withdraw() | transact() (single entry) |
| Tree depth | 20 (~1M leaves) | 20 (~1M leaves) |
| Circuits | 1 (privatePayment) | 2 (joinSplit_1x2, joinSplit_2x2) |
| Coin selection | Single note | Multi-UTXO (exact/smallest/accumulate) |
| Note encryption | None | ECDH + HKDF + AES-256-GCM |
| Scheme | zk-exact | zk-exact-v2 |
| Protocol fee | None | 0.1% (configurable) |

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
key = HKDF-SHA256(sharedSecret, salt="ghostpay-v4-note-encryption", info="aes-256-gcm-key")
plaintext = amount(8 bytes) + pubkey(32 bytes) + blinding(32 bytes)
ciphertext = AES-256-GCM(key, iv, plaintext)
output = iv(12) + tag(16) + ciphertext(72) = 100 bytes
```

## Protocol Fee (V4.3)

ShieldedPoolV4 supports a configurable protocol fee:

| Parameter | Default | Max |
|-----------|---------|-----|
| `protocolFeeBps` | 10 (0.1%) | 100 (1%) |
| `minProtocolFee` | 5000 (0.005 USDC) | 100000 (0.1 USDC) |
| `treasury` | address(0) (disabled) | any address |

Fee = `max(amount * feeBps / 10000, minProtocolFee)`. Fee is zero when treasury is not set.

## Gas Costs (Measured on Base Sepolia)

| Operation | Gas | Time |
|-----------|-----|------|
| Deposit (1x2 JoinSplit) | ~950K | ~4s |
| Private transfer (1x2) | ~900K | ~3.5s |
| Private transfer (2x2) | ~1.1M | ~4.5s |

## Test Results

- **Contracts:** 132 tests passing (Foundry — V4 + Edge Cases + Protocol Fee + Fuzz)
- **SDK:** 116 tests passing (vitest)
- **Total:** 248 tests
- **E2E:** Full flow on Base Sepolia (deposit → 402 → JoinSplit proof → server decrypt → transact → 200)

## Circuit Constraints (V4.3 — Depth 20)

| Circuit | Non-linear | Total |
|---------|-----------|-------|
| joinSplit_1x2 | 6,556 | ~12K |
| joinSplit_2x2 | 12,343 | ~24K |

Uses `powersOfTau28_hez_final_15.ptau` (Hermez, 54 contributors). See `circuits/CEREMONY.md`.

## Key Design Decisions

- **UTXO JoinSplit model** — N inputs → M outputs, like Tornado Cash Nova / Railgun
- **Amounts HIDDEN** — publicAmount=0 for private transfers, server decrypts notes off-chain
- **Poseidon(3) commitment** — amount + pubkey + blinding binding
- **Variable circuits** — 1x2 (single payment + change) and 2x2 (consolidation + payment)
- **ECDH note encryption** — secp256k1 shared secret → HKDF → AES-256-GCM, only server can decrypt
- **extDataHash binding** — recipient, relayer, fee, encrypted outputs bound to proof
- **Server-as-relayer** — buyer sends raw proof, server submits TX (gas abstraction)
- **Coin selection** — exact match → smallest sufficient → smallest-first accumulation
- **120-bit range checks** — prevents field overflow attacks on amounts
- **Conditional root check** — ForceEqualIfEnabled pattern for dummy inputs (amount=0)
- **Batch nullifier check** — intra-transaction duplicate nullifier prevention (defense-in-depth)
- **Protocol fee** — configurable fee with min/max caps for sustainability

## Security Model

- On-chain Groth16 proof verification prevents invalid transactions
- ReentrancyGuard on transact()
- Pausable by owner for emergency circuit break
- Nullifier tracking prevents double-spending
- Batch nullifier uniqueness check (intra-transaction)
- extDataHash prevents front-running and binds external data to proof
- ECDH encrypted notes — only server can decrypt and verify amounts
- HKDF key derivation with domain separation
- Pre-flight root + nullifier checks prevent gas griefing
- Off-chain proof verification before on-chain submit
- 120-bit range checks prevent field overflow in amounts
- Note locking prevents concurrent double-spend
- Exact USDC approval (no unlimited allowance)

## Documentation

- [Protocol Specification](docs/PROTOCOL.md)
- [Circuit Documentation](docs/CIRCUITS.md)
- [Stealth Address Design](docs/STEALTH.md)
- [Trusted Setup Ceremony](circuits/CEREMONY.md)
- [Audit Report](AUDIT.md)
- [POI Roadmap](docs/POI-ROADMAP.md)

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| V3 | Single-note privacy + x402 | Complete |
| V4.0 | UTXO JoinSplit + encrypted amounts | Complete |
| V4.2 | Multi-tree rollover + demo app | Complete |
| V4.3 | Bug fixes + depth 20 + protocol fee + HKDF + BSL-1.1 | Complete |
| V4.4 | Proof of Innocence (OFAC compliance) | Planned |
| V5.0 | Base Mainnet + professional audit | Planned |

### POI (Proof of Innocence)
GhostPay's UTXO architecture supports adding POI as an additive circuit
constraint without breaking existing deposits. See [POI Roadmap](docs/POI-ROADMAP.md).

## License

GhostPay is licensed under the [Business Source License 1.1](LICENSE).

| Use Case | Allowed? |
|----------|----------|
| Read and audit the code | Yes |
| Deploy on testnets | Yes |
| Personal/non-commercial use | Yes |
| Academic research | Yes |
| Security research | Yes |
| Contribute to GhostPay | Yes |
| Commercial mainnet deployment | License required |
| Commercial hosted service | License required |

On **March 1, 2028**, the license converts to GPL-2.0 (fully open source).

For commercial licensing: license@ghostpay.xyz
