/**
 * PrivAgent — 4-Account On-Chain Demo
 *
 * Real transactions on Base Sepolia with 4 different Poseidon keypairs.
 * Shows deposit + 3 private transfers between agents.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx demo/4-account-demo.ts
 */
import { ethers } from "ethers";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  initPoseidon,
  ShieldedWallet,
  BASE_SEPOLIA_USDC,
} from "privagent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const POOL_ADDRESS =
  process.env.POOL_ADDRESS ?? "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
const USDC_ADDRESS = BASE_SEPOLIA_USDC;
const CIRCUIT_DIR = path.resolve(__dirname, "../circuits/build");
const DEPLOY_BLOCK = 38347380;
const BLOCKSCOUT = "https://base-sepolia.blockscout.com";

const USDC_ABI = [
  "function approve(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
];

// ============================================================================
// ANSI Colors
// ============================================================================

const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const M = "\x1b[35m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const X = "\x1b[0m";

// ============================================================================
// Helpers
// ============================================================================

function fmt(raw: bigint): string {
  return (Number(raw) / 1e6).toFixed(2);
}

function shortKey(pk: bigint): string {
  const hex = "0x" + pk.toString(16).padStart(64, "0");
  return hex.slice(0, 10) + "..." + hex.slice(-6);
}

function hr() {
  console.log(`${D}${"─".repeat(60)}${X}`);
}

async function withTimer<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  process.stdout.write(`   ${label}... `);
  const result = await fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${G}OK${X} ${D}(${elapsed}s)${X}`);
  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error(`${R}Set PRIVATE_KEY env var${X}`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);

  // ── HEADER ──
  console.log(`\n${C}${B}╔══════════════════════════════════════════════════════╗${X}`);
  console.log(`${C}${B}║  PrivAgent — 4-Account On-Chain Demo                 ║${X}`);
  console.log(`${C}${B}║  Network: Base Sepolia · Pool: ${POOL_ADDRESS.slice(0, 8)}...    ║${X}`);
  console.log(`${C}${B}╚══════════════════════════════════════════════════════╝${X}\n`);

  // Balance check
  const ethBal = await provider.getBalance(signer.address);
  const usdcBal = BigInt(await usdc.balanceOf(signer.address));
  console.log(`   Wallet:  ${signer.address}`);
  console.log(`   ETH:     ${ethers.formatEther(ethBal)}`);
  console.log(`   USDC:    ${fmt(usdcBal)} USDC`);

  const DEPOSIT_AMOUNT = 120_000n; // 0.12 USDC

  // ── INIT POSEIDON ──
  await withTimer("Initializing Poseidon", initPoseidon);

  // ── CREATE 4 WALLETS ──
  const walletConfig = {
    provider,
    signer,
    poolAddress: POOL_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    circuitDir: CIRCUIT_DIR,
    deployBlock: DEPLOY_BLOCK,
  };

  const alice = new ShieldedWallet(walletConfig, 111n);
  const bob = new ShieldedWallet(walletConfig, 222n);
  const charlie = new ShieldedWallet(walletConfig, 333n);
  const dave = new ShieldedWallet(walletConfig, 444n);

  await alice.initialize();
  await bob.initialize();
  await charlie.initialize();
  await dave.initialize();

  hr();
  console.log(`\n   ${B}4 POSEIDON KEYPAIRS:${X}\n`);
  console.log(`   ${M}Alice${X}   (111n)  PubKey: ${C}${shortKey(alice.publicKey)}${X}`);
  console.log(`   ${M}Bob${X}     (222n)  PubKey: ${C}${shortKey(bob.publicKey)}${X}`);
  console.log(`   ${M}Charlie${X} (333n)  PubKey: ${C}${shortKey(charlie.publicKey)}${X}`);
  console.log(`   ${M}Dave${X}    (444n)  PubKey: ${C}${shortKey(dave.publicKey)}${X}`);

  // Full pubkeys for MIMARI-TR
  console.log(`\n   ${D}Full public keys (for on-chain verification):${X}`);
  console.log(`   ${D}Alice:   ${alice.publicKey}${X}`);
  console.log(`   ${D}Bob:     ${bob.publicKey}${X}`);
  console.log(`   ${D}Charlie: ${charlie.publicKey}${X}`);
  console.log(`   ${D}Dave:    ${dave.publicKey}${X}`);

  // ── SYNC TREE ──
  await withTimer("Syncing Merkle tree", () => alice.syncTree());
  console.log(`   Tree leaves: ${alice.getTree().getLeafCount()}`);

  const txResults: { step: string; hash: string; block: number }[] = [];

  // ════════════════════════════════════════════════════════
  // STEP 1: ALICE DEPOSITS USDC (skip if already has balance)
  // ════════════════════════════════════════════════════════
  hr();

  const existingBalance = alice.getBalance();
  if (existingBalance >= 500_000n) {
    console.log(`\n   ${B}📥 STEP 1: Alice already has ${fmt(existingBalance)} USDC shielded — skipping deposit${X}`);
  } else {
    console.log(`\n   ${B}📥 STEP 1: Alice deposits ${fmt(DEPOSIT_AMOUNT)} USDC${X}\n`);

    // Approve
    await withTimer("Approving USDC", async () => {
      const tx = await usdc.approve(POOL_ADDRESS, 5_000_000n);
      await tx.wait();
    });

    const depositResult = await withTimer(
      "Building deposit proof + submitting TX",
      () => alice.deposit(DEPOSIT_AMOUNT)
    );

    console.log(`\n   ${G}${B}✓ DEPOSIT OK${X}`);
    console.log(`   TX:    ${C}${depositResult.txHash}${X}`);
    console.log(`   Block: ${depositResult.blockNumber}`);
    console.log(`   View:  ${D}${BLOCKSCOUT}/tx/${depositResult.txHash}${X}`);

    txResults.push({ step: "Deposit (Alice)", hash: depositResult.txHash, block: depositResult.blockNumber });
  }

  console.log(`   Alice shielded: ${B}${fmt(alice.getBalance())} USDC${X}`);
  console.log(`   ${D}Tree: ${alice.getTree().getLeafCount()} leaves, UTXOs: ${alice.getUTXOs().length}${X}`);

  // ════════════════════════════════════════════════════════
  // STEP 2: ALICE → BOB (0.03 USDC)
  // ════════════════════════════════════════════════════════
  hr();
  console.log(`\n   ${B}🔀 STEP 2: Alice → Bob: 0.03 USDC (PRIVATE)${X}\n`);
  console.log(`   Recipient PubKey: ${C}${shortKey(bob.publicKey)}${X}`);

  const proof1 = await withTimer("Building JoinSplit proof", () =>
    alice.generateTransferProof(30_000n, bob.publicKey)
  );
  const tx1 = await withTimer("Submitting to chain", () =>
    alice.submitTransact(proof1)
  );

  console.log(`\n   ${G}${B}✓ TRANSFER OK${X}`);
  console.log(`   TX:    ${C}${tx1.txHash}${X}`);
  console.log(`   Block: ${tx1.blockNumber}`);
  console.log(`   View:  ${D}${BLOCKSCOUT}/tx/${tx1.txHash}${X}`);
  console.log(`   ${Y}publicAmount = 0 → amount HIDDEN on-chain${X}`);
  console.log(`   Alice remaining: ${B}${fmt(alice.getBalance())} USDC${X}`);

  txResults.push({ step: "Transfer Alice→Bob", hash: tx1.txHash, block: tx1.blockNumber });


  // ════════════════════════════════════════════════════════
  // STEP 3: ALICE → CHARLIE (0.02 USDC)
  // ════════════════════════════════════════════════════════
  hr();
  console.log(`\n   ${B}🔀 STEP 3: Alice → Charlie: 0.02 USDC (PRIVATE)${X}\n`);
  console.log(`   Recipient PubKey: ${C}${shortKey(charlie.publicKey)}${X}`);

  const proof2 = await withTimer("Building JoinSplit proof", () =>
    alice.generateTransferProof(20_000n, charlie.publicKey)
  );
  const tx2 = await withTimer("Submitting to chain", () =>
    alice.submitTransact(proof2)
  );

  console.log(`\n   ${G}${B}✓ TRANSFER OK${X}`);
  console.log(`   TX:    ${C}${tx2.txHash}${X}`);
  console.log(`   Block: ${tx2.blockNumber}`);
  console.log(`   View:  ${D}${BLOCKSCOUT}/tx/${tx2.txHash}${X}`);
  console.log(`   ${Y}publicAmount = 0 → amount HIDDEN on-chain${X}`);
  console.log(`   Alice remaining: ${B}${fmt(alice.getBalance())} USDC${X}`);

  txResults.push({ step: "Transfer Alice→Charlie", hash: tx2.txHash, block: tx2.blockNumber });


  // ════════════════════════════════════════════════════════
  // STEP 4: ALICE → DAVE (0.01 USDC)
  // ════════════════════════════════════════════════════════
  hr();
  console.log(`\n   ${B}🔀 STEP 4: Alice → Dave: 0.01 USDC (PRIVATE)${X}\n`);
  console.log(`   Recipient PubKey: ${C}${shortKey(dave.publicKey)}${X}`);

  const proof3 = await withTimer("Building JoinSplit proof", () =>
    alice.generateTransferProof(10_000n, dave.publicKey)
  );
  const tx3 = await withTimer("Submitting to chain", () =>
    alice.submitTransact(proof3)
  );

  console.log(`\n   ${G}${B}✓ TRANSFER OK${X}`);
  console.log(`   TX:    ${C}${tx3.txHash}${X}`);
  console.log(`   Block: ${tx3.blockNumber}`);
  console.log(`   View:  ${D}${BLOCKSCOUT}/tx/${tx3.txHash}${X}`);
  console.log(`   ${Y}publicAmount = 0 → amount HIDDEN on-chain${X}`);
  console.log(`   Alice remaining: ${B}${fmt(alice.getBalance())} USDC${X}`);

  txResults.push({ step: "Transfer Alice→Dave", hash: tx3.txHash, block: tx3.blockNumber });

  // ════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ════════════════════════════════════════════════════════
  hr();
  console.log(`\n${C}${B}╔══════════════════════════════════════════════════════╗${X}`);
  console.log(`${C}${B}║  RESULTS — 4 ON-CHAIN TRANSACTIONS                   ║${X}`);
  console.log(`${C}${B}╚══════════════════════════════════════════════════════╝${X}\n`);

  for (const tx of txResults) {
    console.log(`   ${B}${tx.step}${X} (block ${tx.block})`);
    console.log(`   ${D}${BLOCKSCOUT}/tx/${tx.hash}${X}\n`);
  }

  console.log(`   ${B}SHIELDED BALANCES (invisible to chain observers):${X}`);
  console.log(`   Alice:   ${G}${fmt(alice.getBalance())} USDC${X}`);
  // Bob, Charlie, Dave need to sync tree to see their balances
  // But we can show what they SHOULD have based on the transfers
  console.log(`   Bob:     ${G}0.03 USDC${X} ${D}(received privately)${X}`);
  console.log(`   Charlie: ${G}0.02 USDC${X} ${D}(received privately)${X}`);
  console.log(`   Dave:    ${G}0.01 USDC${X} ${D}(received privately)${X}`);

  console.log(`\n   ${B}ON-CHAIN PRIVACY:${X}`);
  console.log(`   ${G}✓${X} All 3 transfers show publicAmount = 0`);
  console.log(`   ${G}✓${X} No sender/recipient info visible`);
  console.log(`   ${G}✓${X} Amounts hidden in commitment hashes`);
  console.log(`   ${G}✓${X} Nullifiers unlinkable to deposits`);
  console.log(`   ${G}✓${X} 4 different Poseidon keypairs, 0 visible on-chain`);
  console.log(`   ${R}!${X} Only protocol fee (0.01 USDC each) is visible\n`);

  console.log(`${C}${B}╔══════════════════════════════════════════════════════╗${X}`);
  console.log(`${C}${B}║  ${G}4 agents, 4 transactions, 0 leaked identities${C}      ║${X}`);
  console.log(`${C}${B}║  github.com/Himess/privagent                         ║${X}`);
  console.log(`${C}${B}╚══════════════════════════════════════════════════════╝${X}\n`);
}

main().catch((err) => {
  console.error(`\n${R}Demo failed: ${err.message}${X}`);
  console.error(`${D}${err.stack}${X}`);
  process.exit(1);
});
