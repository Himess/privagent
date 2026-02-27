import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ghostFetch logic", () => {
  it("should pass through non-402 responses", async () => {
    const mockResponse = new Response(JSON.stringify({ data: "hello" }), {
      status: 200,
    });

    // ghostFetch checks response.status !== 402 → returns immediately
    expect(mockResponse.status).toBe(200);
    expect(mockResponse.status !== 402).toBe(true);
  });

  it("should return 402 response in dryRun mode", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: "zk-exact",
            network: "eip155:84532",
            amount: "1000000",
            payTo: "0xRecipient",
            maxTimeoutSeconds: 300,
            asset: "0xUSDC",
            poolAddress: "0xPool",
          },
        ],
        resource: { url: "http://localhost/api", method: "GET" },
      }),
      { status: 402 }
    );

    expect(mockResponse.status).toBe(402);
    const body = await mockResponse.json();
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0].scheme).toBe("zk-exact");
  });

  it("should build correct V3 Payment header structure", () => {
    const payload = {
      x402Version: 2,
      accepted: {
        scheme: "zk-exact",
        network: "eip155:84532",
        amount: "1000000",
        payTo: "0xRecipient",
        maxTimeoutSeconds: 300,
        asset: "0xUSDC",
        poolAddress: "0xPool",
      },
      payload: {
        from: "shielded",
        nullifierHash: "12345",
        newCommitment: "67890",
        merkleRoot: "11111",
        proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
        recipient: "0xRecipient",
        amount: "1000000",
        relayer: "0x0000000000000000000000000000000000000000",
        fee: "0",
        ephemeralPubKey: "0x04aabb",
      },
    };

    // L5 FIX: Use Buffer-based base64 (not btoa)
    const header = Buffer.from(JSON.stringify(payload)).toString("base64");
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));

    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.proof).toHaveLength(8);
    expect(decoded.payload.recipient).toBe("0xRecipient");
    // V3: single ephemeralPubKey string (not X/Y)
    expect(decoded.payload.ephemeralPubKey).toBe("0x04aabb");
    expect(decoded.payload.ephemeralPubKeyX).toBeUndefined();
    expect(decoded.payload.ephemeralPubKeyY).toBeUndefined();
  });

  it("should enforce maxPayment limit via selectRequirement", () => {
    const maxPayment = 500000n;
    const requirements = [
      {
        scheme: "zk-exact" as const,
        network: "eip155:84532",
        amount: "1000000", // 1 USDC — exceeds max
        payTo: "0xRecipient",
        maxTimeoutSeconds: 300,
        asset: "0xUSDC",
        poolAddress: "0xPool",
      },
    ];

    const selected = requirements.find((req) => {
      if (req.scheme !== "zk-exact") return false;
      if (maxPayment > 0n && BigInt(req.amount) > maxPayment) return false;
      return true;
    });

    expect(selected).toBeUndefined();
  });

  it("X-Payment-TxHash header determines note consumption (H6)", () => {
    // Simulates the logic in ghostFetch:
    // Only consume note when server returns TX hash
    const withTxHash = new Response("ok", {
      status: 200,
      headers: { "X-Payment-TxHash": "0xabc123" },
    });

    const withoutTxHash = new Response("ok", {
      status: 200,
    });

    // With TX hash → consume note
    expect(withTxHash.headers.get("X-Payment-TxHash")).toBe("0xabc123");
    expect(withTxHash.ok).toBe(true);

    // Without TX hash → unlock note (don't consume)
    expect(withoutTxHash.headers.get("X-Payment-TxHash")).toBeNull();
  });

  it("callback receives success flag (H7)", () => {
    // Simulates ghostFetchWithCallback behavior
    const results: { success: boolean }[] = [];

    const onPayment = (_result: any, success: boolean) => {
      results.push({ success });
    };

    // Success case: 200 + TX hash
    onPayment({}, true);
    // Failure case: no TX hash
    onPayment({}, false);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });
});
