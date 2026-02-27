import { ZkPaymentHandler } from "./zkExactScheme.js";
import { ShieldedPoolClient } from "../pool.js";
import type { GhostFetchOptions, PaymentResult } from "../types.js";

/**
 * Creates an x402-aware fetch function bound to a ShieldedPoolClient.
 *
 * Automatically handles 402 responses by creating ZK proofs and retrying.
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

  const result = await handler.handlePaymentRequired(responseForParsing);
  if (!result) return response;

  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  return fetch(url, {
    ...fetchOptions,
    headers: retryHeaders,
  });
}

export type PaymentCallback = (result: PaymentResult) => void;

/**
 * Like ghostFetch but calls a callback when a payment is made.
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

  onPayment(result);

  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  return fetch(url, { ...fetchOptions, headers: retryHeaders });
}
