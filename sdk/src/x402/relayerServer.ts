// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1

/**
 * GhostPay Relayer Server — reference implementation.
 *
 * A relayer accepts ZK proofs from clients and submits on-chain
 * transactions on their behalf, earning a fee for the gas cost.
 *
 * Usage:
 *   const app = createRelayerServer({ privateKey, poolAddress, rpcUrl });
 *   app.listen(3002, () => console.log('Relayer on :3002'));
 */

export interface RelayerConfig {
  privateKey: string;
  poolAddress: string;
  rpcUrl: string;
  port?: number;
  minFee?: bigint;
}

export interface RelaySubmitRequest {
  proof: {
    pA: string[];
    pB: string[][];
    pC: string[];
  };
  publicSignals: string[];
  extData: {
    recipient: string;
    relayer: string;
    fee: string;
    encryptedOutput1: string;
    encryptedOutput2: string;
  };
  viewTags: number[];
}

export interface RelaySubmitResponse {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  fee?: string;
  message?: string;
}

/**
 * Create a relayer Express app.
 *
 * Endpoints:
 *   GET  /v1/info  — relayer status + supported pools
 *   POST /v1/relay — submit a ZK proof for on-chain execution
 *   GET  /v1/health — health check
 *
 * NOTE: This is a reference implementation. Production relayers should add:
 *  - Rate limiting
 *  - Off-chain proof verification before submission
 *  - Nonce management for concurrent TXs
 *  - Gas price oracle integration
 */
export function createRelayerServer(config: RelayerConfig) {
  // Dynamic import to avoid bundling express as hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express") as any;
  const app = express.default ? express.default() : express();
  app.use((express.default || express).json());

  app.get("/v1/info", (_req: any, res: any) => {
    res.json({
      status: "online",
      fee: (config.minFee || 20000n).toString(),
      supportedPools: [config.poolAddress],
      rpcUrl: config.rpcUrl.replace(/\/\/.*@/, "//***@"), // redact API key
    });
  });

  app.post("/v1/relay", async (req: any, res: any) => {
    try {
      const { proof, publicSignals, extData, viewTags } =
        req.body as RelaySubmitRequest;

      if (!proof || !publicSignals || !extData) {
        return res
          .status(400)
          .json({ success: false, message: "Missing proof, publicSignals, or extData" });
      }

      if (!viewTags || !Array.isArray(viewTags)) {
        return res
          .status(400)
          .json({ success: false, message: "Missing viewTags array" });
      }

      // Min fee check
      const relayerFee = BigInt(extData.fee || "0");
      if (config.minFee && relayerFee < config.minFee) {
        return res
          .status(400)
          .json({ success: false, message: `Fee too low. Minimum: ${config.minFee}` });
      }

      // NOTE: In production, submit TX to pool contract here:
      // const { ethers } = await import("ethers");
      // const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      // const wallet = new ethers.Wallet(config.privateKey, provider);
      // const pool = new ethers.Contract(config.poolAddress, POOL_ABI, wallet);
      // const tx = await pool.transact(args, extData);
      // const receipt = await tx.wait();

      res.json({
        success: true,
        txHash: "0x" + "0".repeat(64), // placeholder
        blockNumber: 0,
        fee: relayerFee.toString(),
      } satisfies RelaySubmitResponse);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, message: msg });
    }
  });

  app.get("/v1/health", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return app;
}
