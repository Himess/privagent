import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon, computeCommitment, computeNullifierHash } from "./poseidon.js";
import {
  createNote,
  getNullifierHash,
  selectNoteForPayment,
  serializeNote,
  deserializeNote,
  randomFieldElement,
} from "./note.js";
import { FIELD_SIZE } from "./types.js";

describe("note", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  it("createNote should produce valid 3-input commitment (V3)", () => {
    const note = createNote(1_000_000n);
    expect(note.balance).toBe(1_000_000n);
    // V3: commitment = Poseidon(balance, nullifierSecret, randomness)
    expect(note.commitment).toBe(
      computeCommitment(note.balance, note.nullifierSecret, note.randomness)
    );
    expect(note.leafIndex).toBe(-1);
  });

  it("getNullifierHash should match computeNullifierHash", () => {
    const note = createNote(500_000n);
    expect(getNullifierHash(note)).toBe(
      computeNullifierHash(note.nullifierSecret, note.commitment)
    );
  });

  it("different nullifierSecret should produce different commitment (C6 fix)", () => {
    const note1 = createNote(1_000_000n);
    const note2 = createNote(1_000_000n);
    // Even with same balance, different secrets = different commitments
    expect(note1.commitment).not.toBe(note2.commitment);
  });

  it("selectNoteForPayment should find smallest sufficient note", () => {
    const notes = [
      createNote(10_000_000n),
      createNote(5_000_000n),
      createNote(1_000_000n),
    ];

    const selected = selectNoteForPayment(notes, 3_000_000n);
    expect(selected).not.toBeNull();
    expect(selected!.balance).toBe(5_000_000n);
  });

  it("selectNoteForPayment should include fee", () => {
    const notes = [createNote(5_000_000n), createNote(1_000_000n)];

    const selected = selectNoteForPayment(notes, 4_000_000n, 1_000_001n);
    expect(selected).toBeNull();
  });

  it("selectNoteForPayment returns null when no note is sufficient", () => {
    const notes = [createNote(1_000_000n)];
    expect(selectNoteForPayment(notes, 2_000_000n)).toBeNull();
  });

  it("selectNoteForPayment with empty array", () => {
    expect(selectNoteForPayment([], 1n)).toBeNull();
  });

  it("serialize/deserialize roundtrip", () => {
    const note = createNote(7_500_000n);
    note.leafIndex = 42;

    const serialized = serializeNote(note);
    const deserialized = deserializeNote(serialized as any);

    expect(deserialized.commitment).toBe(note.commitment);
    expect(deserialized.balance).toBe(note.balance);
    expect(deserialized.randomness).toBe(note.randomness);
    expect(deserialized.nullifierSecret).toBe(note.nullifierSecret);
    expect(deserialized.leafIndex).toBe(42);
  });

  it("randomFieldElement should be < FIELD_SIZE", () => {
    for (let i = 0; i < 10; i++) {
      const val = randomFieldElement();
      expect(val).toBeGreaterThan(0n);
      expect(val).toBeLessThan(FIELD_SIZE);
    }
  });
});
