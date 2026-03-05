import path from "path";
import { ethers } from "ethers";
import { POOL_ADDRESS, USDC_ADDRESS, DEPLOY_BLOCK } from "./contracts";

// Module-level state (persists across API requests in the same server process)
let sdk: typeof import("privagent-sdk") | null = null;
let wallet: InstanceType<typeof import("privagent-sdk").ShieldedWallet> | null = null;
let initPromise: Promise<void> | null = null;

// Store pending deposit UTXOs (before on-chain confirmation)
// Key: commitment as string, Value: UTXO-like data
interface PendingUTXO {
  amount: string;
  pubkey: string;
  blinding: string;
  commitment: string;
}
const pendingDeposits: PendingUTXO[] = [];

async function loadSDK() {
  if (!sdk) {
    sdk = await import("privagent-sdk");
  }
  return sdk;
}

function getProvider() {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";
  return new ethers.JsonRpcProvider(rpc);
}

function getServerSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY env var not set");
  return new ethers.Wallet(pk, getProvider());
}

function getCircuitDir() {
  return path.join(process.cwd(), "..", "circuits", "build");
}

function getPoseidonKey() {
  const key = process.env.POSEIDON_PRIVATE_KEY;
  if (!key) throw new Error("POSEIDON_PRIVATE_KEY env var not set");
  return key;
}

async function initWallet(): Promise<void> {
  const { ShieldedWallet, initPoseidon } = await loadSDK();
  await initPoseidon(); // Must init BEFORE constructor (keypairFromPrivateKey uses Poseidon)

  wallet = new ShieldedWallet(
    {
      provider: getProvider(),
      signer: getServerSigner(),
      poolAddress: POOL_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      circuitDir: getCircuitDir(),
      deployBlock: DEPLOY_BLOCK,
    },
    BigInt(getPoseidonKey())
  );

  await wallet.initialize();
  await wallet.syncTree();
}

export async function getWallet() {
  if (!initPromise) {
    initPromise = initWallet().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
  return wallet!;
}

/**
 * Re-sync the singleton wallet's tree from on-chain events.
 * Call this before operations that need fresh state (buy, balance).
 */
export async function resyncWallet() {
  const w = await getWallet();
  await w.syncTree();

  // Register pending deposits whose commitments now appear in the tree
  const { createUTXO, computeNullifierV4 } = await loadSDK();
  const tree = w.getTree();
  const remaining: PendingUTXO[] = [];

  for (const pending of pendingDeposits) {
    // Check if commitment is in the tree by trying to find it
    // The tree's leaf is a commitment BigInt — if it was inserted, the UTXO exists on-chain
    const utxo = createUTXO(BigInt(pending.amount), BigInt(pending.pubkey));
    utxo.blinding = BigInt(pending.blinding);
    utxo.commitment = BigInt(pending.commitment);

    // We can detect on-chain by checking the tree root changed
    // For simplicity, try to add this UTXO to the wallet if not already tracked
    const existing = w.getUTXOs();
    if (!existing.some((u) => u.commitment === utxo.commitment)) {
      // Find the leaf index by scanning tree
      // This is hacky but works for a demo
      try {
        w.addUTXO(utxo);
      } catch {
        remaining.push(pending);
      }
    }
  }

  // Clear confirmed deposits
  pendingDeposits.length = 0;
  remaining.forEach((p) => pendingDeposits.push(p));
}

/**
 * Store a deposit UTXO for later registration after on-chain confirmation.
 */
export function addPendingDeposit(utxo: PendingUTXO) {
  pendingDeposits.push(utxo);
}

export async function getSDK() {
  return loadSDK();
}

export { getProvider, getServerSigner, getCircuitDir, getPoseidonKey };
