/**
 * GhostPay V3 — Stealth Addresses via secp256k1 ECDH
 *
 * C1 FIX: Replaces broken Poseidon-hash stealth with real EC math.
 * Reference: MixVM stealth implementation + ERC-5564 Scheme 1
 *
 * Flow:
 *   1. Recipient publishes (spendingPubKey, viewingPubKey) — StealthMetaAddress
 *   2. Sender generates ephemeral keypair, computes ECDH shared secret
 *   3. stealthPubKey = spendingPubKey + hash(sharedSecret) * G
 *   4. stealthAddress = pubKeyToAddress(stealthPubKey)
 *   5. Recipient recovers: stealthPrivKey = spendingPrivKey + hash(sharedSecret)
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ethers } from "ethers";
import type {
  StealthMetaAddress,
  SerializedStealthMetaAddress,
  StealthPaymentData,
} from "../types.js";

// secp256k1 curve order
const CURVE_ORDER = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

/**
 * Agent stealth keypair for private receiving.
 * Uses real secp256k1 keys — funds are recoverable.
 */
export class AgentStealthKeypair {
  readonly spendingPrivKey: Uint8Array;
  readonly viewingPrivKey: Uint8Array;
  readonly spendingPubKey: Uint8Array;
  readonly viewingPubKey: Uint8Array;

  constructor(spendingPrivKey: Uint8Array, viewingPrivKey: Uint8Array) {
    this.spendingPrivKey = spendingPrivKey;
    this.viewingPrivKey = viewingPrivKey;
    this.spendingPubKey = secp256k1.getPublicKey(spendingPrivKey, false); // uncompressed
    this.viewingPubKey = secp256k1.getPublicKey(viewingPrivKey, false);
  }

  static generate(): AgentStealthKeypair {
    const spendingPrivKey = secp256k1.utils.randomSecretKey();
    const viewingPrivKey = secp256k1.utils.randomSecretKey();
    return new AgentStealthKeypair(spendingPrivKey, viewingPrivKey);
  }

  getMetaAddress(): StealthMetaAddress {
    return {
      spendingPubKey: ethers.hexlify(this.spendingPubKey),
      viewingPubKey: ethers.hexlify(this.viewingPubKey),
    };
  }

  /**
   * Derive the stealth address and private key for a given ephemeral public key.
   * Recipient calls this to check and recover funds.
   */
  deriveStealthAddress(ephemeralPubKeyHex: string): {
    stealthAddress: string;
    stealthPrivKey: string;
  } {
    const ephemeralPubKeyBytes = ethers.getBytes(ephemeralPubKeyHex);

    // ECDH: sharedSecret = viewingPrivKey * ephemeralPubKey
    const sharedSecretPoint = secp256k1.getSharedSecret(
      this.viewingPrivKey,
      ephemeralPubKeyBytes
    );
    const hashedSecret = ethers.keccak256(sharedSecretPoint);
    const hashScalar = positiveMod(BigInt(hashedSecret), CURVE_ORDER);

    // stealthPubKey = spendingPubKey + hash(secret) * G
    const spendingPoint = secp256k1.Point.fromHex(
      Buffer.from(this.spendingPubKey).toString("hex")
    );
    const offset = secp256k1.Point.BASE.multiply(hashScalar);
    const stealthPoint = spendingPoint.add(offset);
    const stealthAddress = pubKeyToAddress(stealthPoint.toBytes(false));

    // stealthPrivKey = spendingPrivKey + hash(secret) mod n
    const spendingPrivBigInt = bytesToBigInt(this.spendingPrivKey);
    const stealthPrivBigInt = positiveMod(spendingPrivBigInt + hashScalar, CURVE_ORDER);
    const stealthPrivKey = ethers.hexlify(bigIntToBytes32(stealthPrivBigInt));

    return { stealthAddress, stealthPrivKey };
  }

  /**
   * Compute the view tag for fast scanning.
   * First byte of hashed shared secret — 256x scanning speedup.
   */
  computeViewTag(ephemeralPubKeyHex: string): number {
    const ephemeralPubKeyBytes = ethers.getBytes(ephemeralPubKeyHex);
    const sharedSecretPoint = secp256k1.getSharedSecret(
      this.viewingPrivKey,
      ephemeralPubKeyBytes
    );
    const hashedSecret = ethers.keccak256(sharedSecretPoint);
    return parseInt(hashedSecret.slice(2, 4), 16);
  }
}

/**
 * Generate stealth payment data for a recipient.
 * Sender calls this with the recipient's meta-address.
 */
export function generateStealthPayment(
  meta: StealthMetaAddress
): StealthPaymentData {
  // Generate ephemeral keypair
  const ephemeralPrivKey = secp256k1.utils.randomSecretKey();
  const ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivKey, false);

  // getSharedSecret needs Uint8Array; Point.fromHex needs raw hex (no 0x)
  const recipientViewingPubKey = ethers.getBytes(meta.viewingPubKey);
  const spendingHex = meta.spendingPubKey.replace(/^0x/, "");

  // ECDH: sharedSecret = ephemeralPrivKey * viewingPubKey
  const sharedSecretPoint = secp256k1.getSharedSecret(
    ephemeralPrivKey,
    recipientViewingPubKey
  );
  const hashedSecret = ethers.keccak256(sharedSecretPoint);
  const hashScalar = positiveMod(BigInt(hashedSecret), CURVE_ORDER);

  // stealthPubKey = spendingPubKey + hash(sharedSecret) * G
  const spendingPoint = secp256k1.Point.fromHex(spendingHex);
  const offset = secp256k1.Point.BASE.multiply(hashScalar);
  const stealthPoint = spendingPoint.add(offset);

  const stealthAddress = pubKeyToAddress(stealthPoint.toBytes(false));
  const viewTag = parseInt(hashedSecret.slice(2, 4), 16);

  return {
    ephemeralPubKey: ethers.hexlify(ephemeralPubKey),
    stealthAddress,
    viewTag,
  };
}

/**
 * Derive Ethereum address from uncompressed public key bytes.
 * keccak256(pubKey[1:]) → last 20 bytes
 */
export function pubKeyToAddress(uncompressedPubKey: Uint8Array): string {
  // Remove 0x04 prefix (uncompressed point indicator)
  const pubKeyWithoutPrefix = uncompressedPubKey.slice(1);
  const hash = ethers.keccak256(pubKeyWithoutPrefix);
  return ethers.getAddress("0x" + hash.slice(-40));
}

/**
 * Serialize a StealthMetaAddress for JSON transport
 */
export function serializeStealthMetaAddress(
  meta: StealthMetaAddress
): SerializedStealthMetaAddress {
  return {
    spendingPubKey: meta.spendingPubKey,
    viewingPubKey: meta.viewingPubKey,
  };
}

/**
 * Deserialize a StealthMetaAddress from JSON
 */
export function deserializeStealthMetaAddress(
  data: SerializedStealthMetaAddress
): StealthMetaAddress {
  return {
    spendingPubKey: data.spendingPubKey,
    viewingPubKey: data.viewingPubKey,
  };
}

// ============ Helpers ============

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function bigIntToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function positiveMod(a: bigint, n: bigint): bigint {
  return ((a % n) + n) % n;
}
