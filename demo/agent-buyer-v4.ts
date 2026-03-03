/**
 * Agent Buyer V4 — deposits USDC into ShieldedPoolV4, then uses privAgentFetchV4
 * to privately purchase weather data from the seller agent.
 *
 * V4: Amounts are HIDDEN in all transactions. Uses JoinSplit UTXO model.
 * Buyer generates JoinSplit proof (publicAmount=0), sends in Payment header.
 * Server (seller) calls transact() on-chain as relayer.
 *
 * Usage: PRIVATE_KEY=0x... npx tsx demo/agent-buyer-v4.ts
 */
import { ethers } from "ethers";
import * as path from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  initPoseidon,
  ShieldedWallet,
  BASE_SEPOLIA_USDC,
} from "privagent-sdk";
import { createPrivAgentFetchV4 } from "privagent-sdk/x402";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("=== PrivAgent V4 Buyer Agent ===\n");

  // Setup
  const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY env var");
    process.exit(1);
  }

  const poolAddress =
    process.env.SHIELDED_POOL_V4_ADDRESS ?? "0x17B6209385c2e36E6095b89572273175902547f9";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet: ${signer.address}`);
  console.log(`Pool V4: ${poolAddress}\n`);

  // Circuit directory
  const circuitDir = path.resolve(__dirname, "../circuits/build");

  // Initialize ShieldedWallet (V4 UTXO model)
  await initPoseidon();

  const wallet = new ShieldedWallet(
    {
      provider,
      signer,
      poolAddress,
      usdcAddress: BASE_SEPOLIA_USDC,
      circuitDir,
      deployBlock: 38256581,
    },
    99n // Poseidon private key for demo
  );
  await wallet.initialize();

  console.log(`Poseidon pubkey: ${wallet.publicKey.toString().slice(0, 20)}...`);

  // Sync tree from on-chain events
  console.log("Syncing Merkle tree from on-chain events...");
  await wallet.syncTree();
  console.log(`  Tree synced. Leaves: ${wallet.getTree().getLeafCount()}`);
  console.log(`  Shielded balance: ${Number(wallet.getBalance()) / 1e6} USDC\n`);

  // Deposit 2 USDC (if no balance)
  if (wallet.getBalance() < 2_000_000n) {
    const depositAmount = 2_000_000n; // 2 USDC
    console.log(`Depositing ${Number(depositAmount) / 1e6} USDC...`);

    const depositResult = await wallet.deposit(depositAmount);
    console.log(`  TX: ${depositResult.txHash}`);
    console.log(`  Block: ${depositResult.blockNumber}`);
    console.log(`  Shielded balance: ${Number(wallet.getBalance()) / 1e6} USDC\n`);
  }

  // Generate secp256k1 ECDH keypair (for note encryption)
  const ecdhPrivateKey = randomBytes(32);
  const ecdhPublicKey = secp256k1.getPublicKey(ecdhPrivateKey, true);

  // Create V4 x402-aware fetch (JoinSplit proof generation happens automatically on 402)
  const privAgentFetch = createPrivAgentFetchV4(wallet, ecdhPrivateKey, ecdhPublicKey);

  // Buy weather data privately
  const sellerUrl = process.env.SELLER_URL ?? "http://localhost:3002/api/weather";
  console.log(`Fetching weather data from ${sellerUrl}...`);
  console.log("  Step 1: GET → expect 402 with V4 requirements");
  console.log("  Step 2: Coin selection + JoinSplit proof (publicAmount=0, amounts HIDDEN)");
  console.log("  Step 3: Encrypt output notes for server");
  console.log("  Step 4: Retry with proof in Payment header");
  console.log("  Step 5: Server decrypts note, verifies amount, calls transact()\n");

  const startTime = Date.now();
  const response = await privAgentFetch(sellerUrl);
  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    console.error(`Request failed: ${response.status} ${response.statusText}`);
    const body = await response.text();
    console.error(body);
    process.exit(1);
  }

  const txHash = response.headers.get("X-Payment-TxHash");
  const data = await response.json();

  console.log(`Weather data received (${elapsed}ms):`);
  console.log(`  Location:    ${data.location}`);
  console.log(`  Temperature: ${data.temperature}C`);
  console.log(`  Condition:   ${data.condition}`);
  console.log(`  Payment TX:  ${txHash ?? data.paymentTx ?? "unknown"}`);
  console.log(`  Version:     ${data.version ?? "unknown"}`);
  console.log(`\nRemaining shielded balance: ${Number(wallet.getBalance()) / 1e6} USDC`);
  console.log("\nV4: All amounts HIDDEN on-chain — only nullifiers + commitments visible!");
}

main().catch(console.error);
