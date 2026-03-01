import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryNoteStore, FileNoteStore, StoredNote } from "./noteStore.js";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FILE = path.join(__dirname, "../../test-notes.json");

const mockNote: StoredNote = {
  commitment: "0x1234",
  nullifier: "0x5678",
  amount: "1000000",
  pubkey: "0xabcd",
  blinding: "0xef01",
  leafIndex: 0,
  spent: false,
  createdAt: Date.now(),
};

const mockNote2: StoredNote = {
  commitment: "0x9999",
  nullifier: "0x8888",
  amount: "2000000",
  pubkey: "0xabcd",
  blinding: "0x7777",
  leafIndex: 1,
  spent: false,
  createdAt: Date.now(),
};

describe("MemoryNoteStore", () => {
  let store: MemoryNoteStore;

  beforeEach(() => {
    store = new MemoryNoteStore();
  });

  it("should save and retrieve notes", async () => {
    await store.save(mockNote);
    const all = await store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].commitment).toBe("0x1234");
  });

  it("should get unspent notes only", async () => {
    await store.save(mockNote);
    await store.save({ ...mockNote2, spent: true });
    const unspent = await store.getUnspent();
    expect(unspent).toHaveLength(1);
  });

  it("should mark note as spent", async () => {
    await store.save(mockNote);
    await store.markSpent("0x5678");
    const unspent = await store.getUnspent();
    expect(unspent).toHaveLength(0);
  });

  it("should find note by nullifier", async () => {
    await store.save(mockNote);
    const found = await store.getByNullifier("0x5678");
    expect(found).not.toBeNull();
    expect(found!.amount).toBe("1000000");
  });

  it("should find note by commitment", async () => {
    await store.save(mockNote);
    const found = await store.getByCommitment("0x1234");
    expect(found).not.toBeNull();
  });

  it("should return null for non-existent note", async () => {
    const found = await store.getByNullifier("0xdead");
    expect(found).toBeNull();
  });

  it("should clear all notes", async () => {
    await store.save(mockNote);
    await store.save(mockNote2);
    await store.clear();
    const all = await store.getAll();
    expect(all).toHaveLength(0);
  });
});

describe("FileNoteStore", () => {
  let store: FileNoteStore;

  beforeEach(async () => {
    try {
      await fs.unlink(TEST_FILE);
    } catch {
      /* ignore */
    }
    store = new FileNoteStore(TEST_FILE);
  });

  afterEach(async () => {
    try {
      await fs.unlink(TEST_FILE);
    } catch {
      /* ignore */
    }
  });

  it("should persist notes to file", async () => {
    await store.save(mockNote);

    // Create new instance (simulates restart)
    const store2 = new FileNoteStore(TEST_FILE);
    const all = await store2.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].commitment).toBe("0x1234");
  });

  it("should survive restart", async () => {
    await store.save(mockNote);
    await store.save(mockNote2);

    // Simulate restart
    const store2 = new FileNoteStore(TEST_FILE);
    const all = await store2.getAll();
    expect(all).toHaveLength(2);
  });

  it("should persist spent status", async () => {
    await store.save(mockNote);
    await store.markSpent("0x5678");

    // Restart
    const store2 = new FileNoteStore(TEST_FILE);
    const unspent = await store2.getUnspent();
    expect(unspent).toHaveLength(0);
  });

  it("should handle missing file gracefully", async () => {
    const tmpDir = path.join(__dirname, "../../tmp-notestore-test");
    const tmpFile = path.join(tmpDir, "notes.json");
    const freshStore = new FileNoteStore(tmpFile);
    const all = await freshStore.getAll();
    expect(all).toHaveLength(0);
    // Cleanup
    try {
      await fs.unlink(tmpFile);
    } catch {
      /* ignore */
    }
    try {
      await fs.rmdir(tmpDir);
    } catch {
      /* ignore */
    }
  });
});
