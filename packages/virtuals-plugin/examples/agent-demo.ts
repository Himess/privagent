/**
 * PrivAgent × Virtuals Protocol — Full Autonomous Agent Demo
 *
 * Creates a real GameAgent with the PrivAgent plugin that autonomously
 * decides when to deposit, transfer, and check balance.
 *
 * Usage:
 *   npx tsx packages/virtuals-plugin/examples/agent-demo.ts
 *
 * Reads from repo root .env:
 *   PRIVATE_KEY, GAME_API_KEY
 */
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { GameAgent } from "@virtuals-protocol/game";
import { PrivAgentPlugin } from "../src/privagentPlugin.js";

// Load .env
const __root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(__root, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const CIRCUIT_DIR = path.resolve(__root, "circuits/build");

// ── Colors ──
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error(`${RED}ERROR: PRIVATE_KEY not set in .env${RESET}`);
    process.exit(1);
  }
  if (!process.env.GAME_API_KEY) {
    console.error(`${RED}ERROR: GAME_API_KEY not set in .env${RESET}`);
    process.exit(1);
  }

  console.log(`\n${MAGENTA}${BOLD}+======================================================+${RESET}`);
  console.log(`${MAGENTA}${BOLD}|  PrivAgent × Virtuals — Autonomous GAME Agent        |${RESET}`);
  console.log(`${MAGENTA}${BOLD}+======================================================+${RESET}\n`);

  // ── Create Plugin ──
  const plugin = new PrivAgentPlugin({
    credentials: {
      privateKey: process.env.PRIVATE_KEY,
      poseidonPrivateKey: process.env.POSEIDON_KEY_A || "12345678901234567890",
      circuitDir: CIRCUIT_DIR,
      rpcUrl: "https://sepolia.base.org",
      deployBlock: 38347380,
    },
  });

  const worker = plugin.getWorker();
  console.log(`${GREEN}✓${RESET} Plugin created: ${worker.functions.length} GameFunctions`);

  // ── Create Agent ──
  const agent = new GameAgent(process.env.GAME_API_KEY, {
    name: "PrivAgent",
    goal: "Manage private USDC payments using ZK proofs. First check your shielded balance, then if balance is 0, deposit 0.1 USDC. After depositing, check balance again to confirm.",
    description: "You are a privacy-focused AI agent on Base Sepolia. You can deposit USDC into a shielded pool (converting public USDC to private), transfer privately to other agents, withdraw back to public, and check your shielded balance. All operations use zero-knowledge proofs for privacy.",
    workers: [worker],
  });

  // ── Custom Logger ──
  agent.setLogger((a, msg) => {
    console.log(`${DIM}[${a.name}]${RESET} ${msg}`);
  });

  console.log(`${GREEN}✓${RESET} GameAgent created: "${agent.name}"`);
  console.log(`${DIM}  Goal: ${agent.goal.slice(0, 80)}...${RESET}\n`);

  // ── Initialize ──
  console.log(`${CYAN}Initializing agent...${RESET}`);
  await agent.init();
  console.log(`${GREEN}✓${RESET} Agent initialized\n`);

  // ── Run Steps ──
  const maxSteps = 5;
  console.log(`${BOLD}Running ${maxSteps} autonomous steps...${RESET}\n`);

  for (let i = 1; i <= maxSteps; i++) {
    console.log(`${CYAN}${BOLD}── Step ${i}/${maxSteps} ──${RESET}`);
    try {
      const action = await agent.step({ verbose: true });
      console.log(`${GREEN}Action: ${action}${RESET}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${RED}Step ${i} error: ${msg}${RESET}\n`);
    }
  }

  console.log(`\n${MAGENTA}${BOLD}+======================================================+${RESET}`);
  console.log(`${MAGENTA}${BOLD}|  Agent completed ${maxSteps} steps                              |${RESET}`);
  console.log(`${MAGENTA}${BOLD}+======================================================+${RESET}\n`);
}

main().catch((err) => {
  console.error(`${RED}${BOLD}Fatal:${RESET} ${err.message}`);
  process.exit(1);
});
