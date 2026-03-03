import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { initPoseidon } from "../poseidon.js";
import { privAgentFetchV4, createPrivAgentFetchV4 } from "./zkFetchV2.js";
import { ShieldedWallet } from "../v4/shieldedWallet.js";
import { randomBytes } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ethers } from "ethers";

// Mock global fetch
const originalFetch = globalThis.fetch;

describe("V4 privAgentFetchV4", () => {
  let wallet: ShieldedWallet;
  let ecdhPriv: Uint8Array;
  let ecdhPub: Uint8Array;

  beforeAll(async () => {
    await initPoseidon();
    ecdhPriv = randomBytes(32);
    ecdhPub = secp256k1.getPublicKey(ecdhPriv, true);

    wallet = new ShieldedWallet(
      {
        provider: {} as ethers.Provider,
        poolAddress: ethers.ZeroAddress,
        usdcAddress: ethers.ZeroAddress,
        circuitDir: "./circuits/build",
      },
      42n
    );
    await wallet.initialize();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should pass through non-402 responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: "hello" }), { status: 200 })
    );

    const response = await privAgentFetchV4(
      wallet,
      ecdhPriv,
      ecdhPub,
      "https://example.com/api"
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: "hello" });
  });

  it("should return original 402 in dryRun mode", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ x402Version: 4, accepts: [] }), { status: 402 })
    );

    const response = await privAgentFetchV4(
      wallet,
      ecdhPriv,
      ecdhPub,
      "https://example.com/api",
      { dryRun: true }
    );

    expect(response.status).toBe(402);
  });

  it("should return original response if no matching requirements", async () => {
    const body = {
      x402Version: 4,
      accepts: [
        {
          scheme: "unknown-scheme",
          network: "eip155:84532",
          price: "1000000",
        },
      ],
      resource: { url: "https://example.com/api", method: "GET" },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 402 })
    );

    const response = await privAgentFetchV4(
      wallet,
      ecdhPriv,
      ecdhPub,
      "https://example.com/api"
    );

    // Should return original 402 since no zk-exact-v2 scheme matches
    expect(response.status).toBe(402);
  });

  it("should create factory with createPrivAgentFetchV4", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("OK", { status: 200 })
    );

    const fetchFn = createPrivAgentFetchV4(wallet, ecdhPriv, ecdhPub);
    const response = await fetchFn("https://example.com/api");

    expect(response.status).toBe(200);
  });
});

