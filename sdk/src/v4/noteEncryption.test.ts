import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "../poseidon.js";
import { encryptNote, decryptNote } from "./noteEncryption.js";
import { createUTXO, derivePublicKey } from "./utxo.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { randomBytes } from "crypto";

describe("V4 Note Encryption", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("should encrypt and decrypt note successfully", () => {
    const senderPrivKey = randomBytes(32);
    const receiverPrivKey = randomBytes(32);
    const senderPubKey = secp256k1.getPublicKey(senderPrivKey, true);
    const receiverPubKey = secp256k1.getPublicKey(receiverPrivKey, true);

    const pubkey = derivePublicKey(42n);
    const utxo = createUTXO(5000000n, pubkey);

    const encrypted = encryptNote(utxo, senderPrivKey, receiverPubKey);
    expect(encrypted.length).toBe(100); // iv(12) + tag(16) + ct(72)

    const decrypted = decryptNote(encrypted, receiverPrivKey, senderPubKey);
    expect(decrypted).not.toBeNull();
    expect(decrypted!.amount).toBe(utxo.amount);
    expect(decrypted!.pubkey).toBe(utxo.pubkey);
    expect(decrypted!.blinding).toBe(utxo.blinding);
  });

  it("should fail decryption with wrong key", () => {
    const senderPrivKey = randomBytes(32);
    const receiverPrivKey = randomBytes(32);
    const wrongPrivKey = randomBytes(32);
    const receiverPubKey = secp256k1.getPublicKey(receiverPrivKey, true);
    const wrongPubKey = secp256k1.getPublicKey(wrongPrivKey, true);

    const pubkey = derivePublicKey(42n);
    const utxo = createUTXO(1000n, pubkey);

    const encrypted = encryptNote(utxo, senderPrivKey, receiverPubKey);

    // Try decrypting with wrong key pair
    const result = decryptNote(encrypted, wrongPrivKey, wrongPubKey);
    expect(result).toBeNull();
  });

  it("should handle large amounts", () => {
    const senderPrivKey = randomBytes(32);
    const receiverPrivKey = randomBytes(32);
    const senderPubKey = secp256k1.getPublicKey(senderPrivKey, true);
    const receiverPubKey = secp256k1.getPublicKey(receiverPrivKey, true);

    const pubkey = derivePublicKey(99n);
    const utxo = createUTXO(1000000000000n, pubkey); // 1M USDC

    const encrypted = encryptNote(utxo, senderPrivKey, receiverPubKey);
    const decrypted = decryptNote(encrypted, receiverPrivKey, senderPubKey);

    expect(decrypted).not.toBeNull();
    expect(decrypted!.amount).toBe(1000000000000n);
  });

  it("should fail with truncated ciphertext", () => {
    const result = decryptNote(
      new Uint8Array(50), // too short
      randomBytes(32),
      secp256k1.getPublicKey(randomBytes(32), true)
    );
    expect(result).toBeNull();
  });
});
