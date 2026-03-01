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
 * Notes are lost on restart.
 */
export class MemoryNoteStore implements NoteStore {
  private notes: Map<string, StoredNote> = new Map();

  async save(note: StoredNote): Promise<void> {
    this.notes.set(note.commitment, note);
  }

  async getUnspent(): Promise<StoredNote[]> {
    return Array.from(this.notes.values()).filter((n) => !n.spent);
  }

  async getAll(): Promise<StoredNote[]> {
    return Array.from(this.notes.values());
  }

  async markSpent(nullifier: string): Promise<void> {
    for (const note of this.notes.values()) {
      if (note.nullifier === nullifier) {
        note.spent = true;
        break;
      }
    }
  }

  async getByNullifier(nullifier: string): Promise<StoredNote | null> {
    for (const note of this.notes.values()) {
      if (note.nullifier === nullifier) return note;
    }
    return null;
  }

  async getByCommitment(commitment: string): Promise<StoredNote | null> {
    return this.notes.get(commitment) || null;
  }

  async clear(): Promise<void> {
    this.notes.clear();
  }
}

/**
 * File-based NoteStore — persistent storage using JSON file.
 * Survives server restarts. Zero dependencies.
 */
export class FileNoteStore implements NoteStore {
  private notes: Map<string, StoredNote> = new Map();
  private loaded: boolean = false;

  constructor(private filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      const parsed: StoredNote[] = JSON.parse(data);
      for (const note of parsed) {
        this.notes.set(note.commitment, note);
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
    for (const note of this.notes.values()) {
      if (note.nullifier === nullifier) {
        note.spent = true;
        break;
      }
    }
    await this.persist();
  }

  async getByNullifier(nullifier: string): Promise<StoredNote | null> {
    await this.load();
    for (const note of this.notes.values()) {
      if (note.nullifier === nullifier) return note;
    }
    return null;
  }

  async getByCommitment(commitment: string): Promise<StoredNote | null> {
    await this.load();
    return this.notes.get(commitment) || null;
  }

  async clear(): Promise<void> {
    this.notes.clear();
    await this.persist();
  }
}
