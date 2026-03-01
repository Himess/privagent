// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1

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

/**
 * Relay a transaction via an external GhostPay relayer.
 * The relayer submits the on-chain transaction and charges a fee.
 */
export async function relayViaExternal(
  request: RelayRequest,
  relayerUrl: string,
  apiKey?: string
): Promise<RelayResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-GhostPay-API-Key"] = apiKey;

  const response = await fetch(`${relayerUrl}/v1/relay`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Relay request failed" }));
    throw new Error(`Relay failed: ${(error as { message: string }).message}`);
  }
  return response.json() as Promise<RelayResponse>;
}

/**
 * Get relayer status and fee information.
 */
export async function getRelayerInfo(
  relayerUrl: string
): Promise<RelayerInfo> {
  const response = await fetch(`${relayerUrl}/v1/info`);
  if (!response.ok) throw new Error("Failed to get relayer info");
  return response.json() as Promise<RelayerInfo>;
}
