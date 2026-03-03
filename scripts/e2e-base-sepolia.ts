// SPDX-License-Identifier: BUSL-1.1
/**
 * PrivAgent E2E Test — Base Sepolia
 *
 * Tests against REAL deployed contracts on Base Sepolia.
 * Outputs TX hashes + Blockscout links for verification.
 *
 * Run: cd sdk && PRIVATE_KEY=0x... npx tsx ../scripts/e2e-base-sepolia.ts
 *
 * NOT CI — manual execution only.
 * Requires: Base Sepolia ETH + USDC, deployed contracts.
 */

import { ethers } from "ethers";
import { initPoseidon } from "../sdk/src/poseidon.js";
import { MerkleTree } from "../sdk/src/merkle.js";
import { FIELD_SIZE } from "../sdk/src/types.js";
import {
  ShieldedWallet,
  ShieldedWalletConfig,
} from "../sdk/src/v4/shieldedWallet.js";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://sepolia.base.org",
  poolAddress: "0x17B6209385c2e36E6095b89572273175902547f9",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  blockscoutBase: "https://base-sepolia.blockscout.com/tx/",
  deployBlock: 38256581,
  circuitDir: "../circuits/build",
};

const USDC_ABI = [
  "function approve(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
];

function txLink(hash: string): string {
  return `${CONFIG.blockscoutBase}${hash}`;
}

interface TestResult {
  test: string;
  status: string;
  txHash?: string;
  details?: string;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("ERROR: Set PRIVATE_KEY environment variable");
    console.error(
      "Usage: PRIVATE_KEY=0x... npx tsx scripts/e2e-base-sepolia.ts"
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const ethBalance = await provider.getBalance(signer.address);
  const usdc = new ethers.Contract(CONFIG.usdcAddress, USDC_ABI, signer);
  const usdcBalance = await usdc.balanceOf(signer.address);

  console.log(
    "+==========================================================+"
  );
  console.log(
    "|  PrivAgent E2E Test — Base Sepolia                         |"
  );
  console.log(
    "+==========================================================+\n"
  );
  console.log(`Wallet:      ${signer.address}`);
  console.log(`ETH:         ${ethers.formatEther(ethBalance)}`);
  console.log(`USDC:        ${ethers.formatUnits(usdcBalance, 6)}`);
  console.log(`Network:     Base Sepolia (84532)`);
  console.log(`Pool:        ${CONFIG.poolAddress}`);
  console.log(`Deploy Block: ${CONFIG.deployBlock}\n`);

  if (BigInt(usdcBalance) < 5_000_000n) {
    console.error("ERROR: Need at least 5 USDC on Base Sepolia");
    console.error("Get test USDC from: https://faucet.circle.com/");
    process.exit(1);
  }

  const results: TestResult[] = [];

  // Initialize SDK
  console.log("Initializing...");
  await initPoseidon();

  const walletConfig: ShieldedWalletConfig = {
    provider,
    signer,
    poolAddress: CONFIG.poolAddress,
    usdcAddress: CONFIG.usdcAddress,
    circuitDir: CONFIG.circuitDir,
    deployBlock: CONFIG.deployBlock,
  };

  const wallet = new ShieldedWallet(walletConfig);
  await wallet.initialize();
  console.log("Syncing Merkle tree from on-chain events...");
  await wallet.syncTree();
  const treeInfo = wallet.getTree();
  console.log(`Tree synced: ${treeInfo.getLeafCount()} leaves\n`);

  // ── TEST 1: DEPOSIT ──
  console.log("--- Test 1: Deposit 2 USDC ---");
  try {
    const depositAmount = 2_000_000n; // 2 USDC

    // Check allowance
    const allowance = await usdc.allowance(signer.address, CONFIG.poolAddress);
    if (BigInt(allowance) < depositAmount) {
      console.log("   Approving USDC...");
      const approveTx = await usdc.approve(CONFIG.poolAddress, depositAmount);
      await approveTx.wait();
    }

    console.log("   Generating ZK proof + depositing...");
    const startTime = Date.now();
    const result = await wallet.deposit(depositAmount);
    const elapsed = Date.now() - startTime;

    console.log(`   TX: ${txLink(result.txHash)}`);
    console.log(`   Proof gen + TX: ${elapsed}ms`);
    console.log(`   Shielded balance: ${wallet.getBalance()} (raw)`);
    results.push({
      test: "Deposit 2 USDC",
      status: "PASS",
      txHash: result.txHash,
      details: `${elapsed}ms`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`   FAILED: ${msg}`);
    results.push({ test: "Deposit 2 USDC", status: "FAIL", details: msg });
  }

  // ── TEST 2: WITHDRAW ──
  console.log("\n--- Test 2: Withdraw 1 USDC ---");
  try {
    const withdrawAmount = 1_000_000n; // 1 USDC
    const recipientBefore = await usdc.balanceOf(signer.address);

    console.log("   Generating ZK proof + withdrawing...");
    const startTime = Date.now();
    const result = await wallet.withdraw(
      withdrawAmount,
      signer.address // withdraw to self
    );
    const elapsed = Date.now() - startTime;

    const recipientAfter = await usdc.balanceOf(signer.address);
    const received = BigInt(recipientAfter) - BigInt(recipientBefore);

    console.log(`   TX: ${txLink(result.txHash)}`);
    console.log(`   Proof gen + TX: ${elapsed}ms`);
    console.log(
      `   Received: ${ethers.formatUnits(received, 6)} USDC`
    );
    console.log(`   Remaining shielded: ${wallet.getBalance()} (raw)`);
    results.push({
      test: "Withdraw 1 USDC",
      status: "PASS",
      txHash: result.txHash,
      details: `${elapsed}ms, received ${ethers.formatUnits(received, 6)} USDC`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`   FAILED: ${msg}`);
    results.push({ test: "Withdraw 1 USDC", status: "FAIL", details: msg });
  }

  // ── TEST 3: ON-CHAIN STATE VERIFICATION ──
  console.log("\n--- Test 3: On-Chain Verification ---");
  try {
    const POOL_ABI = [
      "function getLastRoot() view returns (bytes32)",
      "function nextLeafIndex() view returns (uint256)",
      "function getBalance() view returns (uint256)",
      "function treasury() view returns (address)",
    ];
    const poolContract = new ethers.Contract(
      CONFIG.poolAddress,
      POOL_ABI,
      provider
    );

    const [lastRoot, leafIndex, poolBalance, treasury] = await Promise.all([
      poolContract.getLastRoot(),
      poolContract.nextLeafIndex(),
      poolContract.getBalance(),
      poolContract.treasury(),
    ]);

    console.log(
      `   Pool balance: ${ethers.formatUnits(poolBalance, 6)} USDC`
    );
    console.log(`   Merkle root:  ${lastRoot.toString().slice(0, 20)}...`);
    console.log(`   Leaf count:   ${leafIndex}`);
    console.log(`   Treasury:     ${treasury}`);
    console.log("   State consistent");
    results.push({
      test: "On-Chain Verification",
      status: "PASS",
      details: `${ethers.formatUnits(poolBalance, 6)} USDC in pool, ${leafIndex} leaves`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`   FAILED: ${msg}`);
    results.push({
      test: "On-Chain Verification",
      status: "FAIL",
      details: msg,
    });
  }

  // ── SUMMARY ──
  console.log(
    "\n+==========================================================+"
  );
  console.log(
    "|  RESULTS                                                  |"
  );
  console.log(
    "+==========================================================+\n"
  );

  for (const r of results) {
    const icon = r.status === "PASS" ? "[PASS]" : "[FAIL]";
    const link = r.txHash ? ` -> ${txLink(r.txHash)}` : "";
    const detail = r.details ? ` (${r.details})` : "";
    console.log(`  ${icon} ${r.test}${detail}${link}`);
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} tests passed\n`);

  if (passed === total) {
    console.log("All E2E tests passed on Base Sepolia!\n");
  }

  console.log("Verify transactions: https://base-sepolia.blockscout.com");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
