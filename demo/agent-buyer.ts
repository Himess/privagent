/**
 * Agent Buyer — deposits USDC into ShieldedPool, then uses ghostFetch
 * to privately purchase weather data from the seller agent.
 *
 * New flow: buyer generates ZK proof only, sends it in Payment header.
 * Server (seller) calls withdraw() on-chain as relayer.
 *
 * Usage: PRIVATE_KEY=0x... pnpm buyer
 */
import { ethers } from "ethers";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  ShieldedPoolClient,
  initPoseidon,
  BASE_SEPOLIA_USDC,
} from "ghostpay-sdk";
import { createGhostFetch } from "ghostpay-sdk/x402";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("=== GhostPay Buyer Agent ===\n");

  // Setup
  const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY env var");
    process.exit(1);
  }

  const poolAddress =
    process.env.SHIELDED_POOL_ADDRESS ?? "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet: ${signer.address}`);
  console.log(`Pool:   ${poolAddress}\n`);

  // Circuit paths
  const circuitWasm = path.resolve(__dirname, "../circuits/build/privatePayment_js/privatePayment.wasm");
  const circuitZkey = path.resolve(__dirname, "../circuits/build/privatePayment_final.zkey");
  const circuitVkey = path.resolve(__dirname, "../circuits/build/verification_key.json");

  // Initialize SDK with circuit paths (buyer generates proofs)
  await initPoseidon();
  const client = new ShieldedPoolClient({
    provider,
    signer,
    poolAddress,
    circuitWasm,
    circuitZkey,
    circuitVkey,
  });
  await client.initialize();
  console.log(`Tree synced. Local root: ${client.getLocalRoot().toString().slice(0, 20)}...\n`);

  // Deposit 2 USDC
  const depositAmount = 2_000_000n; // 2 USDC
  console.log(`Depositing ${Number(depositAmount) / 1e6} USDC...`);

  const depositResult = await client.deposit(depositAmount, BASE_SEPOLIA_USDC);
  console.log(`  TX: ${depositResult.txHash}`);
  console.log(`  Leaf index: ${depositResult.leafIndex}`);
  console.log(`  Shielded balance: ${Number(client.getTotalBalance()) / 1e6} USDC\n`);

  // Create x402-aware fetch (proof generation happens automatically on 402)
  const ghostFetch = createGhostFetch(client);

  // Buy weather data privately
  const sellerUrl = process.env.SELLER_URL ?? "http://localhost:3001/api/weather";
  console.log(`Fetching weather data from ${sellerUrl}...`);
  console.log(`  Step 1: GET → expect 402 with requirements`);
  console.log(`  Step 2: Generate ZK proof client-side (no TX)`);
  console.log(`  Step 3: Retry with proof in Payment header`);
  console.log(`  Step 4: Server calls withdraw() on-chain as relayer\n`);

  const response = await ghostFetch(sellerUrl);

  if (!response.ok) {
    console.error(`Request failed: ${response.status} ${response.statusText}`);
    const body = await response.text();
    console.error(body);
    process.exit(1);
  }

  const txHash = response.headers.get("X-Payment-TxHash");
  const data = await response.json();

  console.log(`Weather data received:`);
  console.log(`  Location:    ${data.location}`);
  console.log(`  Temperature: ${data.temperature}C`);
  console.log(`  Condition:   ${data.condition}`);
  console.log(`  Payment TX:  ${txHash ?? data.paymentTx ?? "unknown"}`);
  console.log(`\nRemaining shielded balance: ${Number(client.getTotalBalance()) / 1e6} USDC`);
}

main().catch(console.error);
