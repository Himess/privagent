/**
 * GhostPay Express Server — Privacy Paywall Example
 *
 * Adds a privacy-preserving paywall to API endpoints.
 * Payments are verified via ZK proofs — amounts stay hidden.
 */

import express from "express";
import { ghostPaywallV4, initPoseidon } from "ghostpay-sdk/x402";
import { JsonRpcProvider, Wallet } from "ethers";

const POOL_ADDRESS = "0x17B6209385c2e36E6095b89572273175902547f9";
const PORT = 3001;

async function main() {
  await initPoseidon();

  const provider = new JsonRpcProvider(
    process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"
  );
  const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

  const app = express();

  // Free endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Premium endpoint — 1 USDC per request, privacy-preserving
  app.get(
    "/api/weather",
    ghostPaywallV4({
      price: 1_000000n, // 1 USDC
      signer,
      poolAddress: POOL_ADDRESS,
    }),
    (_req, res) => {
      res.json({
        city: "Istanbul",
        temperature: 22,
        condition: "Sunny",
        humidity: 45,
        wind: "12 km/h NW",
        source: "GhostPay Demo API",
      });
    }
  );

  // Premium endpoint — 5 USDC per request
  app.get(
    "/api/market-data",
    ghostPaywallV4({
      price: 5_000000n, // 5 USDC
      signer,
      poolAddress: POOL_ADDRESS,
    }),
    (_req, res) => {
      res.json({
        pairs: [
          { pair: "BTC/USD", price: 98500, change24h: "+2.3%" },
          { pair: "ETH/USD", price: 3850, change24h: "+1.7%" },
        ],
        timestamp: Date.now(),
      });
    }
  );

  app.listen(PORT, () => {
    console.log(`GhostPay API server running on http://localhost:${PORT}`);
    console.log(`  Free:    GET /api/health`);
    console.log(`  1 USDC:  GET /api/weather`);
    console.log(`  5 USDC:  GET /api/market-data`);
  });
}

main().catch(console.error);
