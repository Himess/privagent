// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
import { ethers } from "ethers";
import { FIELD_SIZE } from "../types.js";

export interface ExtData {
  recipient: string; // address (0x0 for private transfer)
  relayer: string; // address
  fee: bigint;
  encryptedOutput1: Uint8Array;
  encryptedOutput2: Uint8Array;
}

/**
 * Compute extDataHash matching the on-chain ShieldedPoolV4._hashExtData
 *
 * hash = keccak256(abi.encode(recipient, relayer, fee, keccak256(enc1), keccak256(enc2)))
 * return uint256(hash) % FIELD_SIZE
 */
export function computeExtDataHash(extData: ExtData): bigint {
  const enc1Hash = ethers.keccak256(extData.encryptedOutput1);
  const enc2Hash = ethers.keccak256(extData.encryptedOutput2);

  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "bytes32", "bytes32"],
    [extData.recipient, extData.relayer, extData.fee, enc1Hash, enc2Hash]
  );

  const hash = ethers.keccak256(encoded);
  return BigInt(hash) % FIELD_SIZE;
}
