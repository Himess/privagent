// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Contract, ethers } from "ethers";
import * as snarkjs from "snarkjs";
import type {
  ZkPaymentRequirementsV4,
  V4PaymentPayload,
  PaymentRequiredV4,
  PrivAgentwallConfigV4,
  PaymentInfo,
} from "../types.js";
import { computeExtDataHash } from "../v4/extData.js";
import { decryptNote } from "../v4/noteEncryption.js";

// [M4] In-memory rate limiter for DoS protection
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitStore: Map<string, RateLimitEntry> = new Map();
let lastCleanup = Date.now();

function checkRateLimit(ip: string, maxRequests: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now();
  // [H6] Periodic cleanup to prevent memory leak
  if (now - lastCleanup > windowMs) {
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) rateLimitStore.delete(key);
    }
    lastCleanup = now;
  }
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}

const POOL_V4_ABI = [
  "function transact((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, bytes32 root, int256 publicAmount, bytes32 extDataHash, uint256 protocolFee, bytes32[] inputNullifiers, bytes32[] outputCommitments, uint8[] viewTags) args, (address recipient, address relayer, uint256 fee, bytes encryptedOutput1, bytes encryptedOutput2) extData) external",
  "function isKnownRoot(bytes32) external view returns (bool)",
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
 * Express middleware that puts a PrivAgent V4 ZK paywall on a route.
 *
 * V4: Amount is HIDDEN. Server acts as relayer: receives JoinSplit proof
 * in Payment header, decrypts encrypted note to verify amount off-chain,
 * then calls ShieldedPoolV4.transact() on-chain.
 */
export function privAgentPaywallV4(config: PrivAgentwallConfigV4): RequestHandler {
  if (!config.signer) {
    throw new Error("privAgentPaywallV4 requires a signer for on-chain transactions");
  }

  const network = config.network ?? "eip155:84532"; // Base Sepolia default
  const poolContract = new Contract(config.poolAddress, POOL_V4_ABI, config.signer);

  // [C2] Nullifier mutex — prevent race condition between pre-flight check and TX submission
  const pendingNullifiers = new Set<string>();

  return async (req: Request, res: Response, next: NextFunction) => {
    // [C3] Rate limiting — use socket address to prevent X-Forwarded-For spoofing
    const clientIp = req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const paymentHeader = req.headers["payment"] as string | undefined;

    // ===== No Payment header → return 402 =====
    if (!paymentHeader) {
      const requestUrl = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;

      const requirements: ZkPaymentRequirementsV4 = {
        scheme: "zk-exact-v2",
        network,
        price: config.price,
        asset: config.asset,
        poolAddress: config.poolAddress,
        payToPubkey: config.poseidonPubkey,
        serverEcdhPubKey: bytesToHex(config.ecdhPublicKey),
        relayer: config.relayer,
        relayerFee: config.relayerFee,
        maxTimeoutSeconds: config.maxTimeoutSeconds ?? 300,
      };

      const body: PaymentRequiredV4 = {
        x402Version: 4,
        accepts: [requirements],
        resource: {
          url: requestUrl,
          method: req.method,
        },
      };

      res.status(402).json(body);
      return;
    }

    // ===== Decode Payment header =====
    // [SDK-C1] Limit payload size to prevent DoS
    const MAX_PAYLOAD_SIZE = 100 * 1024; // 100KB
    if (paymentHeader.length > MAX_PAYLOAD_SIZE) {
      res.status(400).json({ error: "Payment header too large" });
      return;
    }

    let payload: V4PaymentPayload;
    try {
      const json = Buffer.from(paymentHeader, "base64").toString("utf-8");
      payload = JSON.parse(json) as V4PaymentPayload;
    } catch {
      res.status(400).json({ error: "Invalid Payment header encoding" });
      return;
    }

    // Validate basic structure
    if (payload.x402Version !== 4 || !payload.payload) {
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
    if (
      !Array.isArray(p.nullifiers) ||
      !Array.isArray(p.commitments) ||
      !p.root ||
      !p.extData ||
      !p.senderEcdhPubKey
    ) {
      res.status(400).json({ error: "Missing required payment fields" });
      return;
    }

    // Validate circuit config
    if (p.nIns < 1 || p.nIns > 2 || p.nOuts !== 2) {
      res.status(400).json({ error: "Invalid circuit configuration" });
      return;
    }

    if (p.nullifiers.length !== p.nIns || p.commitments.length !== p.nOuts) {
      res.status(400).json({ error: "Nullifier/commitment count mismatch" });
      return;
    }

    // ===== Verify extDataHash =====
    let enc1: Uint8Array;
    let enc2: Uint8Array;
    try {
      enc1 = hexToBytes(p.extData.encryptedOutput1);
      enc2 = hexToBytes(p.extData.encryptedOutput2);
      const recomputedHash = computeExtDataHash({
        recipient: p.extData.recipient,
        relayer: p.extData.relayer,
        fee: BigInt(p.extData.fee),
        encryptedOutput1: enc1,
        encryptedOutput2: enc2,
      });
      if (recomputedHash.toString() !== p.extDataHash) {
        res.status(400).json({ error: "extDataHash mismatch" });
        return;
      }
    } catch (err) {
      console.error("[privagent] extData validation failed:", err instanceof Error ? err.message : err);
      res.status(400).json({ error: "Invalid extData" });
      return;
    }

    // ===== Validate relayer =====
    const expectedRelayer = config.relayer ?? ethers.ZeroAddress;
    if (p.extData.relayer.toLowerCase() !== expectedRelayer.toLowerCase()) {
      res.status(400).json({ error: "Invalid payment" });
      return;
    }

    // ===== Validate fee =====
    const expectedFee = config.relayerFee ?? "0";
    if (BigInt(p.extData.fee) > BigInt(config.maxFee ?? expectedFee)) {
      res.status(400).json({ error: "Invalid payment" });
      return;
    }

    // ===== Decrypt encrypted note to verify amount =====
    try {
      const senderPubKey = hexToBytes(p.senderEcdhPubKey);
      const decrypted = decryptNote(enc1, config.ecdhPrivateKey, senderPubKey);

      if (!decrypted) {
        res.status(400).json({ error: "Cannot decrypt payment note" });
        return;
      }

      if (decrypted.amount < BigInt(config.price)) {
        res.status(400).json({ error: "Invalid payment amount" });
        return;
      }

      // [SDK-H4] Validate recipient pubkey matches server config
      if (decrypted.pubkey.toString() !== config.poseidonPubkey) {
        res.status(400).json({ error: "Invalid payment recipient" });
        return;
      }
    } catch (err) {
      console.error("[privagent] Note decryption failed:", err instanceof Error ? err.message : err);
      res.status(400).json({ error: "Payment verification failed" });
      return;
    }

    // ===== Pre-flight: root and nullifier checks =====
    const rootBytes32 = toBytes32(BigInt(p.root));
    const nullifierBytes32 = p.nullifiers.map((n) => toBytes32(BigInt(n)));

    // [C2] Check nullifier mutex — prevent race condition
    for (const nb of nullifierBytes32) {
      if (pendingNullifiers.has(nb)) {
        res.status(409).json({ error: "Payment already being processed" });
        return;
      }
    }
    // Lock nullifiers
    for (const nb of nullifierBytes32) pendingNullifiers.add(nb);

    try {
      const rootKnown = await poolContract.isKnownRoot(rootBytes32);
      if (!rootKnown) {
        for (const nb of nullifierBytes32) pendingNullifiers.delete(nb);
        res.status(402).json({ error: "Stale payment, retry", x402Version: 4 });
        return;
      }

      for (const nb of nullifierBytes32) {
        const used = await poolContract.nullifiers(nb);
        if (used) {
          for (const nb2 of nullifierBytes32) pendingNullifiers.delete(nb2);
          res.status(402).json({ error: "Payment already processed", x402Version: 4 });
          return;
        }
      }
    } catch (err) {
      for (const nb of nullifierBytes32) pendingNullifiers.delete(nb);
      // [M2] Log validation failure
      console.error("[privagent] Pre-flight check failed:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Payment verification failed" });
      return;
    }

    // ===== Off-chain proof verification =====
    const circuitKey = `${p.nIns}x${p.nOuts}`;
    const vkey = config.verificationKeys?.[circuitKey];
    if (vkey) {
      try {
        // Public signals V4.4: [root, publicAmount, extDataHash, protocolFee, ...nullifiers, ...commitments]
        const publicSignals = [
          BigInt(p.root).toString(),
          BigInt(p.publicAmount).toString(),
          BigInt(p.extDataHash).toString(),
          BigInt(p.protocolFee).toString(),
          ...p.nullifiers.map((n) => BigInt(n).toString()),
          ...p.commitments.map((c) => BigInt(c).toString()),
        ];

        // Reconstruct snarkjs proof format (un-swap pB from Solidity order)
        const proofForVerify = {
          pi_a: [p.proof[0], p.proof[1], "1"],
          pi_b: [
            [p.proof[3], p.proof[2]],
            [p.proof[5], p.proof[4]],
            ["1", "0"],
          ],
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
          res.status(400).json({ error: "Invalid proof" });
          return;
        }
      } catch (err) {
        console.error("[privagent] Proof verification error:", err instanceof Error ? err.message : err);
        res.status(400).json({ error: "Proof verification failed" });
        return;
      }
    }

    // ===== Submit transact() on-chain =====
    try {
      const proofBigints = p.proof.map((s) => BigInt(s));
      const commitmentBytes32 = p.commitments.map((c) => toBytes32(BigInt(c)));

      const tx = await poolContract.transact(
        {
          pA: [proofBigints[0], proofBigints[1]],
          pB: [
            [proofBigints[2], proofBigints[3]],
            [proofBigints[4], proofBigints[5]],
          ],
          pC: [proofBigints[6], proofBigints[7]],
          root: rootBytes32,
          publicAmount: BigInt(p.publicAmount),
          extDataHash: toBytes32(BigInt(p.extDataHash)),
          protocolFee: BigInt(p.protocolFee),
          inputNullifiers: nullifierBytes32,
          outputCommitments: commitmentBytes32,
          viewTags: p.viewTags,
        },
        {
          recipient: p.extData.recipient,
          relayer: p.extData.relayer,
          fee: BigInt(p.extData.fee),
          encryptedOutput1: enc1,
          encryptedOutput2: enc2,
        }
      );

      const receipt = await tx.wait();

      // [C2] Release nullifier lock after TX completes
      for (const nb of nullifierBytes32) pendingNullifiers.delete(nb);

      if (!receipt || receipt.status === 0) {
        res.status(500).json({ error: "Payment processing failed" });
        return;
      }

      // Attach payment info
      req.paymentInfo = {
        nullifierHash: p.nullifiers[0],
        from: p.from ?? "shielded",
        amount: config.price,
        asset: config.asset,
        recipient: config.poseidonPubkey,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      };

      res.setHeader("X-Payment-TxHash", tx.hash);
      next();
    } catch (err) {
      // [C2] Release nullifier lock on error
      for (const nb of nullifierBytes32) pendingNullifiers.delete(nb);
      // [M2] Log TX submission failure
      console.error("[privagent] TX submission failed:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Payment processing failed" });
    }
  };
}

// ============================================================================
// Helpers
// ============================================================================

function toBytes32(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(h, "hex"));
}

function bytesToHex(arr: Uint8Array): string {
  return "0x" + Buffer.from(arr).toString("hex");
}
