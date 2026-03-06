// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { JsonRpcProvider, Wallet } from "ethers";
import {
  ShieldedWallet,
  initPoseidon,
  BASE_SEPOLIA_USDC,
} from "privagent-sdk";
import type { ShieldedWalletConfig } from "privagent-sdk";
import { parseArgs } from "node:util";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POOL = "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
const DEFAULT_DEPLOY_BLOCK = 38347380;

// ============================================================================
// Wallet singleton
// ============================================================================

let wallet: ShieldedWallet | null = null;
let initPromise: Promise<void> | null = null;

async function initWallet(): Promise<void> {
  const privateKey = process.env.PRIVATE_KEY;
  const poseidonKey = process.env.POSEIDON_PRIVATE_KEY;

  if (!privateKey) throw new Error("PRIVATE_KEY env var is required");
  if (!poseidonKey) throw new Error("POSEIDON_PRIVATE_KEY env var is required");

  await initPoseidon();

  const rpc = process.env.RPC_URL || "https://sepolia.base.org";
  const provider = new JsonRpcProvider(rpc);
  const signer = new Wallet(privateKey, provider);

  wallet = new ShieldedWallet(
    {
      provider,
      signer,
      poolAddress: process.env.POOL_ADDRESS || DEFAULT_POOL,
      usdcAddress: BASE_SEPOLIA_USDC,
      circuitDir: process.env.CIRCUIT_DIR || "../../../circuits/build",
      deployBlock: process.env.DEPLOY_BLOCK
        ? parseInt(process.env.DEPLOY_BLOCK, 10)
        : DEFAULT_DEPLOY_BLOCK,
    },
    BigInt(poseidonKey)
  );

  await wallet.initialize();
  await wallet.syncTree();
}

export async function getWallet(): Promise<ShieldedWallet> {
  if (!initPromise) {
    initPromise = initWallet();
  }
  await initPromise;
  return wallet!;
}

export function getProvider(): JsonRpcProvider {
  const rpc = process.env.RPC_URL || "https://sepolia.base.org";
  return new JsonRpcProvider(rpc);
}

export function getSigner(): Wallet {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY env var is required");
  return new Wallet(privateKey, getProvider());
}

// ============================================================================
// Helpers
// ============================================================================

export function parseAmount(str: string): bigint {
  // String-based decimal parsing to avoid floating-point precision issues
  const trimmed = str.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid amount. Must be a positive number.");
  }
  const parts = trimmed.split(".");
  const intPart = parts[0];
  const decPart = (parts[1] || "").padEnd(6, "0").slice(0, 6);
  const raw = BigInt(intPart) * 1_000_000n + BigInt(decPart);
  if (raw <= 0n) {
    throw new Error("Invalid amount. Must be a positive number.");
  }
  return raw;
}

export function formatUSDC(raw: bigint): string {
  return (Number(raw) / 1_000_000).toFixed(2);
}

export function ok(data: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...data });
}

export function fail(msg: string): string {
  return JSON.stringify({ ok: false, error: msg });
}

export function parseCliArgs(argv: string[]): Record<string, string> {
  // Collect all option names from argv (--key value pairs)
  const options: Record<string, { type: "string" }> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      options[argv[i].slice(2)] = { type: "string" };
    }
  }

  const { values } = parseArgs({
    args: argv,
    options,
    strict: false,
  });

  return values as Record<string, string>;
}
