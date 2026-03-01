import { ShieldedPoolClient } from "../legacy/pool.js";
import { initPoseidon } from "../poseidon.js";
import {
  generateStealthPayment,
  deserializeStealthMetaAddress,
} from "../legacy/stealth.js";
import type {
  ZkPaymentRequirements,
  ZkExactPayload,
  V2PaymentPayload,
  PaymentRequired,
  PaymentResult,
  ResourceInfo,
} from "../types.js";

export interface ZkPaymentHandlerOptions {
  maxPayment?: bigint;
  allowedNetworks?: string[];
}

/**
 * Handles x402 payment flows using ZK proofs from GhostPay's ShieldedPool.
 *
 * V3: Uses secp256k1 ECDH for stealth addresses.
 * Flow: buyer generates proof client-side, sends raw proof in Payment header.
 * Server acts as relayer and calls withdraw() on-chain.
 */
export class ZkPaymentHandler {
  private client: ShieldedPoolClient;
  private options: ZkPaymentHandlerOptions;

  constructor(client: ShieldedPoolClient, options: ZkPaymentHandlerOptions = {}) {
    this.client = client;
    this.options = options;
  }

  async parsePaymentRequired(response: Response): Promise<PaymentRequired | null> {
    if (response.status !== 402) return null;

    try {
      const body = await response.json();
      if (!body || body.x402Version !== 2 || !Array.isArray(body.accepts)) {
        return null;
      }
      return body as PaymentRequired;
    } catch {
      return null;
    }
  }

  selectRequirement(
    requirements: ZkPaymentRequirements[]
  ): ZkPaymentRequirements | null {
    for (const req of requirements) {
      if (req.scheme !== "zk-exact") continue;

      if (
        this.options.allowedNetworks?.length &&
        !this.options.allowedNetworks.includes(req.network)
      ) {
        continue;
      }

      if (this.options.maxPayment && this.options.maxPayment > 0n) {
        const amount = BigInt(req.amount);
        if (amount > this.options.maxPayment) continue;
      }

      return req;
    }

    return null;
  }

  async createPayment(
    requirements: ZkPaymentRequirements,
    resource?: ResourceInfo
  ): Promise<PaymentResult> {
    // Ensure Poseidon is initialized (needed for proof generation)
    await initPoseidon();

    const amount = BigInt(requirements.amount);
    const relayer = requirements.relayer ?? "0x0000000000000000000000000000000000000000";
    const fee = BigInt(requirements.relayerFee ?? "0");

    // Determine recipient: stealth address or direct payTo
    let recipient: string;
    let ephemeralPubKey = "0x";

    if (requirements.stealthMetaAddress) {
      const meta = deserializeStealthMetaAddress(requirements.stealthMetaAddress);
      const stealthPayment = generateStealthPayment(meta);
      recipient = stealthPayment.stealthAddress;
      ephemeralPubKey = stealthPayment.ephemeralPubKey;
    } else {
      recipient = requirements.payTo;
    }

    // Generate proof only (no on-chain TX)
    const proofResult = await this.client.generateWithdrawProof(
      recipient,
      amount,
      relayer,
      fee
    );

    const zkPayload: ZkExactPayload = {
      from: "shielded",
      nullifierHash: proofResult.nullifierHash.toString(),
      newCommitment: proofResult.newCommitment.toString(),
      merkleRoot: proofResult.merkleRoot.toString(),
      proof: proofResult.proof.map((p) => p.toString()),
      recipient,
      amount: amount.toString(),
      relayer,
      fee: fee.toString(),
      ephemeralPubKey,
    };

    const v2Payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: zkPayload,
    };

    if (resource) {
      v2Payload.resource = resource;
    }

    const paymentHeader = encodePaymentHeader(v2Payload);

    // H5 FIX: Only expose commitment and balance for consumeNote, not secrets
    return {
      nullifierHash: proofResult.nullifierHash.toString(),
      paymentHeader,
      requirements,
      _proofResult: {
        spentNoteCommitment: proofResult.spentNoteCommitment,
        changeNote: proofResult.changeNote
          ? {
              commitment: proofResult.changeNote.commitment,
              balance: proofResult.changeNote.balance,
              nullifierSecret: proofResult.changeNote.nullifierSecret,
              randomness: proofResult.changeNote.randomness,
            }
          : undefined,
      },
    };
  }

  async handlePaymentRequired(response: Response): Promise<PaymentResult | null> {
    const paymentRequired = await this.parsePaymentRequired(response);
    if (!paymentRequired) return null;

    const requirement = this.selectRequirement(paymentRequired.accepts);
    if (!requirement) return null;

    return this.createPayment(requirement, paymentRequired.resource);
  }
}

function encodePaymentHeader(payload: V2PaymentPayload): string {
  const json = JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? value.toString() : (value as unknown)
  );
  return Buffer.from(json).toString("base64"); // L5 FIX
}

export function decodePaymentHeader(header: string): V2PaymentPayload {
  const json = Buffer.from(header, "base64").toString("utf-8"); // L5 FIX
  return JSON.parse(json) as V2PaymentPayload;
}
