import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import { ghostPaywall } from "./middleware.js";
import type { V2PaymentPayload, GhostPaywallConfig } from "../types.js";

// Create a mock signer that ethers.Contract accepts
function createMockSigner() {
  const provider = new ethers.JsonRpcProvider("http://localhost:1");
  const wallet = ethers.Wallet.createRandom().connect(provider);
  return wallet;
}

function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
  return {
    headers,
    protocol: "http",
    get: vi.fn().mockReturnValue("localhost:3001"),
    originalUrl: "/api/weather",
    method: "GET",
  };
}

function createMockRes(): Partial<Response> & { _json: any; _status: number; _headers: Record<string, string> } {
  const res: any = {
    _json: null,
    _status: 200,
    _headers: {},
    status: vi.fn().mockImplementation(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: any, body: any) {
      this._json = body;
      return this;
    }),
    setHeader: vi.fn().mockImplementation(function (this: any, key: string, val: string) {
      this._headers[key] = val;
      return this;
    }),
  };
  return res;
}

const mockSigner = createMockSigner();

const baseConfig: GhostPaywallConfig = {
  price: "1000000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  recipient: "0x000000000000000000000000000000000000dEaD",
  poolAddress: "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f",
  signer: mockSigner,
};

function encodePayload(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function makeValidPayload(overrides?: Partial<V2PaymentPayload["payload"]>): V2PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "zk-exact",
      network: "eip155:84532",
      amount: "1000000",
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: 300,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      poolAddress: "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f",
    },
    payload: {
      from: "shielded",
      nullifierHash: "123456789",
      newCommitment: "987654321",
      merkleRoot: "111222333",
      proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
      recipient: "0x000000000000000000000000000000000000dEaD",
      amount: "1000000",
      relayer: "0x0000000000000000000000000000000000000000",
      fee: "0",
      ephemeralPubKey: "0x",
      ...overrides,
    },
  };
}

describe("ghostPaywall middleware", () => {
  it("should throw if no signer provided", () => {
    expect(() =>
      ghostPaywall({ ...baseConfig, signer: undefined as any })
    ).toThrow("signer");
  });

  it("should return 402 with requirements when no Payment header", async () => {
    const middleware = ghostPaywall(baseConfig);
    const req = createMockReq() as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(402);
    expect(res._json.x402Version).toBe(2);
    expect(res._json.accepts).toHaveLength(1);
    expect(res._json.accepts[0].scheme).toBe("zk-exact");
    expect(res._json.accepts[0].amount).toBe("1000000");
    expect(next).not.toHaveBeenCalled();
  });

  it("should include stealthMetaAddress in 402 response", async () => {
    const stealthMeta = {
      spendingPubKey: "0x04aabbccdd",
      viewingPubKey: "0x04eeff0011",
    };
    const middleware = ghostPaywall({ ...baseConfig, stealthMetaAddress: stealthMeta });
    const req = createMockReq() as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(402);
    expect(res._json.accepts[0].stealthMetaAddress).toEqual(stealthMeta);
  });

  it("should return 400 for invalid base64 Payment header (L5)", async () => {
    const middleware = ghostPaywall(baseConfig);
    const req = createMockReq({ payment: "not-valid-json!!!" }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBeTruthy();
  });

  it("should return 400 for invalid payload structure", async () => {
    const middleware = ghostPaywall(baseConfig);
    const encoded = encodePayload({ x402Version: 1 });
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
  });

  it("should return 400 for wrong proof length", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload = makeValidPayload({ proof: ["1", "2", "3"] });
    const encoded = encodePayload(payload);
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain("8 elements");
  });

  it("should return 400 for amount mismatch (L6 generic error)", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload = makeValidPayload({ amount: "500000" });
    // Also update accepted.amount to match
    payload.accepted.amount = "500000";
    const encoded = encodePayload(payload);
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    // L6 FIX: Generic error message — not "Amount mismatch"
    expect(res._json.error).toBe("Invalid payment");
  });

  it("should return 400 for recipient mismatch (C3 fix)", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload = makeValidPayload({ recipient: "0x1111111111111111111111111111111111111111" });
    const encoded = encodePayload(payload);
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe("Invalid payment");
  });

  it("should return 400 for relayer mismatch (C5 fix)", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload = makeValidPayload({ relayer: "0x1111111111111111111111111111111111111111" });
    const encoded = encodePayload(payload);
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe("Invalid payment");
  });

  it("should return 400 for fee exceeding maxFee (C5 fix)", async () => {
    const middleware = ghostPaywall({ ...baseConfig, maxFee: "100" });
    const payload = makeValidPayload({ fee: "101" });
    const encoded = encodePayload(payload);
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe("Invalid payment");
  });

  it("should return 400 for missing required fields", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload = makeValidPayload({ nullifierHash: "" });
    const encoded = encodePayload(payload);
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
  });
});
