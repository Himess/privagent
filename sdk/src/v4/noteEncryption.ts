import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { UTXO } from "./utxo.js";

function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Encrypt a UTXO note so only the recipient can decrypt it.
 * Uses ECDH shared secret (secp256k1) → SHA-256 → AES-256-GCM.
 *
 * Plaintext: amount (8 bytes) + pubkey (32 bytes) + blinding (32 bytes) = 72 bytes
 */
export function encryptNote(
  utxo: UTXO,
  senderPrivateKey: Uint8Array, // 32 bytes secp256k1
  receiverPubKey: Uint8Array // 33 or 65 bytes secp256k1
): Uint8Array {
  // ECDH shared secret
  const sharedPoint = secp256k1.getSharedSecret(senderPrivateKey, receiverPubKey, true);
  const key = sha256(sharedPoint);

  // Plaintext: amount(8) + pubkey(32) + blinding(32) = 72 bytes
  const plaintext = Buffer.alloc(72);
  // amount as big-endian 8 bytes
  const amountBuf = Buffer.alloc(8);
  let amt = utxo.amount;
  for (let i = 7; i >= 0; i--) {
    amountBuf[i] = Number(amt & 0xffn);
    amt >>= 8n;
  }
  amountBuf.copy(plaintext, 0);

  // pubkey as big-endian 32 bytes
  writeBigInt(plaintext, 8, utxo.pubkey);

  // blinding as big-endian 32 bytes
  writeBigInt(plaintext, 40, utxo.blinding);

  // AES-256-GCM
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Output: iv(12) + tag(16) + ciphertext(72) = 100 bytes
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt a UTXO note from encrypted output data.
 * Returns null if decryption fails (wrong key).
 */
export function decryptNote(
  ciphertext: Uint8Array,
  receiverPrivateKey: Uint8Array, // 32 bytes secp256k1
  senderPubKey: Uint8Array // 33 or 65 bytes secp256k1
): Pick<UTXO, "amount" | "pubkey" | "blinding"> | null {
  try {
    if (ciphertext.length < 100) return null;

    // ECDH shared secret
    const sharedPoint = secp256k1.getSharedSecret(receiverPrivateKey, senderPubKey, true);
    const key = sha256(sharedPoint);

    const iv = ciphertext.slice(0, 12);
    const tag = ciphertext.slice(12, 28);
    const encrypted = ciphertext.slice(28);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(tag));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted)),
      decipher.final(),
    ]);

    // Parse: amount(8) + pubkey(32) + blinding(32)
    let amount = 0n;
    for (let i = 0; i < 8; i++) {
      amount = (amount << 8n) | BigInt(plaintext[i]);
    }

    const pubkey = readBigInt(plaintext, 8);
    const blinding = readBigInt(plaintext, 40);

    return { amount, pubkey, blinding };
  } catch {
    return null;
  }
}

function writeBigInt(buf: Buffer, offset: number, value: bigint): void {
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function readBigInt(buf: Buffer, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(buf[offset + i]);
  }
  return result;
}
