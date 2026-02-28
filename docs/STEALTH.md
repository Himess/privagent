# GhostPay Stealth Address Design (V3)

> **LEGACY V3 DOCUMENT**
> This document describes V3 stealth addresses, which are NOT used in V4.
> V4 uses ECDH note encryption instead. See [PROTOCOL.md](PROTOCOL.md) for the V4 design.

## Overview

GhostPay V3 uses secp256k1 ECDH stealth addresses for private receiving. Each payment goes to a fresh one-time address that only the recipient can identify and spend from.

## Key Generation

Each recipient (seller) generates a stealth keypair:

```
spendingPrivKey = random 32 bytes (secp256k1 scalar)
spendingPubKey  = spendingPrivKey * G     (compressed/uncompressed EC point)

viewingPrivKey  = random 32 bytes (secp256k1 scalar)
viewingPubKey   = viewingPrivKey * G      (compressed/uncompressed EC point)
```

The stealth meta-address is published as `{ spendingPubKey, viewingPubKey }` — both are 65-byte uncompressed public keys (0x04 prefix).

## Stealth Address Derivation (Sender)

When the buyer wants to pay the seller privately:

```
1. ephemeralPrivKey = random 32 bytes
2. ephemeralPubKey  = ephemeralPrivKey * G

3. sharedSecret = ECDH(ephemeralPrivKey, viewingPubKey)
                = ephemeralPrivKey * viewingPubKey

4. hashedSecret = keccak256(sharedSecret)  (as scalar mod n)

5. stealthPubKey = spendingPubKey + hashedSecret * G

6. stealthAddress = keccak256(stealthPubKey.x, stealthPubKey.y)[12:]
                  = standard Ethereum address derivation
```

The buyer includes `ephemeralPubKey` in the payment header so the seller can recover.

## Stealth Address Recovery (Recipient)

The seller can identify and recover payments:

```
1. sharedSecret = ECDH(viewingPrivKey, ephemeralPubKey)
                = viewingPrivKey * ephemeralPubKey
                = same as sender's sharedSecret (ECDH commutativity)

2. hashedSecret = keccak256(sharedSecret)

3. stealthPrivKey = spendingPrivKey + hashedSecret  (mod curve order n)

4. stealthPubKey  = stealthPrivKey * G
                  = spendingPubKey + hashedSecret * G  (same as sender computed)

5. stealthAddress = keccak256(stealthPubKey.x, stealthPubKey.y)[12:]
```

The seller now has the private key for the stealth address and can spend any funds sent there.

## View Tag Optimization

A view tag is the first byte of the shared secret, used to speed up scanning:

```
viewTag = sharedSecret[0]  (1 byte, 0-255)
```

When scanning announcements, the recipient first checks the view tag. Only if it matches (1/256 chance for non-matching payments) do they perform the full ECDH + address derivation. This provides a ~256x speedup for scanning.

## Why secp256k1 ECDH (V3 Fix)

V2 used Poseidon-based "stealth" addresses:
```
// V2 (BROKEN):
spendingPubKeyX = Poseidon(spendingPrivKey, 1)  // NOT an EC point
sharedSecret = Poseidon(ephemeralX, viewingX)     // Anyone can compute this
stealthAddress = keccak256(stealthX, stealthY)    // No private key exists
```

Problems:
1. No real ECDH — shared secret computable by anyone who knows the public keys
2. Stealth addresses had no corresponding private key — funds were permanently locked
3. No compatibility with ERC-5564 or existing stealth address standards

V3 uses real secp256k1 ECDH via `@noble/curves`:
- Shared secret requires knowledge of either private key (ECDH property)
- Stealth private key is computable only by the recipient
- Compatible with ERC-5564 Scheme 1 (secp256k1)

## Implementation

Library: `@noble/curves/secp256k1` v2.x

```typescript
import { secp256k1 } from "@noble/curves/secp256k1";

// Key generation
const privKey = secp256k1.utils.randomPrivateKey();
const pubKey = secp256k1.getPublicKey(privKey, false); // uncompressed

// ECDH
const sharedSecret = secp256k1.getSharedSecret(
  privKey,
  ethers.getBytes(pubKeyHex)  // Uint8Array for v2 compat
);

// Point arithmetic
const point = secp256k1.Point.fromHex(
  pubKeyHex.replace(/^0x/, "")  // raw hex, no 0x prefix for v2 compat
);
const stealthPoint = point.add(
  secp256k1.Point.BASE.multiply(hashedSecret)
);
```

### @noble/curves v2 API Notes

- `Point.fromHex()` requires raw hex string (no `0x` prefix), not `Uint8Array`
- `getSharedSecret()` requires `Uint8Array` for the public key parameter
- `getPublicKey()` returns `Uint8Array`

## Serialization

Stealth meta-address in wire format (x402 requirements):

```json
{
  "stealthMetaAddress": {
    "spendingPubKey": "0x04abc123...",
    "viewingPubKey": "0x04def456..."
  }
}
```

Both keys are 65-byte uncompressed secp256k1 public keys, hex-encoded with 0x prefix.

## Security Properties

| Property | Guarantee |
|----------|----------|
| Sender privacy | Deposit unlinkable to withdrawal (ZK proof) |
| Receiver privacy | Fresh stealth address per payment |
| Fund recovery | Recipient can compute stealth private key |
| Scanning efficiency | View tag provides 256x speedup |
| Forward secrecy | Ephemeral key per payment |
