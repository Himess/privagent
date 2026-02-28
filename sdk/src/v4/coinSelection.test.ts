import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "../poseidon.js";
import { selectUTXOs, getAvailableBalance } from "./coinSelection.js";
import { UTXO, createUTXO, derivePublicKey } from "./utxo.js";

describe("V4 Coin Selection", () => {
  let pubkey: bigint;

  beforeAll(async () => {
    await initPoseidon();
    pubkey = derivePublicKey(42n);
  });

  function makeUTXO(amount: bigint, opts?: Partial<UTXO>): UTXO {
    const utxo = createUTXO(amount, pubkey);
    if (opts) Object.assign(utxo, opts);
    return utxo;
  }

  it("should find exact match", () => {
    const utxos = [makeUTXO(5n), makeUTXO(10n), makeUTXO(3n)];
    const result = selectUTXOs(utxos, 10n);

    expect(result).not.toBeNull();
    expect(result!.inputs).toHaveLength(1);
    expect(result!.inputs[0].amount).toBe(10n);
    expect(result!.change).toBe(0n);
  });

  it("should use smallest sufficient single UTXO", () => {
    const utxos = [makeUTXO(20n), makeUTXO(15n), makeUTXO(5n)];
    const result = selectUTXOs(utxos, 12n);

    expect(result).not.toBeNull();
    expect(result!.inputs).toHaveLength(1);
    expect(result!.inputs[0].amount).toBe(15n);
    expect(result!.change).toBe(3n);
  });

  it("should accumulate smallest-first when no single UTXO suffices", () => {
    // sorted: [3, 5, 6] → accumulate 3+5=8 ≥ 8 → success
    const utxos = [makeUTXO(3n), makeUTXO(6n), makeUTXO(5n)];
    const result = selectUTXOs(utxos, 8n, 2);

    expect(result).not.toBeNull();
    expect(result!.inputs).toHaveLength(2);
    expect(result!.change).toBe(0n); // 3 + 5 = 8
  });

  it("should return null when insufficient balance", () => {
    const utxos = [makeUTXO(3n), makeUTXO(4n)];
    const result = selectUTXOs(utxos, 20n);

    expect(result).toBeNull();
  });

  it("should return null when maxInputs exceeded", () => {
    const utxos = [makeUTXO(1n), makeUTXO(2n), makeUTXO(3n)];
    const result = selectUTXOs(utxos, 6n, 1); // need all 3 but max 1

    expect(result).toBeNull();
  });

  it("should skip pending UTXOs", () => {
    const utxos = [
      makeUTXO(10n, { pending: true }),
      makeUTXO(5n),
    ];
    const result = selectUTXOs(utxos, 10n);

    // Only 5 available, not enough for 10
    expect(result).toBeNull();
  });

  it("should skip spent UTXOs", () => {
    const utxos = [
      makeUTXO(10n, { spent: true }),
      makeUTXO(3n),
    ];
    const result = selectUTXOs(utxos, 3n);

    expect(result).not.toBeNull();
    expect(result!.inputs[0].amount).toBe(3n);
  });

  it("should accumulate two UTXOs for payment", () => {
    const utxos = [makeUTXO(6n), makeUTXO(7n)];
    const result = selectUTXOs(utxos, 12n, 2);

    expect(result).not.toBeNull();
    expect(result!.inputs).toHaveLength(2);
    expect(result!.change).toBe(1n);
  });

  it("should compute available balance correctly", () => {
    const utxos = [
      makeUTXO(10n),
      makeUTXO(5n, { spent: true }),
      makeUTXO(3n, { pending: true }),
      makeUTXO(7n),
    ];
    expect(getAvailableBalance(utxos)).toBe(17n); // 10 + 7
  });

  it("should handle empty UTXO list", () => {
    expect(selectUTXOs([], 1n)).toBeNull();
    expect(getAvailableBalance([])).toBe(0n);
  });
});
