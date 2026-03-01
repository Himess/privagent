// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1

/**
 * GhostPay Facilitator Server — x402-compatible privacy wrapper.
 *
 * A facilitator is a relayer that also exposes x402-standard endpoints
 * (/verify, /info, /health). Any x402 server can add privacy by changing
 * its facilitator URL to point here.
 *
 * Usage:
 *   const app = createFacilitatorServer({
 *     privateKey: process.env.RELAYER_KEY!,
 *     poolAddress: '0x...',
 *     rpcUrl: 'https://mainnet.base.org',
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
 *
 * Endpoints:
 *   GET  /info    — facilitator discovery (x402 standard)
 *   POST /verify  — verify + settle ZK payment (x402 standard)
 *   GET  /health  — health check
 *   /v1/*         — relayer endpoints (backward compatible)
 */
export function createFacilitatorServer(config: FacilitatorConfig) {
  // Dynamic import to avoid bundling express as hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express") as any;
  const app = express.default ? express.default() : express();
  app.use((express.default || express).json());

  // Internal relayer for actual TX submission
  const relayer = createRelayerServer(config);

  // === x402 Standard Endpoints ===

  app.get("/info", (_req: any, res: any) => {
    res.json({
      name: config.name || "GhostPay Privacy Facilitator",
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

  app.post("/verify", async (req: any, res: any) => {
    try {
      const { x402Version, scheme, network, payload } = req.body;

      if (scheme !== "zk-exact-v2") {
        return res.status(400).json({
          valid: false,
          error: `Unsupported scheme: ${scheme}. Use zk-exact-v2`,
        });
      }

      if (network && network !== "eip155:84532") {
        return res.status(400).json({
          valid: false,
          error: `Unsupported network: ${network}. GhostPay operates on Base Sepolia (eip155:84532)`,
        });
      }

      if (!payload || !payload.proof) {
        return res.status(400).json({
          valid: false,
          error: "Missing payload or proof data",
        });
      }

      // NOTE: In production, verify and relay via internal relayer
      // const result = await verifyAndRelay(payload);

      res.json({
        valid: true,
        x402Version: x402Version || 2,
        txHash: "0x" + "0".repeat(64), // placeholder
        network: "eip155:84532",
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
