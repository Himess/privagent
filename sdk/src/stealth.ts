import { randomBytes } from "crypto";
import { hash2 } from "./poseidon.js";
import { StealthMetaAddress, StealthPaymentData, FIELD_SIZE } from "./types.js";

/**
 * Agent stealth keypair for private receiving
 */
export class AgentStealthKeypair {
  readonly spendingPrivKey: bigint;
  readonly viewingPrivKey: bigint;
  readonly spendingPubKeyX: bigint;
  readonly spendingPubKeyY: bigint;
  readonly viewingPubKeyX: bigint;
  readonly viewingPubKeyY: bigint;

  constructor(spendingPrivKey: bigint, viewingPrivKey: bigint) {
    this.spendingPrivKey = spendingPrivKey;
    this.viewingPrivKey = viewingPrivKey;

    // Derive public keys (simplified — in production use BabyJubJub)
    this.spendingPubKeyX = hash2(spendingPrivKey, 1n);
    this.spendingPubKeyY = hash2(spendingPrivKey, 2n);
    this.viewingPubKeyX = hash2(viewingPrivKey, 1n);
    this.viewingPubKeyY = hash2(viewingPrivKey, 2n);
  }

  static generate(): AgentStealthKeypair {
    const spendingPrivKey =
      BigInt("0x" + randomBytes(31).toString("hex")) % FIELD_SIZE;
    const viewingPrivKey =
      BigInt("0x" + randomBytes(31).toString("hex")) % FIELD_SIZE;
    return new AgentStealthKeypair(spendingPrivKey, viewingPrivKey);
  }

  getMetaAddress(): StealthMetaAddress {
    return {
      spendingPubKeyX: this.spendingPubKeyX,
      spendingPubKeyY: this.spendingPubKeyY,
      viewingPubKeyX: this.viewingPubKeyX,
      viewingPubKeyY: this.viewingPubKeyY,
    };
  }

  /**
   * Check if a stealth payment is addressed to this keypair
   */
  isPaymentForMe(
    ephemeralPubKeyX: bigint,
    stealthAddressX: bigint,
    stealthAddressY: bigint
  ): boolean {
    const sharedSecret = hash2(ephemeralPubKeyX, this.viewingPubKeyX);
    const expectedX = hash2(sharedSecret, this.spendingPubKeyX);
    const expectedY = hash2(sharedSecret, this.spendingPubKeyY);
    return expectedX === stealthAddressX && expectedY === stealthAddressY;
  }

  /**
   * Compute the view tag for fast scanning
   */
  computeViewTag(ephemeralPubKeyX: bigint): bigint {
    const sharedSecret = hash2(ephemeralPubKeyX, this.viewingPubKeyX);
    return sharedSecret & 0xffn;
  }
}

/**
 * Generate stealth payment data for a recipient
 */
export function generateStealthPayment(
  recipientSpendingPubKeyX: bigint,
  recipientSpendingPubKeyY: bigint,
  recipientViewingPubKeyX: bigint,
  _recipientViewingPubKeyY: bigint
): StealthPaymentData {
  const ephemeralPrivKey =
    BigInt("0x" + randomBytes(31).toString("hex")) % FIELD_SIZE;

  const ephemeralPubKeyX = hash2(ephemeralPrivKey, 1n);
  const ephemeralPubKeyY = hash2(ephemeralPrivKey, 2n);

  const sharedSecret = hash2(ephemeralPubKeyX, recipientViewingPubKeyX);
  const viewTag = sharedSecret & 0xffn;

  const stealthAddressX = hash2(sharedSecret, recipientSpendingPubKeyX);
  const stealthAddressY = hash2(sharedSecret, recipientSpendingPubKeyY);

  return {
    ephemeralPrivKey,
    ephemeralPubKeyX,
    ephemeralPubKeyY,
    stealthAddressX,
    stealthAddressY,
    viewTag,
    sharedSecret,
  };
}
