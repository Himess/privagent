import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import { ghostPaywall } from "./middleware.js";
import type { V2PaymentPayload, GhostPaywallConfig } from "../types.js";

// Create a mock signer that ethers.Contract accepts
// Use a real JsonRpcProvider pointed at a dummy URL — Contract only validates at call-time
function createMockSigner() {
  const provider = new ethers.JsonRpcProvider("http://localhost:1"); // never called
  const wallet = ethers.Wallet.createRandom().connect(provider);
  return wallet;
}

// Mock express req/res/next
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
      spendingPubKeyX: "111",
      spendingPubKeyY: "222",
      viewingPubKeyX: "333",
      viewingPubKeyY: "444",
    };
    const middleware = ghostPaywall({ ...baseConfig, stealthMetaAddress: stealthMeta });
    const req = createMockReq() as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(402);
    expect(res._json.accepts[0].stealthMetaAddress).toEqual(stealthMeta);
  });

  it("should return 400 for invalid base64 Payment header", async () => {
    const middleware = ghostPaywall(baseConfig);
    const req = createMockReq({ payment: "not-valid-base64!!!" }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain("Invalid Payment header");
  });

  it("should return 400 for invalid payload structure", async () => {
    const middleware = ghostPaywall(baseConfig);
    const badPayload = btoa(JSON.stringify({ x402Version: 1 }));
    const req = createMockReq({ payment: badPayload }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain("Invalid payment payload");
  });

  it("should return 400 for wrong proof length", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload: V2PaymentPayload = {
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
        nullifierHash: "123",
        newCommitment: "456",
        merkleRoot: "789",
        proof: ["1", "2", "3"], // wrong length
        recipient: "0x000000000000000000000000000000000000dEaD",
        amount: "1000000",
        relayer: "0x0000000000000000000000000000000000000000",
        fee: "0",
        ephemeralPubKeyX: "0",
        ephemeralPubKeyY: "0",
      },
    };
    const encoded = btoa(JSON.stringify(payload));
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain("8 elements");
  });

  it("should return 400 for amount mismatch", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload: V2PaymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "zk-exact",
        network: "eip155:84532",
        amount: "500000",
        payTo: "0x000000000000000000000000000000000000dEaD",
        maxTimeoutSeconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        poolAddress: "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f",
      },
      payload: {
        from: "shielded",
        nullifierHash: "123",
        newCommitment: "456",
        merkleRoot: "789",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        recipient: "0x000000000000000000000000000000000000dEaD",
        amount: "500000", // doesn't match config price 1000000
        relayer: "0x0000000000000000000000000000000000000000",
        fee: "0",
        ephemeralPubKeyX: "0",
        ephemeralPubKeyY: "0",
      },
    };
    const encoded = btoa(JSON.stringify(payload));
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain("Amount mismatch");
  });

  it("should return 400 for missing required fields", async () => {
    const middleware = ghostPaywall(baseConfig);
    const payload = {
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
        nullifierHash: "",
        newCommitment: "456",
        merkleRoot: "789",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        recipient: "0x000000000000000000000000000000000000dEaD",
        amount: "1000000",
        relayer: "0x0000000000000000000000000000000000000000",
        fee: "0",
        ephemeralPubKeyX: "0",
        ephemeralPubKeyY: "0",
      },
    };
    const encoded = btoa(JSON.stringify(payload));
    const req = createMockReq({ payment: encoded }) as Request;
    const res = createMockRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain("Missing required");
  });
});
