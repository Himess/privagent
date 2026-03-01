// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Decrypted note data structure for persistent storage.
 * All bigints stored as decimal strings, commitments/nullifiers as hex.
 */
export interface StoredNote {
  commitment: string; // hex
  nullifier: string; // hex
  amount: string; // bigint as decimal string
  pubkey: string; // bigint as decimal string
  blinding: string; // bigint as decimal string
  leafIndex: number;
  spent: boolean;
  createdAt: number; // timestamp
  txHash?: string; // transaction hash
}

/**
 * NoteStore interface — pluggable storage backend for UTXO notes.
 */
export interface NoteStore {
  /** Save a new note */
  save(note: StoredNote): Promise<void>;

  /** Get all unspent notes */
  getUnspent(): Promise<StoredNote[]>;

  /** Get all notes (spent + unspent) */
  getAll(): Promise<StoredNote[]>;

  /** Mark note as spent by nullifier */
  markSpent(nullifier: string): Promise<void>;

  /** Get note by nullifier */
  getByNullifier(nullifier: string): Promise<StoredNote | null>;

  /** Get note by commitment */
  getByCommitment(commitment: string): Promise<StoredNote | null>;

  /** Delete all notes (for testing/reset) */
  clear(): Promise<void>;
}

/**
 * In-memory NoteStore — default, no persistence.
 * [M2] O(1) nullifier lookup via secondary index.
 */
export class MemoryNoteStore implements NoteStore {
  private notes: Map<string, StoredNote> = new Map();
  private nullifierIndex: Map<string, string> = new Map(); // [M2] nullifier → commitment

  async save(note: StoredNote): Promise<void> {
    this.notes.set(note.commitment, note);
    this.nullifierIndex.set(note.nullifier, note.commitment);
  }

  async getUnspent(): Promise<StoredNote[]> {
    return Array.from(this.notes.values()).filter((n) => !n.spent);
  }

  async getAll(): Promise<StoredNote[]> {
    return Array.from(this.notes.values());
  }

  async markSpent(nullifier: string): Promise<void> {
    // [M2] O(1) lookup instead of O(n) scan
    const commitment = this.nullifierIndex.get(nullifier);
    if (commitment) {
      const note = this.notes.get(commitment);
      if (note) note.spent = true;
    }
  }

  async getByNullifier(nullifier: string): Promise<StoredNote | null> {
    // [M2] O(1) lookup
    const commitment = this.nullifierIndex.get(nullifier);
    if (!commitment) return null;
    return this.notes.get(commitment) || null;
  }

  async getByCommitment(commitment: string): Promise<StoredNote | null> {
    return this.notes.get(commitment) || null;
  }

  async clear(): Promise<void> {
    this.notes.clear();
    this.nullifierIndex.clear();
  }
}

/**
 * File-based NoteStore — persistent storage using JSON file.
 * [M2] O(1) nullifier lookup via secondary index (built on load).
 */
export class FileNoteStore implements NoteStore {
  private notes: Map<string, StoredNote> = new Map();
  private nullifierIndex: Map<string, string> = new Map(); // [M2]
  private loaded: boolean = false;

  constructor(private filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      const parsed: StoredNote[] = JSON.parse(data);
      for (const note of parsed) {
        this.notes.set(note.commitment, note);
        this.nullifierIndex.set(note.nullifier, note.commitment); // [M2]
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // File doesn't exist yet — start fresh
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.notes.values()), null, 2);
    await fs.writeFile(this.filePath, data, "utf8");
  }

  async save(note: StoredNote): Promise<void> {
    await this.load();
    this.notes.set(note.commitment, note);
    this.nullifierIndex.set(note.nullifier, note.commitment); // [M2]
    await this.persist();
  }

  async getUnspent(): Promise<StoredNote[]> {
    await this.load();
    return Array.from(this.notes.values()).filter((n) => !n.spent);
  }

  async getAll(): Promise<StoredNote[]> {
    await this.load();
    return Array.from(this.notes.values());
  }

  async markSpent(nullifier: string): Promise<void> {
    await this.load();
    // [M2] O(1) lookup
    const commitment = this.nullifierIndex.get(nullifier);
    if (commitment) {
      const note = this.notes.get(commitment);
      if (note) note.spent = true;
    }
    await this.persist();
  }

  async getByNullifier(nullifier: string): Promise<StoredNote | null> {
    await this.load();
    // [M2] O(1) lookup
    const commitment = this.nullifierIndex.get(nullifier);
    if (!commitment) return null;
    return this.notes.get(commitment) || null;
  }

  async getByCommitment(commitment: string): Promise<StoredNote | null> {
    await this.load();
    return this.notes.get(commitment) || null;
  }

  async clear(): Promise<void> {
    this.notes.clear();
    this.nullifierIndex.clear();
    await this.persist();
  }
}
