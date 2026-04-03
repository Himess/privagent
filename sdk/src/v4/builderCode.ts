// Copyright (c) 2026 PrivAgent Contributors — MIT

/**
 * ERC-8021 Builder Code — Transaction Attribution for Base.
 *
 * Appends a data suffix to transaction calldata so Base can attribute
 * transactions to PrivAgent. The suffix is safely ignored by the EVM.
 *
 * Format: codesUTF8 + codesLength(1 byte) + schemaId(1 byte) + ercMarker(16 bytes)
 * See: https://eip.tools/eip/8021
 */

const ERC_8021_MARKER = "80218021802180218021802180218021"; // 16 bytes
const SCHEMA_ID = "00"; // schema 0

/**
 * Generate ERC-8021 data suffix for a builder code.
 * @param code — Builder code string (e.g. "privagent")
 * @returns hex string WITHOUT 0x prefix, ready to append to calldata
 */
export function buildERC8021Suffix(code: string): string {
  const codeHex = Buffer.from(code, "utf8").toString("hex");
  const lengthHex = code.length.toString(16).padStart(2, "0");
  return codeHex + lengthHex + SCHEMA_ID + ERC_8021_MARKER;
}

/** Default PrivAgent builder code suffix */
export const PRIVAGENT_BUILDER_SUFFIX = buildERC8021Suffix("bc_6n3sttkc");
