// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
import { ethers } from "ethers";
import { initPoseidon } from "../poseidon.js";
import type {
  ZkPaymentRequirementsV4,
  ZkExactPayloadV4,
  V4PaymentPayload,
  PaymentRequiredV4,
  ResourceInfo,
} from "../types.js";
import { ShieldedWallet } from "../v4/shieldedWallet.js";
import type { UTXO } from "../v4/utxo.js";
import { createUTXO } from "../v4/utxo.js";
import { selectUTXOs } from "../v4/coinSelection.js";
import { computeExtDataHash } from "../v4/extData.js";
import type { ExtData } from "../v4/extData.js";
import { encryptNote } from "../v4/noteEncryption.js";
import { generateJoinSplitProof, proofToArray } from "../v4/joinSplitProver.js";

// ============================================================================
// Types
// ============================================================================

export interface ZkPaymentHandlerV4Options {
  maxPayment?: bigint;
  allowedNetworks?: string[];
}

export interface PaymentResultV4 {
  paymentHeader: string;
  /** Internal — for confirming/canceling payment after server response */
  _inputUTXOs: UTXO[];
  _outputUTXOs: UTXO[];
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handles x402 V4 payment flows using JoinSplit ZK proofs.
 *
 * V4: Amount is HIDDEN. Uses UTXO JoinSplit model.
 * Buyer generates a proof that creates a UTXO payable to the server's Poseidon pubkey.
 * Server decrypts the encrypted note to verify the amount off-chain.
 */
export class ZkPaymentHandlerV4 {
  private wallet: ShieldedWallet;
  private ecdhPrivateKey: Uint8Array;
  private ecdhPublicKey: Uint8Array;
  private options: ZkPaymentHandlerV4Options;

  constructor(
    wallet: ShieldedWallet,
    ecdhPrivateKey: Uint8Array,
    ecdhPublicKey: Uint8Array,
    options: ZkPaymentHandlerV4Options = {}
  ) {
    this.wallet = wallet;
    this.ecdhPrivateKey = ecdhPrivateKey;
    this.ecdhPublicKey = ecdhPublicKey;
    this.options = options;
  }

  async parsePaymentRequired(
    response: Response
  ): Promise<PaymentRequiredV4 | null> {
    if (response.status !== 402) return null;
    try {
      const body = await response.json();
      if (!body || body.x402Version !== 4 || !Array.isArray(body.accepts)) {
        return null;
      }
      return body as PaymentRequiredV4;
    } catch {
      return null;
    }
  }

  selectRequirement(
    requirements: ZkPaymentRequirementsV4[]
  ): ZkPaymentRequirementsV4 | null {
    for (const req of requirements) {
      if (req.scheme !== "zk-exact-v2") continue;
      if (
        this.options.allowedNetworks?.length &&
        !this.options.allowedNetworks.includes(req.network)
      ) {
        continue;
      }
      if (this.options.maxPayment && this.options.maxPayment > 0n) {
        const price = BigInt(req.price);
        if (price > this.options.maxPayment) continue;
      }
      return req;
    }
    return null;
  }

  async createPayment(
    requirements: ZkPaymentRequirementsV4,
    resource?: ResourceInfo
  ): Promise<PaymentResultV4> {
    await initPoseidon();

    const amount = BigInt(requirements.price);
    const serverPubkey = BigInt(requirements.payToPubkey);
    const serverEcdhPubKey = hexToBytes(requirements.serverEcdhPubKey);
    const relayer = requirements.relayer ?? ethers.ZeroAddress;
    const fee = BigInt(requirements.relayerFee ?? "0");
    const totalNeeded = amount + fee;

    // Coin selection
    const available = this.wallet.getUTXOs();
    const selection = selectUTXOs(available, totalNeeded, 2);
    if (!selection) {
      throw new Error(
        `Insufficient balance. Need ${totalNeeded}, have ${this.wallet.getBalance()}`
      );
    }

    // Lock selected UTXOs
    for (const utxo of selection.inputs) {
      this.wallet.lockUTXO(utxo);
    }

    try {
      // Create output UTXOs
      const paymentUTXO = createUTXO(amount, serverPubkey);
      const changeUTXO = createUTXO(selection.change, this.wallet.publicKey);

      // Encrypt notes for the server
      const enc1 = encryptNote(paymentUTXO, this.ecdhPrivateKey, serverEcdhPubKey);
      const enc2 = encryptNote(changeUTXO, this.ecdhPrivateKey, serverEcdhPubKey);

      // Build extData with real encrypted outputs
      const extData: ExtData = {
        recipient: ethers.ZeroAddress, // private transfer
        relayer,
        fee,
        encryptedOutput1: enc1,
        encryptedOutput2: enc2,
      };
      const extDataHash = computeExtDataHash(extData);

      // Generate JoinSplit proof (publicAmount=0 for private transfer)
      const proofResult = await generateJoinSplitProof(
        {
          inputs: selection.inputs,
          outputs: [paymentUTXO, changeUTXO],
          publicAmount: 0n,
          tree: this.wallet.getTree(),
          extDataHash,
          privateKey: this.wallet.privateKey,
        },
        this.wallet.circuitDir
      );

      // Extract public signals
      const ps = proofResult.proofData.publicSignals;
      const nIns = proofResult.nIns;
      const nOuts = proofResult.nOuts;
      const nullifiers = ps.slice(3, 3 + nIns).map((n) => n.toString());
      const commitments = ps
        .slice(3 + nIns, 3 + nIns + nOuts)
        .map((c) => c.toString());

      // Flatten proof to [pA0,pA1, pB00,pB01,pB10,pB11, pC0,pC1]
      const proofArray = proofToArray(proofResult.proofData).map((p) =>
        p.toString()
      );

      const zkPayload: ZkExactPayloadV4 = {
        from: "shielded-v4",
        proof: proofArray,
        nullifiers,
        commitments,
        root: ps[0].toString(),
        publicAmount: "0",
        extDataHash: extDataHash.toString(),
        extData: {
          recipient: ethers.ZeroAddress,
          relayer,
          fee: fee.toString(),
          encryptedOutput1: bytesToHex(enc1),
          encryptedOutput2: bytesToHex(enc2),
        },
        nIns,
        nOuts,
        senderEcdhPubKey: bytesToHex(this.ecdhPublicKey),
      };

      const v4Payload: V4PaymentPayload = {
        x402Version: 4,
        accepted: requirements,
        payload: zkPayload,
      };
      if (resource) {
        v4Payload.resource = resource;
      }

      const paymentHeader = encodePaymentHeader(v4Payload);

      return {
        paymentHeader,
        _inputUTXOs: selection.inputs,
        _outputUTXOs: [paymentUTXO, changeUTXO],
      };
    } catch (err) {
      // Unlock on failure
      for (const utxo of selection.inputs) {
        this.wallet.unlockUTXO(utxo);
      }
      throw err;
    }
  }

  async handlePaymentRequired(
    response: Response
  ): Promise<PaymentResultV4 | null> {
    const paymentRequired = await this.parsePaymentRequired(response);
    if (!paymentRequired) return null;

    const requirement = this.selectRequirement(paymentRequired.accepts);
    if (!requirement) return null;

    return this.createPayment(requirement, paymentRequired.resource);
  }
}

// ============================================================================
// Encoding
// ============================================================================

function encodePaymentHeader(payload: V4PaymentPayload): string {
  const json = JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? value.toString() : (value as unknown)
  );
  return Buffer.from(json).toString("base64");
}

export function decodePaymentHeaderV4(header: string): V4PaymentPayload {
  const json = Buffer.from(header, "base64").toString("utf-8");
  return JSON.parse(json) as V4PaymentPayload;
}

// ============================================================================
// Helpers
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(h, "hex"));
}

function bytesToHex(arr: Uint8Array): string {
  return "0x" + Buffer.from(arr).toString("hex");
}
