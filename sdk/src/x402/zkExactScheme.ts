import { ShieldedPoolClient } from "../pool.js";
import { initPoseidon } from "../poseidon.js";
import {
  generateStealthPayment,
  deriveStealthEthAddress,
  deserializeStealthMetaAddress,
} from "../stealth.js";
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
 * New flow: buyer generates proof client-side, sends raw proof in Payment header.
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
    // Ensure Poseidon is initialized (needed for stealth address derivation)
    await initPoseidon();

    const amount = BigInt(requirements.amount);
    const relayer = requirements.relayer ?? "0x0000000000000000000000000000000000000000";
    const fee = BigInt(requirements.relayerFee ?? "0");

    // Determine recipient: stealth address or direct payTo
    let recipient: string;
    let ephemeralPubKeyX = "0";
    let ephemeralPubKeyY = "0";

    if (requirements.stealthMetaAddress) {
      const meta = deserializeStealthMetaAddress(requirements.stealthMetaAddress);
      const stealthPayment = generateStealthPayment(
        meta.spendingPubKeyX,
        meta.spendingPubKeyY,
        meta.viewingPubKeyX,
        meta.viewingPubKeyY
      );
      recipient = deriveStealthEthAddress(
        stealthPayment.stealthAddressX,
        stealthPayment.stealthAddressY
      );
      ephemeralPubKeyX = stealthPayment.ephemeralPubKeyX.toString();
      ephemeralPubKeyY = stealthPayment.ephemeralPubKeyY.toString();
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
      ephemeralPubKeyX,
      ephemeralPubKeyY,
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

    return {
      nullifierHash: proofResult.nullifierHash.toString(),
      paymentHeader,
      requirements,
      _proofResult: proofResult,
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
  return btoa(json);
}

export function decodePaymentHeader(header: string): V2PaymentPayload {
  const json = atob(header);
  return JSON.parse(json) as V2PaymentPayload;
}
