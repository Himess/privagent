/**
 * PrivAgent Express Server — Privacy Paywall Example
 *
 * Adds a privacy-preserving paywall to API endpoints.
 * Payments are verified via ZK proofs — amounts stay hidden.
 */

import express from "express";
import { privAgentPaywallV4 } from "privagent-sdk/x402";
import { initPoseidon, keypairFromPrivateKey, derivePublicKey } from "privagent-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import { randomBytes } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

const POOL_ADDRESS = "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PORT = 3001;

async function main() {
  await initPoseidon();

  const provider = new JsonRpcProvider(
    process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"
  );
  const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

  // Generate ECDH keys for note decryption
  const ecdhPrivateKey = randomBytes(32);
  const ecdhPublicKey = secp256k1.getPublicKey(ecdhPrivateKey, true);

  // Generate Poseidon keypair for UTXO management
  const poseidonPrivateKey = 42n; // Use a real random key in production
  const poseidonPubkey = derivePublicKey(poseidonPrivateKey);

  const app = express();

  // Free endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Premium endpoint — 1 USDC per request, privacy-preserving
  app.get(
    "/api/weather",
    privAgentPaywallV4({
      price: "1000000", // 1 USDC
      asset: USDC_ADDRESS,
      network: "eip155:84532",
      signer,
      poolAddress: POOL_ADDRESS,
      poseidonPubkey: poseidonPubkey.toString(),
      ecdhPrivateKey,
      ecdhPublicKey,
    }),
    (_req, res) => {
      res.json({
        city: "Istanbul",
        temperature: 22,
        condition: "Sunny",
        humidity: 45,
        wind: "12 km/h NW",
        source: "PrivAgent Demo API",
      });
    }
  );

  // Premium endpoint — 5 USDC per request
  app.get(
    "/api/market-data",
    privAgentPaywallV4({
      price: "5000000", // 5 USDC
      asset: USDC_ADDRESS,
      network: "eip155:84532",
      signer,
      poolAddress: POOL_ADDRESS,
      poseidonPubkey: poseidonPubkey.toString(),
      ecdhPrivateKey,
      ecdhPublicKey,
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
    console.log(`PrivAgent API server running on http://localhost:${PORT}`);
    console.log(`  Free:    GET /api/health`);
    console.log(`  1 USDC:  GET /api/weather`);
    console.log(`  5 USDC:  GET /api/market-data`);
  });
}

main().catch(console.error);
