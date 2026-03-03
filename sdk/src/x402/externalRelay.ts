// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1

export interface RelayRequest {
  proof: {
    pA: string[];
    pB: string[][];
    pC: string[];
  };
  publicSignals: string[];
  extData: {
    recipient: string;
    relayer: string;
    fee: string;
    encryptedOutput1: string;
    encryptedOutput2: string;
  };
  viewTags?: number[];
}

export interface RelayResponse {
  success: boolean;
  txHash: string;
  blockNumber: number;
  fee: string;
}

export interface RelayerInfo {
  status: "online" | "offline";
  address: string;
  fee: string;
  supportedPools: string[];
}

// [H4] Validate URL to prevent SSRF
function validateRelayerUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid relayer URL: ${url}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid relayer URL protocol: ${parsed.protocol}`);
  }
  // Block private/internal IPs
  const hostname = parsed.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    hostname === "[::1]"
  ) {
    throw new Error(`Relayer URL points to private/internal address: ${hostname}`);
  }
}

const FETCH_TIMEOUT_MS = 60_000; // 60s for relay, 10s for info

/**
 * Relay a transaction via an external PrivAgent relayer.
 * The relayer submits the on-chain transaction and charges a fee.
 */
export async function relayViaExternal(
  request: RelayRequest,
  relayerUrl: string,
  apiKey?: string
): Promise<RelayResponse> {
  validateRelayerUrl(relayerUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-PrivAgent-API-Key"] = apiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${relayerUrl}/v1/relay`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: `Relay request failed (${response.status})` }));
      throw new Error(`Relay failed: ${(error as { message: string }).message}`);
    }
    return response.json() as Promise<RelayResponse>;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get relayer status and fee information.
 */
export async function getRelayerInfo(
  relayerUrl: string
): Promise<RelayerInfo> {
  validateRelayerUrl(relayerUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${relayerUrl}/v1/info`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Failed to get relayer info (${response.status})`);
    return response.json() as Promise<RelayerInfo>;
  } finally {
    clearTimeout(timeout);
  }
}
