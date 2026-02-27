import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Contract, Signer, ethers } from "ethers";
import type {
  ZkPaymentRequirements,
  V2PaymentPayload,
  PaymentRequired,
  PaymentInfo,
  GhostPaywallConfig,
} from "../types.js";

const POOL_ABI = [
  "function withdraw(address recipient, uint256 amount, bytes32 nullifierHash, bytes32 newCommitment, bytes32 merkleRoot, address relayer, uint256 fee, uint256[8] calldata proof) external",
  "function isKnownRoot(bytes32 root) external view returns (bool)",
  "function nullifiers(bytes32) external view returns (bool)",
];

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
 * Server acts as relayer: receives raw ZK proof in Payment header,
 * calls ShieldedPool.withdraw() on-chain, then forwards the request.
 *
 * Requires a signer with ETH for gas.
 */
export function ghostPaywall(config: GhostPaywallConfig): RequestHandler {
  if (!config.signer) {
    throw new Error("ghostPaywall requires a signer for on-chain withdrawal");
  }

  const network = config.network ?? "eip155:84532"; // Base Sepolia default
  const poolContract = new Contract(config.poolAddress, POOL_ABI, config.signer);

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
        stealthMetaAddress: config.stealthMetaAddress,
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

    const p = payload.payload;

    // Validate proof array
    if (!Array.isArray(p.proof) || p.proof.length !== 8) {
      res.status(400).json({ error: "Invalid proof: expected array of 8 elements" });
      return;
    }

    // Validate required fields
    if (!p.nullifierHash || !p.newCommitment || !p.merkleRoot || !p.recipient || !p.amount) {
      res.status(400).json({ error: "Missing required payment fields" });
      return;
    }

    // Validate amount matches price
    if (p.amount !== config.price) {
      res.status(400).json({
        error: `Amount mismatch: expected ${config.price}, got ${p.amount}`,
      });
      return;
    }

    // Convert proof strings to bigints
    let proofArray: bigint[];
    try {
      proofArray = p.proof.map((s) => BigInt(s));
    } catch {
      res.status(400).json({ error: "Invalid proof: elements must be valid integers" });
      return;
    }

    // Convert hashes to bytes32
    const nullifierHashBytes32 = ethers.zeroPadValue(
      ethers.toBeHex(BigInt(p.nullifierHash)),
      32
    );
    const newCommitmentBytes32 =
      BigInt(p.newCommitment) > 0n
        ? ethers.zeroPadValue(ethers.toBeHex(BigInt(p.newCommitment)), 32)
        : ethers.ZeroHash;
    const merkleRootBytes32 = ethers.zeroPadValue(
      ethers.toBeHex(BigInt(p.merkleRoot)),
      32
    );

    // Submit withdrawal on-chain
    try {
      const tx = await poolContract.withdraw(
        p.recipient,
        BigInt(p.amount),
        nullifierHashBytes32,
        newCommitmentBytes32,
        merkleRootBytes32,
        p.relayer,
        BigInt(p.fee),
        proofArray
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        res.status(500).json({ error: "Withdrawal transaction reverted" });
        return;
      }

      // Attach payment info
      req.paymentInfo = {
        nullifierHash: p.nullifierHash,
        from: p.from,
        amount: p.amount,
        asset: payload.accepted.asset,
        recipient: p.recipient,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      };

      // Set response header with TX hash for client reference
      res.setHeader("X-Payment-TxHash", tx.hash);

      next();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);

      // Parse common on-chain revert reasons
      if (message.includes("nullifier")) {
        res.status(402).json({ error: "Nullifier already used (double-spend)", x402Version: 2 });
      } else if (message.includes("root")) {
        res.status(402).json({ error: "Unknown merkle root (stale proof)", x402Version: 2 });
      } else if (message.includes("proof") || message.includes("verify")) {
        res.status(402).json({ error: "Invalid ZK proof", x402Version: 2 });
      } else {
        res.status(500).json({ error: `Withdrawal failed: ${message}` });
      }
    }
  };
}

