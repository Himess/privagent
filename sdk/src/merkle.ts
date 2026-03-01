import { hash2 } from "./poseidon.js";
import { MerkleProof, MERKLE_DEPTH } from "./types.js";

/**
 * Incremental Merkle tree that mirrors the on-chain contract.
 * Uses sparse computation — O(depth) per insert, O(N * depth) for proof.
 * Safe for depth 20 (1M capacity) unlike the naive 2^depth approach.
 */
export class MerkleTree {
  private leaves: bigint[];
  private zeroValues: bigint[];
  private depth: number;
  private filledSubtrees: bigint[];
  private currentRoot: bigint;
  private maxCapacity: number; // M10 FIX

  constructor(depth: number = MERKLE_DEPTH) {
    this.depth = depth;
    this.maxCapacity = 2 ** depth; // M10 FIX
    this.leaves = [];
    this.zeroValues = this.computeZeroValues();
    this.filledSubtrees = this.zeroValues.slice(0, depth);
    this.currentRoot = this.zeroValues[depth];
  }

  private computeZeroValues(): bigint[] {
    const zeros: bigint[] = [0n];
    let currentZero = 0n;

    for (let i = 1; i <= this.depth; i++) {
      currentZero = hash2(currentZero, currentZero);
      zeros.push(currentZero);
    }

    return zeros;
  }

  addLeaf(commitment: bigint): number {
    // M10 FIX: capacity check
    if (this.leaves.length >= this.maxCapacity) {
      throw new Error(
        `Merkle tree is full (max ${this.maxCapacity} leaves)`
      );
    }
    const index = this.leaves.length;
    this.leaves.push(commitment);
    this.updateRoot(commitment, index);
    return index;
  }

  private updateRoot(commitment: bigint, index: number): void {
    let currentHash = commitment;
    let currentIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = hash2(currentHash, this.zeroValues[i]);
      } else {
        currentHash = hash2(this.filledSubtrees[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.currentRoot = currentHash;
  }

  setLeaves(leaves: bigint[]): void {
    this.leaves = [];
    this.filledSubtrees = this.zeroValues.slice(0, this.depth);
    this.currentRoot = this.zeroValues[this.depth];

    for (const leaf of leaves) {
      this.addLeaf(leaf);
    }
  }

  getLeaves(): bigint[] {
    return [...this.leaves];
  }

  getLeafCount(): number {
    return this.leaves.length;
  }

  getRoot(): bigint {
    return this.currentRoot;
  }

  /**
   * [M6] Compute a node hash at (level, index) — iterative with explicit stack.
   * Bounded by O(depth) stack frames. Safe for depth 20+.
   */
  private getNode(level: number, index: number): bigint {
    if (level > this.depth || level < 0) {
      throw new Error(`Invalid level: ${level} (depth: ${this.depth})`);
    }

    // Explicit stack to avoid recursive calls
    type StackFrame = { level: number; index: number };
    const stack: StackFrame[] = [{ level, index }];
    const results: Map<string, bigint> = new Map();

    // Post-order traversal using iterative DFS
    const visited = new Set<string>();

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const key = `${frame.level}:${frame.index}`;

      // Sparse zero pruning
      const subtreeStart = frame.index * 2 ** frame.level;
      if (subtreeStart >= this.leaves.length) {
        results.set(key, this.zeroValues[frame.level]);
        stack.pop();
        continue;
      }

      // Leaf level
      if (frame.level === 0) {
        results.set(key, this.leaves[frame.index]);
        stack.pop();
        continue;
      }

      const leftKey = `${frame.level - 1}:${frame.index * 2}`;
      const rightKey = `${frame.level - 1}:${frame.index * 2 + 1}`;

      if (!visited.has(key)) {
        visited.add(key);
        stack.push({ level: frame.level - 1, index: frame.index * 2 + 1 });
        stack.push({ level: frame.level - 1, index: frame.index * 2 });
        continue;
      }

      const left = results.get(leftKey)!;
      const right = results.get(rightKey)!;
      results.set(key, hash2(left, right));
      stack.pop();
    }

    return results.get(`${level}:${index}`)!;
  }

  getProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Invalid leaf index: ${leafIndex}`);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      pathElements.push(this.getNode(level, siblingIndex));
      pathIndices.push(isLeft ? 0 : 1);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: this.currentRoot,
      leafIndex,
    };
  }

  verifyProof(leaf: bigint, proof: MerkleProof): boolean {
    let currentHash = leaf;

    for (let i = 0; i < this.depth; i++) {
      if (proof.pathIndices[i] === 0) {
        currentHash = hash2(currentHash, proof.pathElements[i]);
      } else {
        currentHash = hash2(proof.pathElements[i], currentHash);
      }
    }

    return currentHash === proof.root;
  }

  getZeroValues(): bigint[] {
    return [...this.zeroValues];
  }
}
