/**
 * Agent Seller — serves weather data behind a GhostPay ZK paywall
 *
 * The server acts as a relayer: receives ZK proof from buyer, calls
 * ShieldedPool.withdraw() on-chain, then returns the weather data.
 *
 * Usage: PRIVATE_KEY=0x... pnpm seller
 */
import express from "express";
import { ethers } from "ethers";
import {
  initPoseidon,
  AgentStealthKeypair,
  serializeStealthMetaAddress,
} from "ghostpay-sdk";
import { ghostPaywall } from "ghostpay-sdk/x402";

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY env var (seller needs ETH for gas)");
    process.exit(1);
  }

  const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const POOL_ADDRESS =
    process.env.SHIELDED_POOL_ADDRESS ?? "0xdc794e8314f45D337B4aefBc45D098c3ed172E4a";
  const USDC_ADDRESS =
    process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("=== GhostPay Seller Agent ===\n");
  console.log(`Wallet:  ${signer.address}`);
  console.log(`Pool:    ${POOL_ADDRESS}`);

  // Init Poseidon (needed for stealth key derivation)
  await initPoseidon();

  // Generate stealth keypair for private receiving
  const stealthKeypair = AgentStealthKeypair.generate();
  const stealthMeta = serializeStealthMetaAddress(stealthKeypair.getMetaAddress());

  console.log(`Stealth meta-address registered`);

  const app = express();

  // Paywall: 1 USDC for weather data — server submits withdraw() on-chain
  app.use(
    "/api/weather",
    ghostPaywall({
      price: "1000000", // 1 USDC (6 decimals)
      asset: USDC_ADDRESS,
      recipient: signer.address,
      poolAddress: POOL_ADDRESS,
      network: "eip155:84532",
      signer,
      stealthMetaAddress: stealthMeta,
      relayer: signer.address,
      relayerFee: "50000", // 0.05 USDC relayer fee
    })
  );

  app.get("/api/weather", (req, res) => {
    const paymentInfo = req.paymentInfo;
    console.log(
      `  Payment received! TX: ${paymentInfo?.txHash ?? "unknown"} → recipient: ${paymentInfo?.recipient ?? "unknown"}`
    );

    res.json({
      location: "Istanbul",
      temperature: 18,
      condition: "Partly Cloudy",
      humidity: 65,
      timestamp: new Date().toISOString(),
      paymentTx: paymentInfo?.txHash,
    });
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "GhostPay Weather Agent (ZK Relayer)",
      endpoints: {
        "/api/weather": "GET — 1 USDC (x402 zk-exact, server-as-relayer)",
      },
    });
  });

  const port = Number(process.env.SELLER_PORT ?? "3001");
  app.listen(port, () => {
    console.log(`\nSeller agent listening on port ${port}`);
    console.log(`  Weather endpoint: http://localhost:${port}/api/weather (1 USDC)`);
    console.log(`  Server acts as relayer — buyer only generates ZK proof\n`);
  });
}

main().catch(console.error);
