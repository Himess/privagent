/**
 * Agent Buyer — deposits USDC into ShieldedPool, then uses ghostFetch
 * to privately purchase weather data from the seller agent.
 *
 * Usage: pnpm buyer
 */
import { ethers } from "ethers";
import {
  ShieldedPoolClient,
  initPoseidon,
  BASE_SEPOLIA_USDC,
} from "ghostpay-sdk";
import { createGhostFetch } from "ghostpay-sdk/x402";

async function main() {
  console.log("=== GhostPay Buyer Agent ===\n");

  // Setup
  const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY env var");
    process.exit(1);
  }

  const poolAddress = process.env.SHIELDED_POOL_ADDRESS;
  if (!poolAddress) {
    console.error("Set SHIELDED_POOL_ADDRESS env var");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet: ${signer.address}`);
  console.log(`Pool:   ${poolAddress}\n`);

  // Initialize SDK
  await initPoseidon();
  const client = new ShieldedPoolClient({
    provider,
    signer,
    poolAddress,
  });
  await client.initialize();

  // Deposit 5 USDC
  const depositAmount = 5_000_000n; // 5 USDC
  console.log(`Depositing ${Number(depositAmount) / 1e6} USDC...`);

  const depositResult = await client.deposit(depositAmount, BASE_SEPOLIA_USDC);
  console.log(`  TX: ${depositResult.txHash}`);
  console.log(`  Leaf index: ${depositResult.leafIndex}`);
  console.log(`  Shielded balance: ${Number(client.getTotalBalance()) / 1e6} USDC\n`);

  // Create x402-aware fetch
  const ghostFetch = createGhostFetch(client);

  // Buy weather data privately
  const sellerUrl = process.env.SELLER_URL ?? "http://localhost:3001/api/weather";
  console.log(`Fetching weather data from ${sellerUrl}...`);

  const response = await ghostFetch(sellerUrl);
  const data = await response.json();

  console.log(`\nWeather data received:`);
  console.log(`  Location: ${data.location}`);
  console.log(`  Temperature: ${data.temperature}C`);
  console.log(`  Condition: ${data.condition}`);
  console.log(`\nRemaining shielded balance: ${Number(client.getTotalBalance()) / 1e6} USDC`);
}

main().catch(console.error);
