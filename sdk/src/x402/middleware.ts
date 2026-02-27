import type { Request, Response, NextFunction, RequestHandler } from "express";
import type {
  ZkPaymentRequirements,
  V2PaymentPayload,
  ZkExactPayload,
  PaymentRequired,
} from "../types.js";

export interface GhostPaywallConfig {
  price: string;
  asset: string;
  recipient: string;
  network?: string;
  poolAddress: string;
  relayer?: string;
  relayerFee?: string;
  maxTimeoutSeconds?: number;
  verifyPayment?: (payload: V2PaymentPayload) => Promise<boolean>;
}

export interface PaymentInfo {
  nullifierHash: string;
  from: string;
  amount: string;
  asset: string;
}

// Extend Express Request
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      paymentInfo?: PaymentInfo;
    }
  }
}

/**
 * Express middleware that puts a GhostPay ZK paywall on a route.
 *
 * Requests without a valid `Payment` header get a 402 response.
 * Requests with a valid payment header pass through with req.paymentInfo populated.
 */
export function ghostPaywall(config: GhostPaywallConfig): RequestHandler {
  const network = config.network ?? "eip155:84532"; // Base Sepolia default

  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers["payment"] as string | undefined;

    if (!paymentHeader) {
      const requestUrl = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;

      const requirements: ZkPaymentRequirements = {
        scheme: "zk-exact",
        network,
        amount: config.price,
        payTo: config.recipient,
        maxTimeoutSeconds: config.maxTimeoutSeconds ?? 300,
        asset: config.asset,
        poolAddress: config.poolAddress,
        relayer: config.relayer,
        relayerFee: config.relayerFee,
      };

      const body: PaymentRequired = {
        x402Version: 2,
        accepts: [requirements],
        resource: {
          url: requestUrl,
          method: req.method,
        },
      };

      res.status(402).json(body);
      return;
    }

    // Decode payment header
    let payload: V2PaymentPayload;
    try {
      const json = atob(paymentHeader);
      payload = JSON.parse(json) as V2PaymentPayload;
    } catch {
      res.status(400).json({ error: "Invalid Payment header encoding" });
      return;
    }

    // Validate basic structure
    if (payload.x402Version !== 2 || !payload.payload) {
      res.status(400).json({ error: "Invalid payment payload structure" });
      return;
    }

    // Verify payment if verifier provided
    if (config.verifyPayment) {
      try {
        const valid = await config.verifyPayment(payload);
        if (!valid) {
          res.status(402).json({
            error: "Payment verification failed",
            x402Version: 2,
          });
          return;
        }
      } catch (err) {
        res.status(500).json({
          error: `Payment verification error: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }

    // Attach payment info
    req.paymentInfo = {
      nullifierHash: payload.payload.nullifierHash,
      from: payload.payload.from,
      amount: payload.accepted.amount,
      asset: payload.accepted.asset,
    };

    next();
  };
}
