import { ShieldedWallet } from "../v4/shieldedWallet.js";
import {
  ZkPaymentHandlerV4,
  type PaymentResultV4,
} from "./zkExactSchemeV2.js";
import type { GhostFetchOptionsV4 } from "../types.js";

/**
 * Creates an x402 V4-aware fetch function bound to a ShieldedWallet.
 *
 * Automatically handles 402 responses by creating JoinSplit ZK proofs and retrying.
 * After server confirms payment (2xx + X-Payment-TxHash), updates local UTXO state.
 */
export function createGhostFetchV4(
  wallet: ShieldedWallet,
  ecdhPrivateKey: Uint8Array,
  ecdhPublicKey: Uint8Array,
  defaultOptions?: Partial<GhostFetchOptionsV4>
): (url: string | URL, options?: GhostFetchOptionsV4) => Promise<Response> {
  return (url: string | URL, options?: GhostFetchOptionsV4) =>
    ghostFetchV4(wallet, ecdhPrivateKey, ecdhPublicKey, url, {
      ...defaultOptions,
      ...options,
    } as GhostFetchOptionsV4);
}

/**
 * Performs an HTTP request with automatic x402 V4 ZK payment handling.
 *
 * Flow:
 * 1. Fetch URL → get 402 with V4 payment requirements
 * 2. Coin selection + JoinSplit proof generation (amount HIDDEN, publicAmount=0)
 * 3. Encrypt output notes for the server
 * 4. Retry with proof in Payment header
 * 5. Server verifies note, submits transact() on-chain
 * 6. On 2xx + TX hash confirmed, update local UTXO state
 */
export async function ghostFetchV4(
  wallet: ShieldedWallet,
  ecdhPrivateKey: Uint8Array,
  ecdhPublicKey: Uint8Array,
  url: string | URL,
  options: GhostFetchOptionsV4 = {} as GhostFetchOptionsV4
): Promise<Response> {
  const { maxPayment, allowedNetworks, dryRun, ...fetchOptions } = options;

  const response = await fetch(url, fetchOptions);

  if (response.status !== 402) return response;
  if (dryRun) return response;

  const responseForParsing = response.clone();

  const handler = new ZkPaymentHandlerV4(wallet, ecdhPrivateKey, ecdhPublicKey, {
    maxPayment,
    allowedNetworks,
  });

  let result: PaymentResultV4 | null;
  try {
    result = await handler.handlePaymentRequired(responseForParsing);
  } catch (err) {
    // UTXOs are unlocked inside createPayment on error
    throw err;
  }

  if (!result) return response;

  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  const retryResponse = await fetch(url, {
    ...fetchOptions,
    headers: retryHeaders,
  });

  // Update local state based on server response
  if (retryResponse.ok && result._inputUTXOs && result._outputUTXOs) {
    const txHash = retryResponse.headers.get("X-Payment-TxHash");
    if (txHash) {
      // Server confirmed on-chain transaction — confirm payment
      wallet.confirmPayment(result._inputUTXOs, result._outputUTXOs);
    } else {
      // Server said OK but no TX hash — cancel (unlock UTXOs)
      wallet.cancelPayment(result._inputUTXOs);
    }
  } else if (!retryResponse.ok && result._inputUTXOs) {
    // Payment failed — cancel (unlock UTXOs)
    wallet.cancelPayment(result._inputUTXOs);
  }

  return retryResponse;
}

export type PaymentCallbackV4 = (result: PaymentResultV4, success: boolean) => void;

/**
 * Like ghostFetchV4 but calls a callback when a payment is made.
 */
export async function ghostFetchV4WithCallback(
  wallet: ShieldedWallet,
  ecdhPrivateKey: Uint8Array,
  ecdhPublicKey: Uint8Array,
  url: string | URL,
  options: GhostFetchOptionsV4 = {} as GhostFetchOptionsV4,
  onPayment: PaymentCallbackV4
): Promise<Response> {
  const { maxPayment, allowedNetworks, dryRun, ...fetchOptions } = options;

  const response = await fetch(url, fetchOptions);

  if (response.status !== 402 || dryRun) return response;

  const responseForParsing = response.clone();

  const handler = new ZkPaymentHandlerV4(wallet, ecdhPrivateKey, ecdhPublicKey, {
    maxPayment,
    allowedNetworks,
  });

  const result = await handler.handlePaymentRequired(responseForParsing);
  if (!result) return response;

  const retryHeaders = new Headers(fetchOptions.headers);
  retryHeaders.set("Payment", result.paymentHeader);

  const retryResponse = await fetch(url, {
    ...fetchOptions,
    headers: retryHeaders,
  });

  const txHash = retryResponse.headers.get("X-Payment-TxHash");
  const success = retryResponse.ok && !!txHash;

  if (success) {
    wallet.confirmPayment(result._inputUTXOs, result._outputUTXOs);
  } else {
    wallet.cancelPayment(result._inputUTXOs);
  }

  onPayment(result, success);

  return retryResponse;
}
