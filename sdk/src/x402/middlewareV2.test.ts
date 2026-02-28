import { describe, it, expect, beforeAll, vi } from "vitest";
import { initPoseidon } from "../poseidon.js";
import { ghostPaywallV4 } from "./middlewareV2.js";
import { createUTXO, derivePublicKey } from "../v4/utxo.js";
import { encryptNote } from "../v4/noteEncryption.js";
import { computeExtDataHash, ExtData } from "../v4/extData.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { randomBytes } from "crypto";
import { ethers } from "ethers";
import type { GhostPaywallConfigV4, V4PaymentPayload } from "../types.js";

// Mock Express req/res/next
function mockReq(headers: Record<string, string> = {}): Record<string, unknown> {
  return {
    headers,
    protocol: "https",
    get: (h: string) => (h === "host" ? "example.com" : undefined),
    originalUrl: "/api/data",
  };
}

function mockRes(): {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  _status: number;
  _body: unknown;
} {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    _status: 0,
    _body: null as unknown,
  };
  res.status.mockImplementation((code: number) => {
    res._status = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res._body = body;
    return res;
  });
  return res;
}

describe("V4 ghostPaywallV4 Middleware", () => {
  let serverEcdhPriv: Uint8Array;
  let serverEcdhPub: Uint8Array;
  let config: GhostPaywallConfigV4;

  beforeAll(async () => {
    await initPoseidon();
    serverEcdhPriv = randomBytes(32);
    serverEcdhPub = secp256k1.getPublicKey(serverEcdhPriv, true);

    config = {
      price: "1000000",
      asset: "USDC",
      poolAddress: "0x" + "11".repeat(20),
      signer: { getAddress: async () => ethers.ZeroAddress } as unknown as ethers.Signer,
      poseidonPubkey: derivePublicKey(100n).toString(),
      ecdhPrivateKey: serverEcdhPriv,
      ecdhPublicKey: serverEcdhPub,
    };
  });

  it("should throw if no signer provided", () => {
    expect(() =>
      ghostPaywallV4({ ...config, signer: undefined as unknown as ethers.Signer })
    ).toThrow("requires a signer");
  });

  it("should return 402 when no Payment header", async () => {
    const middleware = ghostPaywallV4(config);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(402);
    expect(res._body).toHaveProperty("x402Version", 4);
    expect(res._body).toHaveProperty("accepts");
    const accepts = (res._body as Record<string, unknown>).accepts as Array<Record<string, unknown>>;
    expect(accepts[0]).toHaveProperty("scheme", "zk-exact-v2");
    expect(accepts[0]).toHaveProperty("payToPubkey", config.poseidonPubkey);
    expect(accepts[0]).toHaveProperty("serverEcdhPubKey");
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject invalid base64 Payment header", async () => {
    const middleware = ghostPaywallV4(config);
    const req = mockReq({ payment: "not-valid-base64!!!" });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject wrong x402 version", async () => {
    const middleware = ghostPaywallV4(config);
    const payload = { x402Version: 2, payload: {} };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const req = mockReq({ payment: header });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>).error).toBe(
      "Invalid payment payload structure"
    );
  });

  it("should reject invalid proof length", async () => {
    const middleware = ghostPaywallV4(config);
    const payload = {
      x402Version: 4,
      payload: {
        proof: ["1", "2", "3"], // only 3, not 8
        nullifiers: ["111"],
        commitments: ["222", "333"],
        root: "444",
        extData: {},
        senderEcdhPubKey: "0x00",
        nIns: 1,
        nOuts: 2,
      },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const req = mockReq({ payment: header });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>).error).toBe(
      "Invalid proof: expected array of 8 elements"
    );
  });

  it("should reject nullifier/commitment count mismatch", async () => {
    const middleware = ghostPaywallV4(config);
    const payload = {
      x402Version: 4,
      payload: {
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        nullifiers: ["111", "222"], // 2 nullifiers
        commitments: ["333", "444"],
        root: "555",
        extData: { recipient: ethers.ZeroAddress, relayer: ethers.ZeroAddress, fee: "0", encryptedOutput1: "0x00", encryptedOutput2: "0x00" },
        senderEcdhPubKey: "0x00",
        nIns: 1, // claims 1 but has 2 nullifiers
        nOuts: 2,
        publicAmount: "0",
        extDataHash: "123",
      },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const req = mockReq({ payment: header });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>).error).toBe(
      "Nullifier/commitment count mismatch"
    );
  });

  it("should reject wrong extDataHash", async () => {
    const middleware = ghostPaywallV4(config);
    const payload = {
      x402Version: 4,
      payload: {
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        nullifiers: ["111"],
        commitments: ["222", "333"],
        root: "444",
        publicAmount: "0",
        extDataHash: "99999", // wrong hash
        extData: {
          recipient: ethers.ZeroAddress,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0xaa",
          encryptedOutput2: "0xbb",
        },
        senderEcdhPubKey: "0x00",
        nIns: 1,
        nOuts: 2,
      },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const req = mockReq({ payment: header });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>).error).toBe("extDataHash mismatch");
  });

  it("should reject wrong payment amount via note decryption", async () => {
    const middleware = ghostPaywallV4(config);

    // Create a UTXO with WRONG amount (500000 instead of 1000000)
    const serverPoseidonPubkey = derivePublicKey(100n);
    const wrongAmountUTXO = createUTXO(500000n, serverPoseidonPubkey);

    // Encrypt with valid ECDH keys
    const buyerEcdhPriv = randomBytes(32);
    const buyerEcdhPub = secp256k1.getPublicKey(buyerEcdhPriv, true);
    const enc1 = encryptNote(wrongAmountUTXO, buyerEcdhPriv, serverEcdhPub);
    const enc2 = new Uint8Array([0xbb]);

    // Compute correct extDataHash
    const extData: ExtData = {
      recipient: ethers.ZeroAddress,
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: enc1,
      encryptedOutput2: enc2,
    };
    const extDataHash = computeExtDataHash(extData);

    const payload: V4PaymentPayload = {
      x402Version: 4,
      accepted: {
        scheme: "zk-exact-v2",
        network: "eip155:84532",
        price: "1000000",
        asset: "USDC",
        poolAddress: config.poolAddress,
        payToPubkey: config.poseidonPubkey,
        serverEcdhPubKey: "0x" + Buffer.from(serverEcdhPub).toString("hex"),
        maxTimeoutSeconds: 300,
      },
      payload: {
        from: "shielded-v4",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        nullifiers: ["111"],
        commitments: ["222", "333"],
        root: "444",
        publicAmount: "0",
        extDataHash: extDataHash.toString(),
        extData: {
          recipient: ethers.ZeroAddress,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0x" + Buffer.from(enc1).toString("hex"),
          encryptedOutput2: "0x" + Buffer.from(enc2).toString("hex"),
        },
        nIns: 1,
        nOuts: 2,
        senderEcdhPubKey: "0x" + Buffer.from(buyerEcdhPub).toString("hex"),
      },
    };

    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const req = mockReq({ payment: header });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>).error).toBe(
      "Invalid payment amount"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should pass amount verification with correct note", async () => {
    // This test verifies that amount decryption succeeds for correct amount.
    // The middleware will then try pre-flight checks which will fail (no real contract),
    // but the amount verification itself passes.
    const middleware = ghostPaywallV4(config);

    const serverPoseidonPubkey = derivePublicKey(100n);
    const correctAmountUTXO = createUTXO(1000000n, serverPoseidonPubkey); // correct price

    const buyerEcdhPriv = randomBytes(32);
    const buyerEcdhPub = secp256k1.getPublicKey(buyerEcdhPriv, true);
    const enc1 = encryptNote(correctAmountUTXO, buyerEcdhPriv, serverEcdhPub);
    const enc2 = new Uint8Array([0xbb]);

    const extData: ExtData = {
      recipient: ethers.ZeroAddress,
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: enc1,
      encryptedOutput2: enc2,
    };
    const extDataHash = computeExtDataHash(extData);

    const payload: V4PaymentPayload = {
      x402Version: 4,
      accepted: {
        scheme: "zk-exact-v2",
        network: "eip155:84532",
        price: "1000000",
        asset: "USDC",
        poolAddress: config.poolAddress,
        payToPubkey: config.poseidonPubkey,
        serverEcdhPubKey: "0x" + Buffer.from(serverEcdhPub).toString("hex"),
        maxTimeoutSeconds: 300,
      },
      payload: {
        from: "shielded-v4",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        nullifiers: ["111"],
        commitments: ["222", "333"],
        root: "444",
        publicAmount: "0",
        extDataHash: extDataHash.toString(),
        extData: {
          recipient: ethers.ZeroAddress,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0x" + Buffer.from(enc1).toString("hex"),
          encryptedOutput2: "0x" + Buffer.from(enc2).toString("hex"),
        },
        nIns: 1,
        nOuts: 2,
        senderEcdhPubKey: "0x" + Buffer.from(buyerEcdhPub).toString("hex"),
      },
    };

    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const req = mockReq({ payment: header });
    const res = mockRes();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    // Should fail at pre-flight check (no real contract), NOT at amount verification
    expect(res._status).toBe(500);
    expect((res._body as Record<string, string>).error).toBe(
      "Payment verification failed"
    );
  });
});
