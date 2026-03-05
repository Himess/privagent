// SPDX-License-Identifier: BUSL-1.1
/**
 * Integration test — runs against real Base Sepolia contracts.
 *
 * Requirements:
 *   PRIVATE_KEY            — ETH private key with Base Sepolia ETH + USDC
 *   POSEIDON_KEY           — Poseidon private key (bigint string, default: demo key)
 *   CIRCUIT_DIR            — Path to circuits/build directory (default: ../../circuits/build)
 *
 * Run:
 *   PRIVATE_KEY=0x... npx vitest run tests/integration.test.ts --timeout 120000
 */
import { describe, it, expect } from "vitest";
import { ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { PrivAgentPlugin } from "../src/privagentPlugin";

const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || process.env.PRIVATE_KEY;
const POSEIDON_KEY = process.env.TEST_POSEIDON_KEY || process.env.POSEIDON_KEY || "12345678901234567890";
const CIRCUIT_DIR = process.env.TEST_CIRCUIT_DIR || process.env.CIRCUIT_DIR || "../../circuits/build";

const canRun = !!PRIVATE_KEY;

describe.skipIf(!canRun)("PrivAgent Virtuals Plugin — Base Sepolia", () => {
  let plugin: PrivAgentPlugin;

  const logger = (msg: string) => console.log(`  [integration] ${msg}`);

  it("initializes plugin", () => {
    plugin = new PrivAgentPlugin({
      credentials: {
        privateKey: PRIVATE_KEY!,
        poseidonPrivateKey: POSEIDON_KEY!,
        circuitDir: CIRCUIT_DIR,
        rpcUrl: "https://sepolia.base.org",
        deployBlock: 38347380,
      },
    });
    expect(plugin).toBeDefined();
  });

  it(
    "checks shielded balance",
    async () => {
      const fn = plugin.balanceFunction;
      const result = await fn.executable({} as any, logger);

      expect(result.status).toBe(ExecutableGameFunctionStatus.Done);

      const data = JSON.parse(result.feedback);
      console.log("  Balance:", data.shieldedBalanceUSDC, "USDC");
      console.log("  UTXOs:", data.utxoCount);
      console.log("  Public key:", data.publicKey);

      expect(data.action).toBe("balance");
      expect(Number(data.shieldedBalanceUSDC)).toBeGreaterThanOrEqual(0);
    },
    { timeout: 120_000 }
  );

  it(
    "deposits 0.01 USDC",
    async () => {
      const fn = plugin.depositFunction;
      const result = await fn.executable(
        { amount: "0.01" } as any,
        logger
      );

      expect(result.status).toBe(ExecutableGameFunctionStatus.Done);

      const data = JSON.parse(result.feedback);
      console.log("  Deposit TX:", data.txHash);
      console.log("  Block:", data.blockNumber);

      expect(data.action).toBe("deposit");
      expect(data.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(data.blockNumber).toBeGreaterThan(0);
    },
    { timeout: 120_000 }
  );

  it("creates a worker with getEnvironment", async () => {
    const worker = plugin.getWorker();
    expect(worker).toBeDefined();
    expect(worker.functions).toHaveLength(4);

    if (worker.getEnvironment) {
      const env = await worker.getEnvironment();
      console.log("  Worker env:", env);
      expect(env.network).toBe("Base Sepolia");
    }
  });
});
