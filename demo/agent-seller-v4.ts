/**
 * Agent Seller V4 — serves weather data behind a PrivAgent V4 ZK paywall
 *
 * V4: Amounts are HIDDEN. Uses JoinSplit UTXO model.
 * Server acts as relayer: receives JoinSplit proof, decrypts note to verify
 * amount off-chain, then calls ShieldedPoolV4.transact() on-chain.
 *
 * Usage: PRIVATE_KEY=0x... npx tsx demo/agent-seller-v4.ts
 */
import express from "express";
import { ethers } from "ethers";
import * as path from "path";
import * as fs from "fs";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { initPoseidon, derivePublicKey } from "privagent-sdk";
import { privAgentPaywallV4 } from "privagent-sdk/x402";
import type { PrivAgentwallConfigV4 } from "privagent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUIT_DIR = path.resolve(__dirname, "../circuits/build");

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY env var (seller needs ETH for gas)");
    process.exit(1);
  }

  const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const POOL_ADDRESS =
    process.env.SHIELDED_POOL_V4_ADDRESS ?? "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
  const USDC_ADDRESS =
    process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("=== PrivAgent V4 Seller Agent ===\n");
  console.log(`Wallet:  ${signer.address}`);
  console.log(`Pool V4: ${POOL_ADDRESS}`);

  // Init Poseidon (needed for Poseidon keypair)
  await initPoseidon();

  // Generate Poseidon keypair (for receiving shielded UTXOs)
  const poseidonPrivateKey = 42n; // deterministic for demo
  const poseidonPubkey = derivePublicKey(poseidonPrivateKey);
  console.log(`Poseidon pubkey: ${poseidonPubkey.toString().slice(0, 20)}...`);

  // Generate secp256k1 ECDH keypair (for note encryption/decryption)
  const ecdhPrivateKey = randomBytes(32);
  const ecdhPublicKey = secp256k1.getPublicKey(ecdhPrivateKey, true);
  console.log(`ECDH pubkey: 0x${Buffer.from(ecdhPublicKey).toString("hex").slice(0, 16)}...`);

  const app = express();

  // Load verification keys for off-chain proof verification (prevents gas griefing)
  const vkey1x2 = JSON.parse(fs.readFileSync(path.resolve(CIRCUIT_DIR, "v4/1x2/verification_key.json"), "utf-8"));
  const vkey2x2 = JSON.parse(fs.readFileSync(path.resolve(CIRCUIT_DIR, "v4/2x2/verification_key.json"), "utf-8"));

  // V4 Paywall: 1 USDC for weather data — amounts HIDDEN
  const config: PrivAgentwallConfigV4 = {
    price: "1000000", // 1 USDC (6 decimals)
    asset: USDC_ADDRESS,
    poolAddress: POOL_ADDRESS,
    network: "eip155:84532",
    signer,
    poseidonPubkey: poseidonPubkey.toString(),
    ecdhPrivateKey,
    ecdhPublicKey,
    relayer: signer.address,
    relayerFee: "0",
    verificationKeys: { "1x2": vkey1x2, "2x2": vkey2x2 },
  };

  app.use("/api/weather", privAgentPaywallV4(config));

  app.get("/api/weather", (req, res) => {
    const paymentInfo = req.paymentInfo;
    console.log(
      `  Payment received! TX: ${paymentInfo?.txHash ?? "unknown"}`
    );
    console.log(`  Amount: HIDDEN (verified via encrypted note)`);

    res.json({
      location: "Istanbul",
      temperature: 18,
      condition: "Partly Cloudy",
      humidity: 65,
      timestamp: new Date().toISOString(),
      paymentTx: paymentInfo?.txHash,
      version: "v4-joinsplit",
    });
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "PrivAgent V4 Weather Agent (JoinSplit)",
      version: "v4",
      endpoints: {
        "/api/weather": "GET — 1 USDC (x402 zk-exact-v2, amounts HIDDEN)",
      },
    });
  });

  const port = Number(process.env.SELLER_PORT ?? "3002");
  app.listen(port, () => {
    console.log(`\nV4 Seller agent listening on port ${port}`);
    console.log(`  Weather endpoint: http://localhost:${port}/api/weather (1 USDC)`);
    console.log(`  V4 JoinSplit: amounts HIDDEN, server decrypts note to verify\n`);
  });
}

main().catch(console.error);
