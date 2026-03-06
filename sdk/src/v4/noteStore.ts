// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

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
 * File-based NoteStore — persistent storage using AES-256-GCM encrypted JSON file.
 * [M2] O(1) nullifier lookup via secondary index (built on load).
 *
 * Encryption key is derived from the wallet's Poseidon private key via HKDF.
 * If no encryption key is provided, falls back to plaintext (legacy compat).
 */
export class FileNoteStore implements NoteStore {
  private notes: Map<string, StoredNote> = new Map();
  private nullifierIndex: Map<string, string> = new Map(); // [M2]
  private loaded: boolean = false;
  private encryptionKey: Buffer | null;

  /**
   * @param filePath — path to the note store file
   * @param encryptionSecret — optional secret (e.g. wallet private key as string) for AES-256-GCM at-rest encryption
   */
  constructor(private filePath: string, encryptionSecret?: string) {
    if (encryptionSecret) {
      // Derive 256-bit key via HKDF from the secret
      this.encryptionKey = Buffer.from(
        crypto.hkdfSync("sha256", Buffer.from(encryptionSecret), Buffer.alloc(0), Buffer.from("privagent-notestore"), 32)
      );
    } else {
      this.encryptionKey = null;
    }
  }

  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: base64(iv + tag + ciphertext) prefixed with "enc:"
    return "enc:" + Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  private decrypt(data: string): string {
    if (!data.startsWith("enc:")) return data; // plaintext fallback
    if (!this.encryptionKey) {
      throw new Error("Note store is encrypted but no encryption key provided");
    }
    const raw = Buffer.from(data.slice(4), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = this.decrypt(raw);
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
    const json = JSON.stringify(Array.from(this.notes.values()), null, 2);
    const data = this.encrypt(json);
    // [AUDIT-FIX] Atomic write: write to temp file then rename to prevent corruption
    const tmpPath = this.filePath + ".tmp";
    await fs.writeFile(tmpPath, data, "utf8");
    await fs.rename(tmpPath, this.filePath);
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
