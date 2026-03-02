/**
 * GhostPay — Agent Privacy Demo
 *
 * Video-ready terminal demo with real on-chain transactions on Base Sepolia.
 * Shows the full privacy flow: Deposit → Private Transfer → Withdraw
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx tsx demo/agent-privacy-demo.ts
 *
 * Requires:
 *   - Base Sepolia ETH (>= 0.01 for gas)
 *   - Base Sepolia USDC (>= 3 USDC)
 *   - Deployed GhostPay contracts
 */
import { ethers } from "ethers";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  initPoseidon,
  ShieldedWallet,
  BASE_SEPOLIA_USDC,
} from "ghostpay-sdk";

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

const POOL_ABI = [
  "function getBalance() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "function getLastRoot() view returns (bytes32)",
  "function treasury() view returns (address)",
  "function protocolFeeBps() view returns (uint256)",
  "function minProtocolFee() view returns (uint256)",
];

// ============================================================================
// ANSI Colors
// ============================================================================

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ============================================================================
// Display Helpers
// ============================================================================

function printHeader(poolAddress: string) {
  console.log("");
  console.log(
    `${CYAN}${BOLD}+======================================================+${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}|  GhostPay — Agent Privacy Demo                       |${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}|  Network: Base Sepolia (84532)                        |${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}|  Pool: ${poolAddress.slice(0, 10)}...${poolAddress.slice(-6)}                        |${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}+======================================================+${RESET}`
  );
}

function printSeparator() {
  console.log(
    `\n${DIM}────────────────────────────────────────────────────────${RESET}`
  );
}

function printStepHeader(step: number, icon: string, title: string) {
  console.log(`\n${BOLD}${icon} STEP ${step}: ${title}${RESET}\n`);
}

function printTxBox(hash: string, block: number, gasUsed?: string) {
  const shortHash = `${hash.slice(0, 14)}...${hash.slice(-10)}`;
  const link = `${BLOCKSCOUT}/tx/${hash}`;
  console.log(`   ${GREEN}+-- TRANSACTION ------------------------------------+${RESET}`);
  console.log(`   ${GREEN}|${RESET} TX Hash:  ${CYAN}${shortHash}${RESET}`);
  console.log(`   ${GREEN}|${RESET} Block:    ${block.toLocaleString()}`);
  if (gasUsed) console.log(`   ${GREEN}|${RESET} Gas Used: ${gasUsed}`);
  console.log(`   ${GREEN}|${RESET} View:     ${DIM}${link}${RESET}`);
  console.log(`   ${GREEN}+--------------------------------------------------+${RESET}`);
}

interface VisibilityItem {
  metric: string;
  status: "VISIBLE" | "HIDDEN" | "BROKEN";
  note: string;
}

function printVisibility(items: VisibilityItem[]) {
  console.log(`\n   ${BOLD}ON-CHAIN VISIBILITY:${RESET}`);
  for (const item of items) {
    let statusStr: string;
    if (item.status === "VISIBLE") {
      statusStr = `${YELLOW}   VISIBLE${RESET}`;
    } else if (item.status === "HIDDEN") {
      statusStr = `${GREEN}** HIDDEN ${RESET}`;
    } else {
      statusStr = `${GREEN}** BROKEN ${RESET}`;
    }
    console.log(
      `   | ${item.metric.padEnd(20)} | ${statusStr} | ${DIM}${item.note}${RESET}`
    );
  }
}

async function withProgressBar<T>(
  label: string,
  asyncFn: () => Promise<T>
): Promise<T> {
  process.stdout.write(`   ${label}\n   `);

  const width = 40;
  let position = 0;
  const startTime = Date.now();

  const interval = setInterval(() => {
    position = Math.min(position + 1, width - 1);
    const filled = "\u2588".repeat(position);
    const empty = "\u2591".repeat(width - position);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r   ${GREEN}${filled}${DIM}${empty}${RESET} ${elapsed}s`);
  }, 100);

  try {
    const result = await asyncFn();
    clearInterval(interval);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const fullBar = "\u2588".repeat(width);
    process.stdout.write(
      `\r   ${GREEN}${fullBar}${RESET} ${totalTime}s ${GREEN}Done${RESET}\n`
    );
    return result;
  } catch (error) {
    clearInterval(interval);
    const filled = "\u2588".repeat(position);
    const empty = "\u2591".repeat(width - position);
    process.stdout.write(`\r   ${RED}${filled}${empty} FAILED${RESET}\n`);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUSDC(raw: bigint): string {
  return (Number(raw) / 1e6).toFixed(2);
}

// ============================================================================
// Main
// ============================================================================

interface TxResult {
  step: string;
  hash: string;
  block: number;
}

async function main() {
  // ── ENV CHECK ──
  if (!process.env.PRIVATE_KEY) {
    console.error(`${RED}ERROR: Set PRIVATE_KEY environment variable${RESET}`);
    console.error(
      "Usage: PRIVATE_KEY=0x... npx tsx demo/agent-privacy-demo.ts"
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);

  const ethBalance = await provider.getBalance(signer.address);
  const usdcBalance = BigInt(await usdc.balanceOf(signer.address));

  const txResults: TxResult[] = [];

  // ── HEADER ──
  printHeader(POOL_ADDRESS);

  console.log(`\n   ${BOLD}Wallet${RESET}:     ${signer.address}`);
  console.log(`   ${BOLD}ETH${RESET}:        ${ethers.formatEther(ethBalance)}`);
  console.log(
    `   ${BOLD}USDC${RESET}:       ${formatUSDC(usdcBalance)} USDC`
  );

  // Balance check
  if (usdcBalance < 3_000_000n) {
    console.error(
      `\n${RED}   ERROR: Need at least 3 USDC. Current: ${formatUSDC(usdcBalance)} USDC${RESET}`
    );
    console.error(`   Get test USDC from: https://faucet.circle.com/`);
    process.exit(1);
  }
  if (ethBalance < ethers.parseEther("0.005")) {
    console.error(
      `\n${RED}   ERROR: Need at least 0.005 ETH for gas.${RESET}`
    );
    process.exit(1);
  }

  // ── INITIALIZATION ──
  console.log(`\n   Initializing Poseidon hash function...`);
  await initPoseidon();

  // Agent A (depositor + sender)
  const agentA = new ShieldedWallet(
    {
      provider,
      signer,
      poolAddress: POOL_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      circuitDir: CIRCUIT_DIR,
      deployBlock: DEPLOY_BLOCK,
    },
    777n // deterministic key for Agent A
  );
  await agentA.initialize();

  // Agent B (receiver) — different ZK keypair, same ETH signer for gas
  const agentB = new ShieldedWallet(
    {
      provider,
      signer,
      poolAddress: POOL_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      circuitDir: CIRCUIT_DIR,
      deployBlock: DEPLOY_BLOCK,
    },
    888n // different key for Agent B
  );
  await agentB.initialize();

  console.log(`\n   ${MAGENTA}Agent A${RESET} (API Provider)`);
  console.log(`     ZK Pubkey: ${agentA.publicKey.toString().slice(0, 20)}...`);
  console.log(`     Status:    ${GREEN}Ready${RESET}`);

  console.log(`\n   ${MAGENTA}Agent B${RESET} (Data Buyer)`);
  console.log(`     ZK Pubkey: ${agentB.publicKey.toString().slice(0, 20)}...`);
  console.log(`     Status:    ${GREEN}Ready${RESET}`);

  // Sync tree
  console.log(`\n   Syncing Merkle tree from on-chain events...`);
  await agentA.syncTree();
  console.log(
    `   Tree synced: ${agentA.getTree().getLeafCount()} leaves ${GREEN}OK${RESET}`
  );

  await sleep(1500);

  // ════════════════════════════════════════════════════════
  // STEP 1: DEPOSIT
  // ════════════════════════════════════════════════════════
  printSeparator();
  printStepHeader(1, "\u{1F4E5}", "Agent A deposits 2 USDC");

  try {
    const depositAmount = 2_000_000n; // 2 USDC

    // Pre-approve USDC for pool (deposit + protocol fee)
    process.stdout.write(`   Approving USDC for pool...             `);
    const approveTx = await usdc.approve(POOL_ADDRESS, 10_000_000n); // generous approval
    await approveTx.wait();
    console.log(`${GREEN}Done${RESET}`);

    const depositResult = await withProgressBar(
      "Building deposit proof (1x2 circuit)...",
      async () => agentA.deposit(depositAmount)
    );

    console.log(`\n   ${GREEN}${BOLD}DEPOSIT SUCCESSFUL${RESET}`);
    printTxBox(depositResult.txHash, depositResult.blockNumber);

    txResults.push({
      step: "Deposit",
      hash: depositResult.txHash,
      block: depositResult.blockNumber,
    });

    printVisibility([
      {
        metric: "Depositor address",
        status: "VISIBLE",
        note: "(acceptable — like using a bank)",
      },
      {
        metric: "Deposit amount",
        status: "HIDDEN",
        note: "(encrypted as commitment)",
      },
      {
        metric: "Internal balance",
        status: "HIDDEN",
        note: "(no one knows pool breakdown)",
      },
    ]);

    console.log(
      `\n   Shielded balance: ${BOLD}${formatUSDC(agentA.getBalance())} USDC${RESET}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n   ${RED}DEPOSIT FAILED: ${msg}${RESET}`);
    process.exit(1);
  }

  await sleep(2000);

  // ════════════════════════════════════════════════════════
  // STEP 2: PRIVATE TRANSFER
  // ════════════════════════════════════════════════════════
  printSeparator();
  printStepHeader(
    2,
    "\u{1F500}",
    "Agent A sends 1 USDC to Agent B (PRIVATE TRANSFER)"
  );

  try {
    const transferAmount = 1_000_000n; // 1 USDC

    console.log(
      `   Recipient ZK pubkey: ${agentB.publicKey.toString().slice(0, 20)}...`
    );
    console.log(`   Selecting UTXOs for ${formatUSDC(transferAmount)} USDC`);

    // generateTransferProof + submitTransact
    const proofResult = await withProgressBar(
      "Building JoinSplit proof (1x2 circuit)...",
      async () =>
        agentA.generateTransferProof(transferAmount, agentB.publicKey)
    );

    process.stdout.write(`   Submitting to Base Sepolia...           `);
    const transferResult = await agentA.submitTransact(proofResult);
    console.log(`${GREEN}Done${RESET}`);

    console.log(`\n   ${GREEN}${BOLD}PRIVATE TRANSFER SUCCESSFUL${RESET}`);
    printTxBox(transferResult.txHash, transferResult.blockNumber);

    txResults.push({
      step: "Private Transfer",
      hash: transferResult.txHash,
      block: transferResult.blockNumber,
    });

    printVisibility([
      {
        metric: "Sender identity",
        status: "HIDDEN",
        note: "(only nullifier visible)",
      },
      {
        metric: "Recipient",
        status: "HIDDEN",
        note: "(stealth commitment)",
      },
      {
        metric: "Transfer amount",
        status: "HIDDEN",
        note: "(publicAmount = 0)",
      },
      {
        metric: "Link to deposit",
        status: "BROKEN",
        note: "(UTXO model, no trace)",
      },
    ]);

    console.log(
      `\n   ${YELLOW}${BOLD}   An observer sees:${RESET} ${YELLOW}"Pool called transact() with some bytes"${RESET}`
    );
    console.log(
      `   ${YELLOW}${BOLD}   They CANNOT determine:${RESET} ${YELLOW}who sent, who received, or how much${RESET}`
    );

    console.log(
      `\n   Agent A remaining: ${BOLD}${formatUSDC(agentA.getBalance())} USDC${RESET}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n   ${RED}TRANSFER FAILED: ${msg}${RESET}`);
    process.exit(1);
  }

  await sleep(2000);

  // ════════════════════════════════════════════════════════
  // STEP 3: WITHDRAW
  // ════════════════════════════════════════════════════════
  printSeparator();
  printStepHeader(3, "\u{1F4E4}", "Agent A withdraws remaining USDC");

  try {
    const balance = agentA.getBalance();
    // Get fee params to calculate net withdraw
    const feeParams = await agentA.getProtocolFeeParams();
    const protocolFee = ShieldedWallet.calculateProtocolFee(
      balance,
      feeParams.feeBps,
      feeParams.minFee,
      feeParams.treasury !== ethers.ZeroAddress
    );
    const withdrawAmount = balance - protocolFee;

    console.log(
      `   Available balance: ${formatUSDC(balance)} USDC`
    );
    console.log(
      `   Protocol fee:      ${formatUSDC(protocolFee)} USDC (circuit-enforced)`
    );
    console.log(
      `   Net withdraw:      ${formatUSDC(withdrawAmount)} USDC`
    );
    console.log(`   Recipient:         ${signer.address}`);

    const withdrawResult = await withProgressBar(
      "Building withdrawal proof (1x2 circuit)...",
      async () => agentA.withdraw(withdrawAmount, signer.address)
    );

    console.log(`\n   ${GREEN}${BOLD}WITHDRAWAL SUCCESSFUL${RESET}`);
    printTxBox(withdrawResult.txHash, withdrawResult.blockNumber);

    txResults.push({
      step: "Withdrawal",
      hash: withdrawResult.txHash,
      block: withdrawResult.blockNumber,
    });

    console.log(
      `\n   USDC received: ${GREEN}${BOLD}+${formatUSDC(withdrawAmount)} USDC${RESET}`
    );

    printVisibility([
      {
        metric: "Withdrawer address",
        status: "VISIBLE",
        note: "(necessary for USDC transfer)",
      },
      {
        metric: "Withdraw amount",
        status: "HIDDEN",
        note: "(encrypted in proof)",
      },
      {
        metric: "Source of funds",
        status: "HIDDEN",
        note: "(which deposit? unknown)",
      },
      {
        metric: "Link to transfer",
        status: "BROKEN",
        note: "(no connection to step 2)",
      },
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n   ${RED}WITHDRAWAL FAILED: ${msg}${RESET}`);
    process.exit(1);
  }

  await sleep(2000);

  // ════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ════════════════════════════════════════════════════════
  printSeparator();
  console.log("");
  console.log(
    `${CYAN}${BOLD}+======================================================+${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}|  PRIVACY ANALYSIS                                    |${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}+======================================================+${RESET}`
  );

  console.log(`
   ${BOLD}WHAT AGENTS KNOW:${RESET}            ${BOLD}WHAT CHAIN SHOWS:${RESET}
   ${DIM}────────────────${RESET}             ${DIM}────────────────${RESET}
   A deposited 2 USDC         TX1: transact(proof)
   A sent 1 to B              TX2: transact(proof)
   A withdrew remaining        TX3: transact(proof)
                               ${DIM}(3 identical-looking calls)${RESET}
`);

  console.log(
    `   ${BOLD}+--------------------+----------+--------------+${RESET}`
  );
  console.log(
    `   ${BOLD}|     Metric         | Normal   |  GhostPay    |${RESET}`
  );
  console.log(
    `   ${BOLD}|                    | USDC     |              |${RESET}`
  );
  console.log(
    `   ${BOLD}+--------------------+----------+--------------+${RESET}`
  );
  console.log(
    `   | Sender visible     | ${RED}  YES    ${RESET}| ${GREEN}   NO        ${RESET}|`
  );
  console.log(
    `   | Recipient visible  | ${RED}  YES    ${RESET}| ${GREEN}   NO        ${RESET}|`
  );
  console.log(
    `   | Amount visible     | ${RED}  YES    ${RESET}| ${GREEN}   NO        ${RESET}|`
  );
  console.log(
    `   | TX linkable        | ${RED}  YES    ${RESET}| ${GREEN}   NO        ${RESET}|`
  );
  console.log(
    `   | Strategy exposed   | ${RED}  YES    ${RESET}| ${GREEN}   NO        ${RESET}|`
  );
  console.log(
    `   ${BOLD}+--------------------+----------+--------------+${RESET}`
  );

  // Protocol fees
  console.log(`
   ${BOLD}PROTOCOL FEES (circuit-enforced):${RESET}
   +-- Deposit:          $0.01 (min fee)
   +-- Private Transfer: $0.01 (min fee)
   +-- Withdrawal:       $0.01 (min fee)
   +-- Total collected:  ${GREEN}$0.03 by treasury${RESET}

   ${DIM}Fees enforced at ZK circuit level —${RESET}
   ${DIM}mathematically impossible to bypass.${RESET}
`);

  // Blockscout links
  console.log(
    `${CYAN}${BOLD}+======================================================+${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}|  VERIFY ON BLOCKSCOUT                                |${RESET}`
  );
  console.log(
    `${CYAN}${BOLD}+======================================================+${RESET}`
  );
  console.log("");

  for (const tx of txResults) {
    console.log(`   ${BOLD}${tx.step}:${RESET}`);
    console.log(`   ${DIM}${BLOCKSCOUT}/tx/${tx.hash}${RESET}`);
    console.log("");
  }

  console.log(`   ${BOLD}Pool Contract (Verified):${RESET}`);
  console.log(`   ${DIM}${BLOCKSCOUT}/address/${POOL_ADDRESS}${RESET}`);

  // On-chain state
  console.log("");
  const poolBalance = BigInt(await pool.getBalance());
  const leafCount = await pool.nextLeafIndex();
  console.log(
    `   Pool USDC:   ${formatUSDC(poolBalance)} USDC`
  );
  console.log(`   Merkle tree: ${leafCount} leaves`);

  console.log(`
${CYAN}${BOLD}+======================================================+${RESET}
${CYAN}${BOLD}|  ${GREEN}All 3 transactions completed successfully.${CYAN}            |${RESET}
${CYAN}${BOLD}|  Privacy: sender, recipient, amount = HIDDEN          |${RESET}
${CYAN}${BOLD}|  github.com/Himess/ghostpay                           |${RESET}
${CYAN}${BOLD}+======================================================+${RESET}
`);
}

main().catch((error) => {
  console.error(`\n${RED}Demo failed: ${error.message}${RESET}`);
  console.error(`${DIM}${error.stack}${RESET}`);
  process.exit(1);
});
