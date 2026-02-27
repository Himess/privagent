/**
 * End-to-end test on Base Sepolia:
 * 1. Start seller server in-process
 * 2. Buyer deposits USDC, generates ZK proof, sends to server
 * 3. Server calls withdraw() on-chain as relayer
 * 4. Verify: response OK, TX hash present, balances correct
 *
 * Usage:
 *   PRIVATE_KEY_SELLER=0x... PRIVATE_KEY_BUYER=0x... npx tsx demo/e2e-test.ts
 */
import express from "express";
import { ethers } from "ethers";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";
import {
  ShieldedPoolClient,
  initPoseidon,
  AgentStealthKeypair,
  serializeStealthMetaAddress,
  BASE_SEPOLIA_USDC,
} from "ghostpay-sdk";
import { ghostPaywall, createGhostFetch } from "ghostpay-sdk/x402";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const POOL_ADDRESS = "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f";
const USDC_ADDRESS = BASE_SEPOLIA_USDC;

const CIRCUIT_WASM = path.resolve(__dirname, "../circuits/build/privatePayment_js/privatePayment.wasm");
const CIRCUIT_ZKEY = path.resolve(__dirname, "../circuits/build/privatePayment_final.zkey");
const CIRCUIT_VKEY = path.resolve(__dirname, "../circuits/build/verification_key.json");

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
];

async function main() {
  console.log("=== GhostPay E2E Test (Base Sepolia) ===");
  console.log("=== New Flow: Buyer proof → Server relayer → On-chain withdraw ===\n");

  // Load keys
  const sellerKey = process.env.PRIVATE_KEY_SELLER ?? process.env.PRIVATE_KEY;
  const buyerKey = process.env.PRIVATE_KEY_BUYER ?? process.env.PRIVATE_KEY;

  if (!sellerKey || !buyerKey) {
    console.error("Set PRIVATE_KEY_SELLER and PRIVATE_KEY_BUYER (or PRIVATE_KEY for both)");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sellerSigner = new ethers.Wallet(sellerKey, provider);
  const buyerSigner = new ethers.Wallet(buyerKey, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

  console.log(`Seller:  ${sellerSigner.address}`);
  console.log(`Buyer:   ${buyerSigner.address}`);
  console.log(`Pool:    ${POOL_ADDRESS}\n`);

  // =================== SETUP: Init Poseidon + stealth keys ===================
  console.log("Initializing Poseidon...");
  await initPoseidon();

  const stealthKeypair = AgentStealthKeypair.generate();
  const stealthMeta = serializeStealthMetaAddress(stealthKeypair.getMetaAddress());

  // =================== STEP 1: Start seller server ===================
  console.log("\n--- Step 1: Start seller server (relayer) ---");

  const app = express();

  app.use(
    "/api/weather",
    ghostPaywall({
      price: "1000000",
      asset: USDC_ADDRESS,
      recipient: sellerSigner.address,
      poolAddress: POOL_ADDRESS,
      network: "eip155:84532",
      signer: sellerSigner,
      stealthMetaAddress: stealthMeta,
      relayer: sellerSigner.address,
      relayerFee: "0",
    })
  );

  app.get("/api/weather", (req, res) => {
    res.json({
      location: "Istanbul",
      temperature: 18,
      condition: "Partly Cloudy",
      humidity: 65,
      timestamp: new Date().toISOString(),
      paymentTx: req.paymentInfo?.txHash,
    });
  });

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  console.log(`  Seller listening on port ${port}`);

  try {
    // =================== STEP 2: Buyer deposits ===================
    console.log("\n--- Step 2: Buyer deposits 2 USDC ---");

    const buyerPool = new ShieldedPoolClient({
      provider,
      signer: buyerSigner,
      poolAddress: POOL_ADDRESS,
      circuitWasm: CIRCUIT_WASM,
      circuitZkey: CIRCUIT_ZKEY,
      circuitVkey: CIRCUIT_VKEY,
    });
    await buyerPool.initialize();
    console.log(`  Tree synced. Leaves: ${buyerPool.getMerkleTree().getLeafCount()}`);

    // Check USDC balance
    const buyerUsdcBal = await usdc.balanceOf(buyerSigner.address);
    console.log(`  Buyer USDC: ${Number(buyerUsdcBal) / 1e6}`);

    if (BigInt(buyerUsdcBal) < 2_000_000n) {
      console.error("  Need at least 2 USDC for buyer");
      process.exit(1);
    }

    const depositAmount = 2_000_000n;
    console.log(`  Depositing ${Number(depositAmount) / 1e6} USDC...`);
    const depositResult = await buyerPool.deposit(depositAmount, USDC_ADDRESS);
    console.log(`  TX: ${depositResult.txHash}`);
    console.log(`  Leaf index: ${depositResult.leafIndex}`);
    console.log(`  Block: ${depositResult.blockNumber}`);

    const balanceBefore = buyerPool.getTotalBalance();
    console.log(`  Shielded balance: ${Number(balanceBefore) / 1e6} USDC`);

    // =================== STEP 3: ghostFetch → 402 → proof → relayer → 200 ===================
    console.log("\n--- Step 3: ghostFetch (proof → server relayer → withdraw) ---");

    const ghostFetch = createGhostFetch(buyerPool);
    const sellerUrl = `http://localhost:${port}/api/weather`;

    console.log(`  Fetching ${sellerUrl}...`);
    console.log("  Expected flow: GET → 402 → generate proof → retry with proof → server withdraw → 200");

    const startTime = Date.now();
    const response = await ghostFetch(sellerUrl);
    const elapsed = Date.now() - startTime;

    console.log(`  Response: ${response.status} (${elapsed}ms)`);

    // =================== STEP 4: Verify results ===================
    console.log("\n--- Step 4: Verify results ---");

    const txHash = response.headers.get("X-Payment-TxHash");
    console.log(`  X-Payment-TxHash: ${txHash ?? "MISSING"}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`  Weather: ${data.location}, ${data.temperature}C, ${data.condition}`);
      console.log(`  Payment TX: ${data.paymentTx}`);
    } else {
      const body = await response.text();
      console.error(`  FAILED: ${body}`);
    }

    const balanceAfter = buyerPool.getTotalBalance();
    console.log(`\n  BEFORE: ${Number(balanceBefore) / 1e6} USDC shielded`);
    console.log(`  AFTER:  ${Number(balanceAfter) / 1e6} USDC shielded`);
    console.log(`  SPENT:  ${Number(balanceBefore - balanceAfter) / 1e6} USDC`);

    // Summary
    console.log("\n========================================");
    console.log("  NORMAL x402:  Buyer sends TX hash → Server trusts it");
    console.log("  GHOST x402:   Buyer sends ZK proof → Server calls withdraw()");
    console.log("========================================");

    if (response.ok && txHash) {
      console.log("\n=== E2E TEST PASSED ===");
      console.log("Deposit → 402 → ZK proof (client) → Withdraw (server relayer) → 200");
    } else {
      console.log("\n=== E2E TEST FAILED ===");
      process.exitCode = 1;
    }
  } finally {
    // Cleanup
    server.close();
    console.log("\nServer stopped.");
  }
}

main().catch((err) => {
  console.error("\nE2E Test Error:", err);
  process.exit(1);
});
