/**
 * PrivAgent × Virtuals Protocol — GAME Plugin Demo
 *
 * Demonstrates the PrivAgent Virtuals plugin with real on-chain transactions
 * on Base Sepolia. Runs the full privacy flow through GameFunction actions:
 *   1. Check balance
 *   2. Deposit 2 USDC
 *   3. Private transfer 1 USDC
 *   4. Withdraw remaining
 *   5. Final balance check
 *
 * Usage (from repo root):
 *   PRIVATE_KEY=0x... npx tsx packages/virtuals-plugin/examples/demo.ts
 *
 * Or from packages/virtuals-plugin/:
 *   PRIVATE_KEY=0x... npx tsx examples/demo.ts
 *
 * Requires:
 *   - Base Sepolia ETH (>= 0.01 for gas)
 *   - Base Sepolia USDC (>= 3 USDC)
 *   - Deployed PrivAgent contracts on Base Sepolia
 */
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { Wallet } from "ethers";
import { ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { PrivAgentPlugin } from "../src/privagentPlugin.js";

// Load .env from repo root if PRIVATE_KEY not already set
const __root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(__root, ".env");
if (!process.env.PRIVATE_KEY && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
// Configuration
// ============================================================================

const CIRCUIT_DIR = path.resolve(__dirname, "../../../circuits/build");
const BLOCKSCOUT = "https://base-sepolia.blockscout.com";

// Default Poseidon keys (deterministic for demo — NOT for production)
const DEFAULT_KEY_A = "12345678901234567890";
const DEFAULT_KEY_B = "98765432109876543210";

// ============================================================================
// Display Helpers
// ============================================================================

function printHeader() {
  console.log("");
  console.log(
    `${MAGENTA}${BOLD}+======================================================+${RESET}`
  );
  console.log(
    `${MAGENTA}${BOLD}|  PrivAgent × Virtuals Protocol — GAME Plugin Demo    |${RESET}`
  );
  console.log(
    `${MAGENTA}${BOLD}|  Network: Base Sepolia (84532)                        |${RESET}`
  );
  console.log(
    `${MAGENTA}${BOLD}|  Pool: 0x8F1ae820...0fB0b0c                           |${RESET}`
  );
  console.log(
    `${MAGENTA}${BOLD}+======================================================+${RESET}`
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

function printResult(data: Record<string, unknown>) {
  const txHash = data.txHash as string | undefined;
  const blockNumber = data.blockNumber as number | undefined;

  if (txHash) {
    const shortHash = `${txHash.slice(0, 14)}...${txHash.slice(-10)}`;
    console.log(
      `   ${GREEN}+-- TRANSACTION ------------------------------------+${RESET}`
    );
    console.log(
      `   ${GREEN}|${RESET} TX Hash:  ${CYAN}${shortHash}${RESET}`
    );
    if (blockNumber)
      console.log(
        `   ${GREEN}|${RESET} Block:    ${blockNumber.toLocaleString()}`
      );
    console.log(
      `   ${GREEN}|${RESET} View:     ${DIM}${BLOCKSCOUT}/tx/${txHash}${RESET}`
    );
    console.log(
      `   ${GREEN}+--------------------------------------------------+${RESET}`
    );
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === "txHash" || key === "blockNumber") continue;
    console.log(`   ${DIM}${key}:${RESET} ${value}`);
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
    process.stdout.write(
      `\r   ${GREEN}${filled}${DIM}${empty}${RESET} ${elapsed}s`
    );
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

// ============================================================================
// Main
// ============================================================================

async function main() {
  // ── ENV CHECK ──
  if (!process.env.PRIVATE_KEY) {
    console.error(`${RED}ERROR: Set PRIVATE_KEY environment variable${RESET}`);
    console.error(
      "Usage: PRIVATE_KEY=0x... npx tsx packages/virtuals-plugin/examples/demo.ts"
    );
    process.exit(1);
  }

  printHeader();

  const poseidonKeyA = process.env.POSEIDON_KEY_A || DEFAULT_KEY_A;
  const poseidonKeyB = process.env.POSEIDON_KEY_B || DEFAULT_KEY_B;
  const rpcUrl = process.env.RPC_URL || "https://sepolia.base.org";

  console.log(`\n${DIM}   RPC:          ${rpcUrl}${RESET}`);
  console.log(`${DIM}   Circuit Dir:  ${CIRCUIT_DIR}${RESET}`);
  console.log(`${DIM}   Agent A Key:  ${poseidonKeyA.slice(0, 6)}...${RESET}`);
  console.log(`${DIM}   Agent B Key:  ${poseidonKeyB.slice(0, 6)}...${RESET}`);

  // ── CREATE PLUGINS ──
  printSeparator();
  console.log(
    `\n${BOLD}${MAGENTA}  Initializing Virtuals GAME Plugins...${RESET}\n`
  );

  const pluginA = new PrivAgentPlugin({
    id: "agent_a_worker",
    name: "Agent A — Privacy Worker",
    description:
      "Agent A handles private USDC payments via PrivAgent ZK protocol.",
    credentials: {
      privateKey: process.env.PRIVATE_KEY,
      poseidonPrivateKey: poseidonKeyA,
      circuitDir: CIRCUIT_DIR,
      rpcUrl,
      deployBlock: 38347380,
    },
  });

  const pluginB = new PrivAgentPlugin({
    id: "agent_b_worker",
    name: "Agent B — Privacy Worker",
    description: "Agent B receives private USDC payments.",
    credentials: {
      privateKey: process.env.PRIVATE_KEY, // same signer for demo
      poseidonPrivateKey: poseidonKeyB,
      circuitDir: CIRCUIT_DIR,
      rpcUrl,
      deployBlock: 38347380,
    },
  });

  // Create workers (these would be passed to GameAgent)
  const workerA = pluginA.getWorker();
  const workerB = pluginB.getWorker();

  console.log(
    `   ${GREEN}✓${RESET} Agent A worker: ${workerA.id} (${workerA.functions.length} functions)`
  );
  console.log(
    `   ${GREEN}✓${RESET} Agent B worker: ${workerB.id} (${workerB.functions.length} functions)`
  );

  // Show available functions
  console.log(`\n   ${BOLD}Available GameFunctions:${RESET}`);
  for (const fn of workerA.functions) {
    console.log(
      `   ${CYAN}→${RESET} ${fn.name}: ${DIM}${fn.description.slice(0, 70)}...${RESET}`
    );
  }

  // ── Logging helper ──
  const txHashes: { step: string; hash: string }[] = [];

  const logger = (msg: string) => {
    console.log(`   ${DIM}[game]${RESET} ${msg}`);
  };

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1: Check Initial Balance
  // ════════════════════════════════════════════════════════════════════════

  printSeparator();
  printStepHeader(1, "💰", "CHECK INITIAL BALANCE (Agent A)");

  const balanceResult1 = await withProgressBar(
    "Syncing Merkle tree + scanning UTXOs...",
    () => pluginA.balanceFunction.executable({} as any, logger)
  );

  if (balanceResult1.status === ExecutableGameFunctionStatus.Done) {
    const data = JSON.parse(balanceResult1.feedback);
    printResult(data);
    console.log(
      `\n   ${BOLD}Shielded Balance: ${GREEN}${data.shieldedBalanceUSDC} USDC${RESET} (${data.utxoCount} UTXOs)`
    );
  } else {
    console.log(
      `   ${RED}Balance check failed: ${balanceResult1.feedback}${RESET}`
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 2: Deposit 2 USDC
  // ════════════════════════════════════════════════════════════════════════

  printSeparator();
  const depositAmount = process.env.DEPOSIT_AMOUNT || "0.5";
  printStepHeader(2, "📥", `DEPOSIT ${depositAmount} USDC (Agent A)`);

  console.log(`   ${YELLOW}Calling privagent_deposit GameFunction${RESET}`);
  console.log(
    `   ${DIM}Agent autonomously: approve USDC → generate ZK proof → submit TX${RESET}\n`
  );

  const depositResult = await withProgressBar(
    "Generating deposit proof + submitting on-chain...",
    () => pluginA.depositFunction.executable({ amount: depositAmount } as any, logger)
  );

  if (depositResult.status === ExecutableGameFunctionStatus.Done) {
    const data = JSON.parse(depositResult.feedback);
    printResult(data);
    txHashes.push({ step: "Deposit", hash: data.txHash });
  } else {
    console.error(
      `\n   ${RED}Deposit failed: ${depositResult.feedback}${RESET}`
    );
    console.error(
      `   ${RED}Make sure you have 3+ USDC and 0.01+ ETH on Base Sepolia${RESET}`
    );
    process.exit(1);
  }

  await sleep(3000);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3: Private Transfer 1 USDC (Agent A → Agent B)
  // ════════════════════════════════════════════════════════════════════════

  printSeparator();
  const transferAmount = process.env.TRANSFER_AMOUNT || "0.2";
  printStepHeader(3, "🔒", `PRIVATE TRANSFER ${transferAmount} USDC (Agent A → Agent B)`);

  // Get Agent B's public key
  const balanceB = await pluginB.balanceFunction.executable({} as any, logger);
  let recipientPubkey = DEFAULT_KEY_B;
  if (balanceB.status === ExecutableGameFunctionStatus.Done) {
    const bData = JSON.parse(balanceB.feedback);
    recipientPubkey = bData.publicKey;
    console.log(
      `   ${DIM}Agent B pubkey: ${recipientPubkey.slice(0, 20)}...${RESET}`
    );
  }

  console.log(`\n   ${YELLOW}Calling privagent_transfer GameFunction${RESET}`);
  console.log(
    `   ${DIM}On-chain: sender HIDDEN, recipient HIDDEN, amount HIDDEN${RESET}\n`
  );

  const transferResult = await withProgressBar(
    "Generating JoinSplit proof + submitting privately...",
    () =>
      pluginA.transferFunction.executable(
        { amount: transferAmount, recipient_pubkey: recipientPubkey } as any,
        logger
      )
  );

  if (transferResult.status === ExecutableGameFunctionStatus.Done) {
    const data = JSON.parse(transferResult.feedback);
    printResult(data);
    txHashes.push({ step: "Transfer", hash: data.txHash });

    console.log(`\n   ${BOLD}ON-CHAIN VISIBILITY:${RESET}`);
    console.log(
      `   | Sender               | ${GREEN}** HIDDEN ${RESET} | ${DIM}ZK proof, no address link${RESET}`
    );
    console.log(
      `   | Recipient            | ${GREEN}** HIDDEN ${RESET} | ${DIM}Poseidon pubkey only${RESET}`
    );
    console.log(
      `   | Amount               | ${GREEN}** HIDDEN ${RESET} | ${DIM}Encrypted in commitment${RESET}`
    );
    console.log(
      `   | Link to Deposit      | ${GREEN}** BROKEN ${RESET} | ${DIM}Different nullifier set${RESET}`
    );
  } else {
    console.error(
      `\n   ${RED}Transfer failed: ${transferResult.feedback}${RESET}`
    );
    process.exit(1);
  }

  await sleep(3000);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 4: Withdraw Remaining (Agent A)
  // ════════════════════════════════════════════════════════════════════════

  printSeparator();
  printStepHeader(4, "📤", "WITHDRAW REMAINING (Agent A)");

  // Check balance to determine withdraw amount
  const balCheck = await pluginA.balanceFunction.executable({} as any, logger);
  let withdrawAmount = "0.98";
  if (balCheck.status === ExecutableGameFunctionStatus.Done) {
    const bData = JSON.parse(balCheck.feedback);
    const balUSDC = Number(bData.shieldedBalanceUSDC);
    // Withdraw slightly less than full balance for protocol fee
    withdrawAmount = Math.max(0, balUSDC - 0.02).toFixed(2);
    console.log(
      `   ${DIM}Current shielded balance: ${bData.shieldedBalanceUSDC} USDC${RESET}`
    );
    console.log(
      `   ${DIM}Withdrawing: ${withdrawAmount} USDC (minus protocol fee)${RESET}\n`
    );
  }

  console.log(`   ${YELLOW}Calling privagent_withdraw GameFunction${RESET}`);
  console.log(
    `   ${DIM}Converts private USDC back to public USDC${RESET}\n`
  );

  const signer = new Wallet(process.env.PRIVATE_KEY!);
  const recipient = signer.address;

  const withdrawResult = await withProgressBar(
    "Generating withdrawal proof + submitting on-chain...",
    () =>
      pluginA.withdrawFunction.executable(
        { amount: withdrawAmount, recipient } as any,
        logger
      )
  );

  if (withdrawResult.status === ExecutableGameFunctionStatus.Done) {
    const data = JSON.parse(withdrawResult.feedback);
    printResult(data);
    txHashes.push({ step: "Withdraw", hash: data.txHash });
  } else {
    console.error(
      `\n   ${YELLOW}Withdrawal failed: ${withdrawResult.feedback}${RESET}`
    );
  }

  await sleep(2000);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 5: Final Balance Check
  // ════════════════════════════════════════════════════════════════════════

  printSeparator();
  printStepHeader(5, "📊", "FINAL BALANCE CHECK");

  const finalA = await withProgressBar("Agent A balance...", () =>
    pluginA.balanceFunction.executable({} as any, logger)
  );
  const finalB = await withProgressBar("Agent B balance...", () =>
    pluginB.balanceFunction.executable({} as any, logger)
  );

  console.log(`\n   ${BOLD}Final Shielded Balances:${RESET}`);
  if (finalA.status === ExecutableGameFunctionStatus.Done) {
    const a = JSON.parse(finalA.feedback);
    console.log(
      `   ${CYAN}Agent A:${RESET} ${a.shieldedBalanceUSDC} USDC (${a.utxoCount} UTXOs)`
    );
  }
  if (finalB.status === ExecutableGameFunctionStatus.Done) {
    const b = JSON.parse(finalB.feedback);
    console.log(
      `   ${CYAN}Agent B:${RESET} ${b.shieldedBalanceUSDC} USDC (${b.utxoCount} UTXOs)`
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════

  printSeparator();
  console.log(
    `\n${BOLD}${MAGENTA}  VIRTUALS GAME PLUGIN DEMO COMPLETE${RESET}\n`
  );

  console.log(`   ${BOLD}Transactions:${RESET}`);
  for (const tx of txHashes) {
    console.log(
      `   ${GREEN}✓${RESET} ${tx.step.padEnd(12)} ${DIM}${BLOCKSCOUT}/tx/${tx.hash}${RESET}`
    );
  }

  console.log(`\n   ${BOLD}Plugin Architecture:${RESET}`);
  console.log(
    `   ${CYAN}GameAgent${RESET} → ${CYAN}GameWorker${RESET} (privagent_worker) → ${CYAN}4 GameFunctions${RESET}`
  );
  console.log(
    `   ${DIM}├─${RESET} privagent_deposit    ${DIM}— Public USDC → Shielded USDC${RESET}`
  );
  console.log(
    `   ${DIM}├─${RESET} privagent_transfer   ${DIM}— Private agent-to-agent transfer${RESET}`
  );
  console.log(
    `   ${DIM}├─${RESET} privagent_withdraw   ${DIM}— Shielded USDC → Public USDC${RESET}`
  );
  console.log(
    `   ${DIM}└─${RESET} privagent_balance    ${DIM}— Check shielded balance + UTXOs${RESET}`
  );

  console.log(`\n   ${BOLD}Integration:${RESET}`);
  console.log(
    `   ${DIM}const plugin = new PrivAgentPlugin({ credentials: { ... } });${RESET}`
  );
  console.log(`   ${DIM}const agent = new GameAgent(apiKey, {${RESET}`);
  console.log(`   ${DIM}  name: "PrivacyAgent",${RESET}`);
  console.log(`   ${DIM}  goal: "Make private payments",${RESET}`);
  console.log(`   ${DIM}  workers: [plugin.getWorker()],${RESET}`);
  console.log(`   ${DIM}});${RESET}`);
  console.log(`   ${DIM}await agent.init();${RESET}`);
  console.log(`   ${DIM}await agent.run(60);${RESET}`);

  console.log(
    `\n${MAGENTA}${BOLD}+======================================================+${RESET}\n`
  );
}

main().catch((err) => {
  console.error(`\n${RED}${BOLD}Fatal error:${RESET} ${err.message}`);
  if (err.stack) console.error(`${DIM}${err.stack}${RESET}`);
  process.exit(1);
});
