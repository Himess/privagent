import { describe, it, expect, vi, beforeEach } from "vitest";
import { relayViaExternal, getRelayerInfo, RelayRequest } from "./externalRelay.js";

const mockRequest: RelayRequest = {
  proof: {
    pA: ["1", "2"],
    pB: [["3", "4"], ["5", "6"]],
    pC: ["7", "8"],
  },
  publicSignals: ["100", "200", "300"],
  extData: {
    recipient: "0x1234",
    relayer: "0x5678",
    fee: "10000",
    encryptedOutput1: "0xaa",
    encryptedOutput2: "0xbb",
  },
};

describe("External Relay", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should send relay request with correct body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        txHash: "0xabc",
        blockNumber: 100,
        fee: "10000",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await relayViaExternal(mockRequest, "https://relay.example.com");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://relay.example.com/v1/relay",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(mockRequest),
      })
    );
    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xabc");
  });

  it("should include API key header when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, txHash: "0x1", blockNumber: 1, fee: "0" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await relayViaExternal(mockRequest, "https://relay.example.com", "my-api-key");
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-GhostPay-API-Key"]).toBe("my-api-key");
  });

  it("should throw on relay failure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: "Fee too low" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      relayViaExternal(mockRequest, "https://relay.example.com")
    ).rejects.toThrow("Relay failed: Fee too low");
  });

  it("should get relayer info", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: "online",
        address: "0xrelayer",
        fee: "20000",
        supportedPools: ["0xpool1"],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const info = await getRelayerInfo("https://relay.example.com");
    expect(info.status).toBe("online");
    expect(info.supportedPools).toContain("0xpool1");
  });

  it("should throw if relayer info fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      getRelayerInfo("https://relay.example.com")
    ).rejects.toThrow("Failed to get relayer info");
  });
});
