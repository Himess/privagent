import { randomBytes } from "crypto";
import { ethers } from "ethers";
import { hash2 } from "./poseidon.js";
import {
  StealthMetaAddress,
  SerializedStealthMetaAddress,
  StealthPaymentData,
  FIELD_SIZE,
} from "./types.js";

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

/**
 * Derive an Ethereum address from stealth point coordinates.
 * keccak256(abi.encodePacked(x, y)) → take last 20 bytes
 */
export function deriveStealthEthAddress(
  stealthX: bigint,
  stealthY: bigint
): string {
  const packed = ethers.solidityPacked(
    ["uint256", "uint256"],
    [stealthX, stealthY]
  );
  const hash = ethers.keccak256(packed);
  return ethers.getAddress("0x" + hash.slice(-40));
}

/**
 * Serialize a StealthMetaAddress to string form for JSON transport
 */
export function serializeStealthMetaAddress(
  meta: StealthMetaAddress
): SerializedStealthMetaAddress {
  return {
    spendingPubKeyX: meta.spendingPubKeyX.toString(),
    spendingPubKeyY: meta.spendingPubKeyY.toString(),
    viewingPubKeyX: meta.viewingPubKeyX.toString(),
    viewingPubKeyY: meta.viewingPubKeyY.toString(),
  };
}

/**
 * Deserialize a StealthMetaAddress from string form
 */
export function deserializeStealthMetaAddress(
  data: SerializedStealthMetaAddress
): StealthMetaAddress {
  return {
    spendingPubKeyX: BigInt(data.spendingPubKeyX),
    spendingPubKeyY: BigInt(data.spendingPubKeyY),
    viewingPubKeyX: BigInt(data.viewingPubKeyX),
    viewingPubKeyY: BigInt(data.viewingPubKeyY),
  };
}
