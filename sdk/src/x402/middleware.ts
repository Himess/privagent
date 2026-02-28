import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Contract, Signer, ethers } from "ethers";
import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
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
 * V3: C3 (recipient validation), C5 (relayer/fee validation), H2 (pre-flight checks)
 */
export function ghostPaywall(config: GhostPaywallConfig): RequestHandler {
  if (!config.signer) {
    throw new Error("ghostPaywall requires a signer for on-chain withdrawal");
  }

  const network = config.network ?? "eip155:84532"; // Base Sepolia default
  const poolContract = new Contract(config.poolAddress, POOL_ABI, config.signer);

  // Load verification key for off-chain proof checking (gas drain prevention)
  let vkey: Record<string, unknown> | undefined;
  if (config.verificationKey) {
    vkey = config.verificationKey;
  } else if (config.verificationKeyPath) {
    vkey = JSON.parse(readFileSync(config.verificationKeyPath, "utf-8")) as Record<string, unknown>;
  }

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

    // [SDK-C1] Limit payload size to prevent DoS
    const MAX_PAYLOAD_SIZE = 100 * 1024; // 100KB
    if (paymentHeader.length > MAX_PAYLOAD_SIZE) {
      res.status(400).json({ error: "Payment header too large" });
      return;
    }

    // Decode payment header
    let payload: V2PaymentPayload;
    try {
      const json = Buffer.from(paymentHeader, "base64").toString("utf-8");
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
    if (!p.nullifierHash || p.newCommitment === undefined || p.newCommitment === null || !p.merkleRoot || !p.recipient || !p.amount) {
      res.status(400).json({ error: "Missing required payment fields" });
      return;
    }

    // Validate amount matches price
    if (p.amount !== config.price) {
      res.status(400).json({
        error: "Invalid payment",
      });
      return;
    }

    // C3 FIX: Validate recipient matches config (skip when stealth enabled)
    if (!config.stealthMetaAddress && p.recipient.toLowerCase() !== config.recipient.toLowerCase()) {
      res.status(400).json({ error: "Invalid payment" });
      return;
    }

    // C5 FIX: Validate relayer
    const expectedRelayer = config.relayer ?? ethers.ZeroAddress;
    if (p.relayer.toLowerCase() !== expectedRelayer.toLowerCase()) {
      res.status(400).json({ error: "Invalid payment" });
      return;
    }

    // C5 FIX: Validate fee
    const expectedFee = config.relayerFee ?? "0";
    if (BigInt(p.fee) > BigInt(config.maxFee ?? expectedFee)) {
      res.status(400).json({ error: "Invalid payment" });
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

    // [SDK-H5] Off-chain proof verification FIRST (before state checks)
    if (vkey) {
      try {
        const publicSignals = [
          BigInt(p.newCommitment).toString(),
          BigInt(p.merkleRoot).toString(),
          BigInt(p.nullifierHash).toString(),
          BigInt(p.recipient).toString(),
          p.amount,
          BigInt(p.relayer).toString(),
          p.fee,
        ];

        const proofForVerify = {
          pi_a: [p.proof[0], p.proof[1], "1"],
          pi_b: [[p.proof[2], p.proof[3]], [p.proof[4], p.proof[5]], ["1", "0"]],
          pi_c: [p.proof[6], p.proof[7], "1"],
          protocol: "groth16",
          curve: "bn128",
        };

        const isValid = await snarkjs.groth16.verify(
          vkey,
          publicSignals,
          proofForVerify
        );
        if (!isValid) {
          res.status(400).json({ error: "Invalid payment" });
          return;
        }
      } catch {
        res.status(400).json({ error: "Invalid payment" });
        return;
      }
    }

    // Pre-flight state checks (after proof verification) [SDK-H5]
    try {
      const [rootKnown, nullifierUsed] = await Promise.all([
        poolContract.isKnownRoot(merkleRootBytes32),
        poolContract.nullifiers(nullifierHashBytes32),
      ]);

      if (!rootKnown) {
        res.status(402).json({ error: "Stale payment, retry", x402Version: 2 });
        return;
      }

      if (nullifierUsed) {
        res.status(402).json({ error: "Payment already processed", x402Version: 2 });
        return;
      }
    } catch {
      res.status(500).json({ error: "Payment verification failed" });
      return;
    }

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
        res.status(500).json({ error: "Payment processing failed" });
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
    } catch {
      // L6 FIX: Generic error message — no internal details
      res.status(500).json({ error: "Payment processing failed" });
    }
  };
}
