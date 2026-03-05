// SPDX-License-Identifier: BUSL-1.1
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutableGameFunctionStatus } from "@virtuals-protocol/game";

// ---------------------------------------------------------------------------
// Mock privagent-sdk BEFORE importing plugin
// ---------------------------------------------------------------------------

const mockSyncTree = vi.fn().mockResolvedValue(undefined);
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockDeposit = vi.fn();
const mockWithdraw = vi.fn();
const mockGenerateTransferProof = vi.fn();
const mockSubmitTransact = vi.fn();
const mockGetBalance = vi.fn().mockReturnValue(5_000_000n); // 5 USDC
const mockGetUTXOs = vi.fn().mockReturnValue([
  { amount: 3_000_000n, spent: false, pending: false },
  { amount: 2_000_000n, spent: false, pending: false },
]);

vi.mock("privagent-sdk", () => ({
  initPoseidon: vi.fn().mockResolvedValue(undefined),
  keypairFromPrivateKey: vi.fn().mockReturnValue({
    privateKey: 12345n,
    publicKey: 67890n,
  }),
  BASE_SEPOLIA_USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ShieldedWallet: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    syncTree: mockSyncTree,
    deposit: mockDeposit,
    withdraw: mockWithdraw,
    generateTransferProof: mockGenerateTransferProof,
    submitTransact: mockSubmitTransact,
    getBalance: mockGetBalance,
    getUTXOs: mockGetUTXOs,
    publicKey: 67890n,
  })),
}));

// Import plugin AFTER mocks are set up
import { PrivAgentPlugin } from "../src/privagentPlugin";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createPlugin() {
  return new PrivAgentPlugin({
    credentials: {
      privateKey:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      poseidonPrivateKey: "12345",
      circuitDir: "/tmp/circuits/build",
    },
  });
}

const noopLogger = (() => {}) as any;

// ---------------------------------------------------------------------------
// Constructor Tests
// ---------------------------------------------------------------------------

describe("PrivAgentPlugin constructor", () => {
  it("creates plugin with default options", () => {
    const plugin = createPlugin();
    expect(plugin).toBeDefined();
  });

  it("creates plugin with custom options", () => {
    const plugin = new PrivAgentPlugin({
      id: "custom_id",
      name: "Custom Name",
      description: "Custom desc",
      credentials: {
        privateKey: "0x01",
        poseidonPrivateKey: "999",
        circuitDir: "/tmp/c",
        rpcUrl: "https://custom-rpc.example.com",
        poolAddress: "0x1111111111111111111111111111111111111111",
        usdcAddress: "0x2222222222222222222222222222222222222222",
        deployBlock: 100000,
      },
    });
    expect(plugin).toBeDefined();
  });

  it("throws if privateKey is missing", () => {
    expect(
      () =>
        new PrivAgentPlugin({
          credentials: {
            privateKey: "",
            poseidonPrivateKey: "123",
            circuitDir: "/tmp",
          },
        })
    ).toThrow("ETH private key is required");
  });

  it("throws if poseidonPrivateKey is missing", () => {
    expect(
      () =>
        new PrivAgentPlugin({
          credentials: {
            privateKey: "0x01",
            poseidonPrivateKey: "",
            circuitDir: "/tmp",
          },
        })
    ).toThrow("Poseidon private key is required");
  });

  it("throws if circuitDir is missing", () => {
    expect(
      () =>
        new PrivAgentPlugin({
          credentials: {
            privateKey: "0x01",
            poseidonPrivateKey: "123",
            circuitDir: "",
          },
        })
    ).toThrow("Circuit directory path is required");
  });
});

// ---------------------------------------------------------------------------
// Deposit Tests
// ---------------------------------------------------------------------------

describe("privagent_deposit", () => {
  let plugin: PrivAgentPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createPlugin();
    mockDeposit.mockResolvedValue({
      txHash: "0xabc123",
      blockNumber: 12345,
      nullifiers: [],
      commitments: [111n],
      publicAmount: 2_000_000n,
    });
  });

  it("deposits USDC successfully", async () => {
    const fn = plugin.depositFunction;
    const result = await fn.executable(
      { amount: "2" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Done);
    const data = JSON.parse(result.feedback);
    expect(data.action).toBe("deposit");
    expect(data.amount).toBe("2");
    expect(data.txHash).toBe("0xabc123");
    expect(data.blockNumber).toBe(12345);
    expect(mockDeposit).toHaveBeenCalledWith(2_000_000n);
  });

  it("deposits fractional USDC", async () => {
    const fn = plugin.depositFunction;
    await fn.executable({ amount: "0.5" } as any, noopLogger);

    expect(mockDeposit).toHaveBeenCalledWith(500_000n);
  });

  it("fails when amount is missing", async () => {
    const fn = plugin.depositFunction;
    const result = await fn.executable(
      { amount: undefined } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Amount is required");
  });

  it("fails when amount is negative", async () => {
    const fn = plugin.depositFunction;
    const result = await fn.executable(
      { amount: "-1" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Invalid amount");
  });

  it("fails when amount is zero", async () => {
    const fn = plugin.depositFunction;
    const result = await fn.executable(
      { amount: "0" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Invalid amount");
  });

  it("fails when amount is not a number", async () => {
    const fn = plugin.depositFunction;
    const result = await fn.executable(
      { amount: "abc" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Invalid amount");
  });

  it("handles deposit error gracefully", async () => {
    mockDeposit.mockRejectedValue(new Error("Insufficient USDC balance"));

    const fn = plugin.depositFunction;
    const result = await fn.executable(
      { amount: "100" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Insufficient USDC balance");
  });
});

// ---------------------------------------------------------------------------
// Transfer Tests
// ---------------------------------------------------------------------------

describe("privagent_transfer", () => {
  let plugin: PrivAgentPlugin;

  const mockProofResult = {
    proofResult: { proofData: {}, nIns: 2, nOuts: 2 },
    extData: {},
    extDataHash: 999n,
    inputUTXOs: [],
    outputUTXOs: [],
    publicAmount: 0n,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createPlugin();
    mockGenerateTransferProof.mockResolvedValue(mockProofResult);
    mockSubmitTransact.mockResolvedValue({
      txHash: "0xdef456",
      blockNumber: 12346,
      nullifiers: [1n, 2n],
      commitments: [3n, 4n],
      publicAmount: 0n,
    });
  });

  it("transfers USDC privately", async () => {
    const fn = plugin.transferFunction;
    const result = await fn.executable(
      {
        amount: "1",
        recipient_pubkey: "67890",
      } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Done);
    const data = JSON.parse(result.feedback);
    expect(data.action).toBe("private_transfer");
    expect(data.amount).toBe("1");
    expect(data.txHash).toBe("0xdef456");
    expect(mockGenerateTransferProof).toHaveBeenCalledWith(
      1_000_000n,
      67890n
    );
    expect(mockSubmitTransact).toHaveBeenCalledWith(mockProofResult);
  });

  it("fails when amount is missing", async () => {
    const fn = plugin.transferFunction;
    const result = await fn.executable(
      { amount: undefined, recipient_pubkey: "123" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("required");
  });

  it("fails when recipient_pubkey is missing", async () => {
    const fn = plugin.transferFunction;
    const result = await fn.executable(
      { amount: "1", recipient_pubkey: undefined } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("required");
  });

  it("fails when amount is invalid", async () => {
    const fn = plugin.transferFunction;
    const result = await fn.executable(
      { amount: "-5", recipient_pubkey: "123" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Invalid amount");
  });

  it("handles proof generation error", async () => {
    mockGenerateTransferProof.mockRejectedValue(
      new Error("Insufficient shielded balance")
    );

    const fn = plugin.transferFunction;
    const result = await fn.executable(
      { amount: "100", recipient_pubkey: "123" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Insufficient shielded balance");
  });

  it("handles submit error after proof succeeds", async () => {
    mockSubmitTransact.mockRejectedValue(new Error("TX reverted"));

    const fn = plugin.transferFunction;
    const result = await fn.executable(
      { amount: "1", recipient_pubkey: "123" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("TX reverted");
  });
});

// ---------------------------------------------------------------------------
// Withdraw Tests
// ---------------------------------------------------------------------------

describe("privagent_withdraw", () => {
  let plugin: PrivAgentPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createPlugin();
    mockWithdraw.mockResolvedValue({
      txHash: "0x789xyz",
      blockNumber: 12347,
      nullifiers: [5n],
      commitments: [6n],
      publicAmount: -1_000_000n,
    });
  });

  it("withdraws USDC successfully", async () => {
    const fn = plugin.withdrawFunction;
    const result = await fn.executable(
      {
        amount: "1",
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
      } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Done);
    const data = JSON.parse(result.feedback);
    expect(data.action).toBe("withdraw");
    expect(data.amount).toBe("1");
    expect(data.recipient).toBe(
      "0x1234567890abcdef1234567890abcdef12345678"
    );
    expect(data.txHash).toBe("0x789xyz");
    expect(mockWithdraw).toHaveBeenCalledWith(
      1_000_000n,
      "0x1234567890abcdef1234567890abcdef12345678"
    );
  });

  it("fails when amount is missing", async () => {
    const fn = plugin.withdrawFunction;
    const result = await fn.executable(
      {
        amount: undefined,
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
      } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("required");
  });

  it("fails when recipient is missing", async () => {
    const fn = plugin.withdrawFunction;
    const result = await fn.executable(
      { amount: "1", recipient: undefined } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("required");
  });

  it("fails when recipient is invalid address", async () => {
    const fn = plugin.withdrawFunction;
    const result = await fn.executable(
      { amount: "1", recipient: "not-an-address" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Invalid Ethereum address");
  });

  it("fails when recipient is too short", async () => {
    const fn = plugin.withdrawFunction;
    const result = await fn.executable(
      { amount: "1", recipient: "0x1234" } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Invalid Ethereum address");
  });

  it("handles withdrawal error gracefully", async () => {
    mockWithdraw.mockRejectedValue(new Error("Proof verification failed"));

    const fn = plugin.withdrawFunction;
    const result = await fn.executable(
      {
        amount: "1",
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
      } as any,
      noopLogger
    );

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("Proof verification failed");
  });
});

// ---------------------------------------------------------------------------
// Balance Tests
// ---------------------------------------------------------------------------

describe("privagent_balance", () => {
  let plugin: PrivAgentPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createPlugin();
    mockGetBalance.mockReturnValue(5_000_000n);
    mockGetUTXOs.mockReturnValue([
      { amount: 3_000_000n },
      { amount: 2_000_000n },
    ]);
  });

  it("returns balance and UTXO count", async () => {
    const fn = plugin.balanceFunction;
    const result = await fn.executable({} as any, noopLogger);

    expect(result.status).toBe(ExecutableGameFunctionStatus.Done);
    const data = JSON.parse(result.feedback);
    expect(data.action).toBe("balance");
    expect(data.shieldedBalance).toBe("5000000");
    expect(data.shieldedBalanceUSDC).toBe("5.00");
    expect(data.utxoCount).toBe(2);
    expect(data.publicKey).toBe("67890");
    expect(mockSyncTree).toHaveBeenCalled();
  });

  it("handles zero balance", async () => {
    mockGetBalance.mockReturnValue(0n);
    mockGetUTXOs.mockReturnValue([]);

    const fn = plugin.balanceFunction;
    const result = await fn.executable({} as any, noopLogger);

    expect(result.status).toBe(ExecutableGameFunctionStatus.Done);
    const data = JSON.parse(result.feedback);
    expect(data.shieldedBalanceUSDC).toBe("0.00");
    expect(data.utxoCount).toBe(0);
  });

  it("handles sync error gracefully", async () => {
    mockSyncTree.mockRejectedValue(new Error("RPC timeout"));

    const fn = plugin.balanceFunction;
    const result = await fn.executable({} as any, noopLogger);

    expect(result.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(result.feedback).toContain("RPC timeout");
  });
});

// ---------------------------------------------------------------------------
// Worker Tests
// ---------------------------------------------------------------------------

describe("getWorker", () => {
  it("returns a GameWorker with all 4 functions", () => {
    const plugin = createPlugin();
    const worker = plugin.getWorker();

    expect(worker).toBeDefined();
    expect(worker.id).toBe("privagent_worker");
    expect(worker.name).toBe("PrivAgent Privacy Worker");
    expect(worker.functions).toHaveLength(4);
  });

  it("allows custom functions override", () => {
    const plugin = createPlugin();
    const worker = plugin.getWorker({
      functions: [plugin.balanceFunction],
    });

    expect(worker.functions).toHaveLength(1);
  });
});
