/**
 * Agent Seller — serves weather data behind a GhostPay paywall
 *
 * Usage: pnpm seller
 */
import express from "express";
import { ghostPaywall } from "ghostpay-sdk/x402";

const app = express();

const POOL_ADDRESS = process.env.SHIELDED_POOL_ADDRESS ?? "0x...";
const USDC_ADDRESS = process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SELLER_ADDRESS = process.env.SELLER_ADDRESS ?? "0x...";

// Paywall: 1 USDC for weather data
app.use(
  "/api/weather",
  ghostPaywall({
    price: "1000000", // 1 USDC (6 decimals)
    asset: USDC_ADDRESS,
    recipient: SELLER_ADDRESS,
    poolAddress: POOL_ADDRESS,
    network: "eip155:84532",
    relayer: process.env.RELAYER_ADDRESS,
    relayerFee: "50000", // 0.05 USDC
  })
);

app.get("/api/weather", (_req, res) => {
  // Only reachable after valid payment
  res.json({
    location: "Istanbul",
    temperature: 18,
    condition: "Partly Cloudy",
    humidity: 65,
    timestamp: new Date().toISOString(),
    paidBy: (_req as any).paymentInfo?.from ?? "unknown",
  });
});

app.get("/", (_req, res) => {
  res.json({
    name: "GhostPay Weather Agent",
    endpoints: {
      "/api/weather": "GET — 1 USDC (x402 zk-exact)",
    },
  });
});

const port = Number(process.env.SELLER_PORT ?? "3001");
app.listen(port, () => {
  console.log(`Seller agent listening on port ${port}`);
  console.log(`  Weather endpoint: http://localhost:${port}/api/weather (1 USDC)`);
});
