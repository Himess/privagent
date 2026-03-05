// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock privagent-sdk BEFORE importing scripts
// ---------------------------------------------------------------------------

const mockSyncTree = vi.fn().mockResolvedValue(undefined);
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockDeposit = vi.fn();
const mockWithdraw = vi.fn();
const mockGenerateTransferProof = vi.fn();
const mockSubmitTransact = vi.fn();
const mockGetBalance = vi.fn().mockReturnValue(5_000_000n);
const mockGetUTXOs = vi.fn().mockReturnValue([
  { amount: 3_000_000n },
  { amount: 2_000_000n },
]);

vi.mock("privagent-sdk", () => ({
  initPoseidon: vi.fn().mockResolvedValue(undefined),
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

// Mock ethers for info.ts (Contract.balanceOf)
vi.mock("ethers", async () => {
  const actual = await vi.importActual("ethers");
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      balanceOf: vi.fn().mockResolvedValue(10_000_000n),
    })),
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      getBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
    })),
    Wallet: vi.fn().mockImplementation(() => ({
      getAddress: vi.fn().mockResolvedValue("0x1234567890abcdef1234567890abcdef12345678"),
    })),
  };
});

// Set env vars for wallet init
process.env.PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
process.env.POSEIDON_PRIVATE_KEY = "12345";
process.env.CIRCUIT_DIR = "/tmp/circuits/build";

import { run as runBalance } from "../scripts/balance.js";
import { run as runDeposit } from "../scripts/deposit.js";
import { run as runWithdraw } from "../scripts/withdraw.js";
import { run as runTransfer } from "../scripts/transfer.js";
import { run as runInfo } from "../scripts/info.js";

// ---------------------------------------------------------------------------
// Balance Tests
// ---------------------------------------------------------------------------

describe("balance script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBalance.mockReturnValue(5_000_000n);
    mockGetUTXOs.mockReturnValue([
      { amount: 3_000_000n },
      { amount: 2_000_000n },
    ]);
  });

  it("returns balance and UTXO count", async () => {
    const raw = await runBalance();
    const data = JSON.parse(raw);

    expect(data.ok).toBe(true);
    expect(data.action).toBe("balance");
    expect(data.shieldedBalance).toBe("5000000");
    expect(data.shieldedBalanceUSDC).toBe("5.00");
    expect(data.utxoCount).toBe(2);
    expect(data.publicKey).toBe("67890");
  });

  it("handles zero balance", async () => {
    mockGetBalance.mockReturnValue(0n);
    mockGetUTXOs.mockReturnValue([]);

    const raw = await runBalance();
    const data = JSON.parse(raw);

    expect(data.ok).toBe(true);
    expect(data.shieldedBalanceUSDC).toBe("0.00");
    expect(data.utxoCount).toBe(0);
  });

  it("handles sync error", async () => {
    mockSyncTree.mockRejectedValueOnce(new Error("RPC timeout"));

    const raw = await runBalance();
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("RPC timeout");
  });
});

// ---------------------------------------------------------------------------
// Deposit Tests
// ---------------------------------------------------------------------------

describe("deposit script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeposit.mockResolvedValue({
      txHash: "0xabc123",
      blockNumber: 12345,
    });
    mockGetBalance.mockReturnValue(7_000_000n);
  });

  it("deposits USDC successfully", async () => {
    const raw = await runDeposit({ amount: "2" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(true);
    expect(data.action).toBe("deposit");
    expect(data.amount).toBe("2");
    expect(data.txHash).toBe("0xabc123");
    expect(data.blockNumber).toBe(12345);
    expect(data.newBalanceUSDC).toBe("7.00");
    expect(mockDeposit).toHaveBeenCalledWith(2_000_000n);
  });

  it("deposits fractional USDC", async () => {
    await runDeposit({ amount: "0.5" });
    expect(mockDeposit).toHaveBeenCalledWith(500_000n);
  });

  it("fails when amount is missing", async () => {
    const raw = await runDeposit({});
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("--amount is required");
  });

  it("fails when amount is negative", async () => {
    const raw = await runDeposit({ amount: "-1" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid amount");
  });

  it("fails when amount is not a number", async () => {
    const raw = await runDeposit({ amount: "abc" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid amount");
  });

  it("handles deposit error gracefully", async () => {
    mockDeposit.mockRejectedValueOnce(new Error("Insufficient USDC balance"));

    const raw = await runDeposit({ amount: "100" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Insufficient USDC balance");
  });
});

// ---------------------------------------------------------------------------
// Withdraw Tests
// ---------------------------------------------------------------------------

describe("withdraw script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithdraw.mockResolvedValue({
      txHash: "0x789xyz",
      blockNumber: 12347,
    });
    mockGetBalance.mockReturnValue(4_000_000n);
  });

  it("withdraws USDC successfully", async () => {
    const raw = await runWithdraw({
      amount: "1",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(true);
    expect(data.action).toBe("withdraw");
    expect(data.amount).toBe("1");
    expect(data.recipient).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(data.txHash).toBe("0x789xyz");
    expect(data.remainingBalanceUSDC).toBe("4.00");
    expect(mockWithdraw).toHaveBeenCalledWith(
      1_000_000n,
      "0x1234567890abcdef1234567890abcdef12345678"
    );
  });

  it("fails when amount is missing", async () => {
    const raw = await runWithdraw({
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("required");
  });

  it("fails when recipient is missing", async () => {
    const raw = await runWithdraw({ amount: "1" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("required");
  });

  it("fails with invalid Ethereum address", async () => {
    const raw = await runWithdraw({
      amount: "1",
      recipient: "not-an-address",
    });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid Ethereum address");
  });

  it("fails with too-short address", async () => {
    const raw = await runWithdraw({
      amount: "1",
      recipient: "0x1234",
    });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid Ethereum address");
  });

  it("fails with invalid amount", async () => {
    const raw = await runWithdraw({
      amount: "abc",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid amount");
  });

  it("handles withdrawal error gracefully", async () => {
    mockWithdraw.mockRejectedValueOnce(new Error("Proof verification failed"));

    const raw = await runWithdraw({
      amount: "1",
      recipient: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Proof verification failed");
  });
});

// ---------------------------------------------------------------------------
// Transfer Tests
// ---------------------------------------------------------------------------

describe("transfer script", () => {
  const mockProofResult = {
    proofResult: { proofData: {}, nIns: 2, nOuts: 2 },
    extData: {},
    extDataHash: 999n,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateTransferProof.mockResolvedValue(mockProofResult);
    mockSubmitTransact.mockResolvedValue({
      txHash: "0xdef456",
      blockNumber: 12346,
    });
    mockGetBalance.mockReturnValue(4_000_000n);
  });

  it("transfers USDC privately", async () => {
    const raw = await runTransfer({ amount: "1", pubkey: "67890" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(true);
    expect(data.action).toBe("private_transfer");
    expect(data.amount).toBe("1");
    expect(data.txHash).toBe("0xdef456");
    expect(data.remainingBalanceUSDC).toBe("4.00");
    expect(mockGenerateTransferProof).toHaveBeenCalledWith(1_000_000n, 67890n);
    expect(mockSubmitTransact).toHaveBeenCalledWith(mockProofResult);
  });

  it("fails when amount is missing", async () => {
    const raw = await runTransfer({ pubkey: "123" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("required");
  });

  it("fails when pubkey is missing", async () => {
    const raw = await runTransfer({ amount: "1" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("required");
  });

  it("fails with invalid amount", async () => {
    const raw = await runTransfer({ amount: "-5", pubkey: "123" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid amount");
  });

  it("fails with invalid pubkey", async () => {
    const raw = await runTransfer({ amount: "1", pubkey: "not-a-bigint" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Invalid pubkey");
  });

  it("handles proof generation error", async () => {
    mockGenerateTransferProof.mockRejectedValueOnce(
      new Error("Insufficient shielded balance")
    );

    const raw = await runTransfer({ amount: "100", pubkey: "123" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("Insufficient shielded balance");
  });

  it("handles submit error after proof succeeds", async () => {
    mockSubmitTransact.mockRejectedValueOnce(new Error("TX reverted"));

    const raw = await runTransfer({ amount: "1", pubkey: "123" });
    const data = JSON.parse(raw);

    expect(data.ok).toBe(false);
    expect(data.error).toContain("TX reverted");
  });
});

// ---------------------------------------------------------------------------
// Info Tests
// ---------------------------------------------------------------------------

describe("info script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pool and wallet info", async () => {
    const raw = await runInfo();
    const data = JSON.parse(raw);

    expect(data.ok).toBe(true);
    expect(data.action).toBe("info");
    expect(data.network).toBe("Base Sepolia");
    expect(data.walletAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(data.poseidonPublicKey).toBe("67890");
    expect(data.poolAddress).toBeDefined();
  });
});
