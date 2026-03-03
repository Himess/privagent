// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1

/**
 * [C3] PrivAgent Facilitator Server — x402-compatible privacy wrapper.
 *
 * A facilitator is a relayer that also exposes x402-standard endpoints
 * (/verify, /info, /health). Real TX submission via pool.transact().
 *
 * Usage:
 *   const app = createFacilitatorServer({
 *     privateKey: process.env.RELAYER_KEY!,
 *     poolAddress: '0x...',
 *     poolAbi: ShieldedPoolV4ABI,
 *     rpcUrl: 'https://sepolia.base.org',
 *   });
 *   app.listen(3001);
 */

import { createRelayerServer, type RelayerConfig } from "./relayerServer.js";

export interface FacilitatorConfig extends RelayerConfig {
  name?: string;
  version?: string;
}

/**
 * Create a facilitator Express app with x402-standard endpoints.
 * Delegates real TX submission to internal relayer.
 */
export function createFacilitatorServer(config: FacilitatorConfig) {
  // Dynamic import to avoid bundling express as hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express") as any;
  const app = express.default ? express.default() : express();
  app.use((express.default || express).json({ limit: "100kb" }));

  // [H2] API key authentication middleware (same as relayer)
  if (config.apiKey) {
    app.use((req: any, res: any, nextFn: any) => {
      if (req.path === "/health" || req.path === "/info") return nextFn();
      const key = req.headers["x-privagent-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
      if (key !== config.apiKey) {
        return res.status(401).json({ valid: false, error: "Unauthorized: invalid API key" });
      }
      nextFn();
    });
  }

  // Internal relayer for actual TX submission
  const relayer = createRelayerServer(config);

  // Lazy-init provider/wallet/pool
  let _pool: any = null;
  let _wallet: any = null;
  let _provider: any = null;

  async function getPool() {
    if (!_pool) {
      const { ethers } = await import("ethers");
      _provider = new ethers.JsonRpcProvider(config.rpcUrl);
      _wallet = new ethers.Wallet(config.privateKey, _provider);
      _pool = new ethers.Contract(
        config.poolAddress,
        config.poolAbi,
        _wallet
      );
    }
    return { pool: _pool, wallet: _wallet, provider: _provider };
  }

  // === x402 Standard Endpoints ===

  app.get("/info", (_req: any, res: any) => {
    res.json({
      name: config.name || "PrivAgent Privacy Facilitator",
      version: config.version || "1.0.0",
      schemes: ["zk-exact-v2"],
      networks: ["eip155:84532"], // Base Sepolia
      tokens: ["USDC"],
      protocolFee: "0.1%",
      minFee: (config.minFee || 10000n).toString(),
      features: [
        "zk-utxo-privacy",
        "stealth-addresses",
        "encrypted-amounts",
        "view-tags",
        "circuit-level-fee",
      ],
    });
  });

  // [C3] /verify — real TX submission
  app.post("/verify", async (req: any, res: any) => {
    try {
      const { x402Version, scheme, network, payload } = req.body;

      if (scheme !== "zk-exact-v2") {
        return res.status(400).json({
          valid: false,
          error: `Unsupported scheme: ${scheme}. Use zk-exact-v2`,
        });
      }

      if (
        network &&
        network !== "eip155:84532" &&
        network !== "eip155:8453"
      ) {
        return res.status(400).json({
          valid: false,
          error: `Unsupported network: ${network}`,
        });
      }

      if (!payload || !payload.args || !payload.extData) {
        return res.status(400).json({
          valid: false,
          error: "Missing payload, args, or extData",
        });
      }

      const { args, extData } = payload;
      const { pool } = await getPool();

      // Gas estimation (validates proof on-chain)
      let gasEstimate: bigint;
      try {
        gasEstimate = await pool.transact.estimateGas(args, extData);
      } catch (gasError: unknown) {
        const reason =
          gasError instanceof Error ? gasError.message : "Unknown";
        return res
          .status(400)
          .json({ valid: false, error: `TX would fail: ${reason}` });
      }

      // Submit TX
      const tx = await pool.transact(args, extData, {
        gasLimit: (gasEstimate * 120n) / 100n,
      });
      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        return res
          .status(500)
          .json({ valid: false, error: "TX reverted on-chain" });
      }

      res.json({
        valid: true,
        x402Version: x402Version || 2,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        network: network || "eip155:84532",
        settledAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ valid: false, error: msg });
    }
  });

  app.get("/health", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Mount relayer endpoints for direct access
  app.use("/v1", relayer);

  return app;
}
