import { ZkPaymentHandler } from "./zkExactScheme.js";
import { ShieldedPoolClient } from "../legacy/pool.js";
import type { GhostFetchOptions, PaymentResult } from "../types.js";

/**
 * Creates an x402-aware fetch function bound to a ShieldedPoolClient.
 *
 * Automatically handles 402 responses by creating ZK proofs and retrying.
 * After server confirms payment (2xx + X-Payment-TxHash), updates local note state.
 */
export function createGhostFetch(
  client: ShieldedPoolClient,
  defaultOptions?: Partial<GhostFetchOptions>
): (url: string | URL, options?: GhostFetchOptions) => Promise<Response> {
  return (url: string | URL, options?: GhostFetchOptions) =>
    ghostFetch(client, url, { ...defaultOptions, ...options });
}

/**
 * Performs an HTTP request with automatic x402 ZK payment handling.
 *
 * Flow:
 * 1. Fetch URL → get 402 with payment requirements
 * 2. Generate ZK proof client-side (no TX)
 * 3. Retry with proof in Payment header
 * 4. Server submits withdraw() on-chain
 * 5. On 2xx + TX hash confirmed, consume the spent note locally
 *
 * V3: C4 (note lock), H6 (TX verification), H7 (callback timing)
 */
export async function ghostFetch(
  client: ShieldedPoolClient,
  url: string | URL,
  options: GhostFetchOptions = {}
): Promise<Response> {
  const { maxPayment, allowedNetworks, dryRun, ...fetchOptions } = options;

  const response = await fetch(url, fetchOptions);

  if (response.status !== 402) return response;
  if (dryRun) return response;

  const responseForParsing = response.clone();

  const handler = new ZkPaymentHandler(client, {
    maxPayment,
    allowedNetworks,
  });

  let result: PaymentResult | null;
  try {
    result = await handler.handlePaymentRequired(responseForParsing);
  } catch (err) {
    // C4: Note lock is released inside generateWithdrawProof on error
    throw err;
  }

  if (!result) return response;

  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  const retryResponse = await fetch(url, {
    ...fetchOptions,
    headers: retryHeaders,
  });

  // H6 FIX: Only consume note if server confirms with TX hash
  if (retryResponse.ok && result._proofResult) {
    const txHash = retryResponse.headers.get("X-Payment-TxHash");
    if (txHash) {
      // Server confirmed on-chain withdrawal — safe to consume note
      client.consumeNote(
        result._proofResult.spentNoteCommitment,
        result._proofResult.changeNote
      );
    } else {
      // C4: Server said OK but no TX hash — unlock the note
      client.unlockNote(result.nullifierHash);
    }
  } else if (!retryResponse.ok && result._proofResult) {
    // C4: Payment failed — unlock the note
    client.unlockNote(result.nullifierHash);
  }

  return retryResponse;
}

export type PaymentCallback = (result: PaymentResult, success: boolean) => void;

/**
 * Like ghostFetch but calls a callback when a payment is made.
 * H7 FIX: Callback is called AFTER retry response, with success flag.
 */
export async function ghostFetchWithCallback(
  client: ShieldedPoolClient,
  url: string | URL,
  options: GhostFetchOptions = {},
  onPayment: PaymentCallback
): Promise<Response> {
  const { maxPayment, allowedNetworks, dryRun, ...fetchOptions } = options;

  const response = await fetch(url, fetchOptions);

  if (response.status !== 402 || dryRun) return response;

  const responseForParsing = response.clone();

  const handler = new ZkPaymentHandler(client, {
    maxPayment,
    allowedNetworks,
  });

  const result = await handler.handlePaymentRequired(responseForParsing);
  if (!result) return response;

  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  const retryResponse = await fetch(url, { ...fetchOptions, headers: retryHeaders });

  // H7 FIX: Callback AFTER retry, with success flag
  const txHash = retryResponse.headers.get("X-Payment-TxHash");
  const success = retryResponse.ok && !!txHash;

  if (success && result._proofResult) {
    client.consumeNote(
      result._proofResult.spentNoteCommitment,
      result._proofResult.changeNote
    );
  } else if (!success && result._proofResult) {
    client.unlockNote(result.nullifierHash);
  }

  onPayment(result, success);

  return retryResponse;
}
