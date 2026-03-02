import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "../poseidon.js";
import {
  ZkPaymentHandlerV4,
  decodePaymentHeaderV4,
} from "./zkExactSchemeV2.js";
import { ShieldedWallet } from "../v4/shieldedWallet.js";
import { createUTXO, derivePublicKey } from "../v4/utxo.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { randomBytes } from "crypto";
import { ethers } from "ethers";
import type {
  ZkPaymentRequirementsV4,
  PaymentRequiredV4,
} from "../types.js";

describe("V4 ZkPaymentHandlerV4", () => {
  let buyerEcdhPriv: Uint8Array;
  let buyerEcdhPub: Uint8Array;
  let handler: ZkPaymentHandlerV4;

  beforeAll(async () => {
    await initPoseidon();
    buyerEcdhPriv = randomBytes(32);
    buyerEcdhPub = secp256k1.getPublicKey(buyerEcdhPriv, true);

    // Create a minimal wallet (no real provider/signer needed for unit tests)
    const wallet = new ShieldedWallet(
      {
        provider: {} as ethers.Provider,
        poolAddress: ethers.ZeroAddress,
        usdcAddress: ethers.ZeroAddress,
        circuitDir: "./circuits/build",
      },
      42n
    );
    await wallet.initialize();

    handler = new ZkPaymentHandlerV4(wallet, buyerEcdhPriv, buyerEcdhPub);
  });

  it("should parse valid V4 402 response", async () => {
    const body: PaymentRequiredV4 = {
      x402Version: 4,
      accepts: [
        {
          scheme: "zk-exact-v2",
          network: "eip155:84532",
          price: "1000000",
          asset: "USDC",
          poolAddress: ethers.ZeroAddress,
          payToPubkey: "12345",
          serverEcdhPubKey: "0x" + Buffer.from(randomBytes(33)).toString("hex"),
          maxTimeoutSeconds: 300,
        },
      ],
      resource: { url: "https://example.com/api", method: "GET" },
    };

    const response = new Response(JSON.stringify(body), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });

    const parsed = await handler.parsePaymentRequired(response);
    expect(parsed).not.toBeNull();
    expect(parsed!.x402Version).toBe(4);
    expect(parsed!.accepts[0].scheme).toBe("zk-exact-v2");
    expect(parsed!.accepts[0].price).toBe("1000000");
  });

  it("should return null for non-402 response", async () => {
    const response = new Response("OK", { status: 200 });
    const parsed = await handler.parsePaymentRequired(response);
    expect(parsed).toBeNull();
  });

  it("should return null for wrong x402 version", async () => {
    const response = new Response(
      JSON.stringify({ x402Version: 2, accepts: [] }),
      { status: 402 }
    );
    const parsed = await handler.parsePaymentRequired(response);
    expect(parsed).toBeNull();
  });

  it("should select matching requirement", () => {
    const requirements: ZkPaymentRequirementsV4[] = [
      {
        scheme: "zk-exact-v2",
        network: "eip155:84532",
        price: "1000000",
        asset: "USDC",
        poolAddress: ethers.ZeroAddress,
        payToPubkey: "12345",
        serverEcdhPubKey: "0xabcd",
        maxTimeoutSeconds: 300,
      },
    ];

    const selected = handler.selectRequirement(requirements);
    expect(selected).not.toBeNull();
    expect(selected!.price).toBe("1000000");
  });

  it("should reject wrong scheme", () => {
    const requirements = [
      {
        scheme: "zk-exact" as "zk-exact-v2", // wrong scheme
        network: "eip155:84532",
        price: "1000000",
        asset: "USDC",
        poolAddress: ethers.ZeroAddress,
        payToPubkey: "12345",
        serverEcdhPubKey: "0xabcd",
        maxTimeoutSeconds: 300,
      },
    ];

    const selected = handler.selectRequirement(requirements);
    expect(selected).toBeNull();
  });

  it("should filter by allowed networks", () => {
    const handlerFiltered = new ZkPaymentHandlerV4(
      handler["wallet"],
      buyerEcdhPriv,
      buyerEcdhPub,
      { allowedNetworks: ["eip155:1"] }
    );

    const requirements: ZkPaymentRequirementsV4[] = [
      {
        scheme: "zk-exact-v2",
        network: "eip155:84532",
        price: "1000000",
        asset: "USDC",
        poolAddress: ethers.ZeroAddress,
        payToPubkey: "12345",
        serverEcdhPubKey: "0xabcd",
        maxTimeoutSeconds: 300,
      },
    ];

    const selected = handlerFiltered.selectRequirement(requirements);
    expect(selected).toBeNull();
  });

  it("should filter by max payment", () => {
    const handlerFiltered = new ZkPaymentHandlerV4(
      handler["wallet"],
      buyerEcdhPriv,
      buyerEcdhPub,
      { maxPayment: 500000n }
    );

    const requirements: ZkPaymentRequirementsV4[] = [
      {
        scheme: "zk-exact-v2",
        network: "eip155:84532",
        price: "1000000", // over max
        asset: "USDC",
        poolAddress: ethers.ZeroAddress,
        payToPubkey: "12345",
        serverEcdhPubKey: "0xabcd",
        maxTimeoutSeconds: 300,
      },
    ];

    const selected = handlerFiltered.selectRequirement(requirements);
    expect(selected).toBeNull();
  });

  it("should encode and decode payment header (roundtrip)", () => {
    const payload = {
      x402Version: 4 as const,
      accepted: {
        scheme: "zk-exact-v2" as const,
        network: "eip155:84532",
        price: "1000000",
        asset: "USDC",
        poolAddress: ethers.ZeroAddress,
        payToPubkey: "12345",
        serverEcdhPubKey: "0xabcd",
        maxTimeoutSeconds: 300,
      },
      payload: {
        from: "shielded-v4" as const,
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        nullifiers: ["111"],
        commitments: ["222", "333"],
        root: "444",
        publicAmount: "0",
        extDataHash: "555",
        extData: {
          recipient: ethers.ZeroAddress,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0xaa",
          encryptedOutput2: "0xbb",
        },
        nIns: 1,
        nOuts: 2,
        senderEcdhPubKey: "0xabcd",
        protocolFee: "10000",
        viewTags: [42, 0],
      },
    };

    // Encode
    const json = JSON.stringify(payload);
    const header = Buffer.from(json).toString("base64");

    // Decode
    const decoded = decodePaymentHeaderV4(header);
    expect(decoded.x402Version).toBe(4);
    expect(decoded.payload.from).toBe("shielded-v4");
    expect(decoded.payload.proof).toHaveLength(8);
    expect(decoded.payload.nullifiers).toEqual(["111"]);
    expect(decoded.payload.commitments).toEqual(["222", "333"]);
  });
});
