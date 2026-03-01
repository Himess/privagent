// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1

// V4 (JoinSplit UTXO model — hidden amounts)
export { ZkPaymentHandlerV4, decodePaymentHeaderV4 } from "./zkExactSchemeV2.js";
export { ghostFetchV4, createGhostFetchV4, ghostFetchV4WithCallback } from "./zkFetchV2.js";
export { ghostPaywallV4 } from "./middlewareV2.js";
export type { ZkPaymentHandlerV4Options, PaymentResultV4 } from "./zkExactSchemeV2.js";
export type { PaymentCallbackV4 } from "./zkFetchV2.js";
export type {
  ZkPaymentRequirementsV4,
  ZkExactPayloadV4,
  V4PaymentPayload,
  PaymentRequiredV4,
  GhostPaywallConfigV4,
  GhostFetchOptionsV4,
} from "../types.js";

// External relay
export { relayViaExternal, getRelayerInfo } from "./externalRelay.js";
export type { RelayRequest, RelayResponse, RelayerInfo } from "./externalRelay.js";

// Server reference implementations (relayer + facilitator)
export { createRelayerServer } from "./relayerServer.js";
export type {
  RelayerConfig,
  RelaySubmitRequest,
  RelaySubmitResponse,
} from "./relayerServer.js";
export { createFacilitatorServer } from "./facilitatorServer.js";
export type { FacilitatorConfig } from "./facilitatorServer.js";
