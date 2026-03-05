// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock privagent-sdk BEFORE importing wallet module
// ---------------------------------------------------------------------------

const mockSyncTree = vi.fn().mockResolvedValue(undefined);
const mockInitialize = vi.fn().mockResolvedValue(undefined);
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
    getBalance: mockGetBalance,
    getUTXOs: mockGetUTXOs,
    publicKey: 67890n,
    deposit: vi.fn(),
    withdraw: vi.fn(),
    generateTransferProof: vi.fn(),
    submitTransact: vi.fn(),
  })),
}));

import { parseAmount, formatUSDC, ok, fail, parseCliArgs } from "../scripts/_wallet.js";

// ---------------------------------------------------------------------------
// parseAmount
// ---------------------------------------------------------------------------

describe("parseAmount", () => {
  it("parses integer USDC", () => {
    expect(parseAmount("2")).toBe(2_000_000n);
  });

  it("parses fractional USDC", () => {
    expect(parseAmount("0.5")).toBe(500_000n);
  });

  it("parses small fractional USDC", () => {
    expect(parseAmount("0.01")).toBe(10_000n);
  });

  it("throws on negative amount", () => {
    expect(() => parseAmount("-1")).toThrow("Invalid amount");
  });

  it("throws on zero", () => {
    expect(() => parseAmount("0")).toThrow("Invalid amount");
  });

  it("throws on non-numeric string", () => {
    expect(() => parseAmount("abc")).toThrow("Invalid amount");
  });
});

// ---------------------------------------------------------------------------
// formatUSDC
// ---------------------------------------------------------------------------

describe("formatUSDC", () => {
  it("formats raw bigint to USDC string", () => {
    expect(formatUSDC(5_000_000n)).toBe("5.00");
  });

  it("formats zero", () => {
    expect(formatUSDC(0n)).toBe("0.00");
  });

  it("formats fractional", () => {
    expect(formatUSDC(500_000n)).toBe("0.50");
  });

  it("formats small amounts", () => {
    expect(formatUSDC(10_000n)).toBe("0.01");
  });
});

// ---------------------------------------------------------------------------
// ok / fail helpers
// ---------------------------------------------------------------------------

describe("ok", () => {
  it("returns JSON with ok:true", () => {
    const result = JSON.parse(ok({ action: "test" }));
    expect(result.ok).toBe(true);
    expect(result.action).toBe("test");
  });
});

describe("fail", () => {
  it("returns JSON with ok:false", () => {
    const result = JSON.parse(fail("something broke"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("something broke");
  });
});

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  it("parses --key value pairs", () => {
    const args = parseCliArgs(["--amount", "2", "--recipient", "0xabc"]);
    expect(args.amount).toBe("2");
    expect(args.recipient).toBe("0xabc");
  });

  it("returns empty object for no args", () => {
    const args = parseCliArgs([]);
    expect(Object.keys(args)).toHaveLength(0);
  });
});
