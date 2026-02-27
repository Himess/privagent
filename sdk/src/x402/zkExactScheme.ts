import { ShieldedPoolClient } from "../pool.js";
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
    const amount = BigInt(requirements.amount);
    const relayer = requirements.relayer ?? "0x0000000000000000000000000000000000000000";
    const fee = BigInt(requirements.relayerFee ?? "0");

    // Execute withdrawal through pool client
    const result = await this.client.withdraw(
      requirements.payTo,
      amount,
      relayer,
      fee
    );

    const zkPayload: ZkExactPayload = {
      from: "shielded",
      nullifierHash: result.nullifierHash.toString(),
      newCommitment: result.newNote?.commitment.toString() ?? "0",
      merkleRoot: this.client.getLocalRoot().toString(),
      proof: result.txHash, // TX hash serves as proof of on-chain settlement
      relayer,
      fee: fee.toString(),
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
      nullifierHash: result.nullifierHash.toString(),
      paymentHeader,
      requirements,
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
