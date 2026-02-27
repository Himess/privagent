import { hash2 } from "./poseidon.js";
import { MerkleProof, MERKLE_DEPTH } from "./types.js";

export class MerkleTree {
  private leaves: bigint[];
  private zeroValues: bigint[];
  private depth: number;

  constructor(depth: number = MERKLE_DEPTH) {
    this.depth = depth;
    this.leaves = [];
    this.zeroValues = this.computeZeroValues();
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
    const index = this.leaves.length;
    this.leaves.push(commitment);
    return index;
  }

  setLeaves(leaves: bigint[]): void {
    this.leaves = [...leaves];
  }

  getLeaves(): bigint[] {
    return [...this.leaves];
  }

  getLeafCount(): number {
    return this.leaves.length;
  }

  getRoot(): bigint {
    if (this.leaves.length === 0) {
      return this.zeroValues[this.depth];
    }

    const numLeaves = 2 ** this.depth;
    let currentLevel: bigint[] = [];

    for (let i = 0; i < numLeaves; i++) {
      currentLevel.push(i < this.leaves.length ? this.leaves[i] : this.zeroValues[0]);
    }

    for (let level = 0; level < this.depth; level++) {
      const nextLevel: bigint[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(hash2(currentLevel[i], currentLevel[i + 1]));
      }
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  getProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Invalid leaf index: ${leafIndex}`);
    }

    const numLeaves = 2 ** this.depth;
    const tree: bigint[][] = [];

    const level0: bigint[] = [];
    for (let i = 0; i < numLeaves; i++) {
      level0.push(i < this.leaves.length ? this.leaves[i] : this.zeroValues[0]);
    }
    tree.push(level0);

    for (let level = 1; level <= this.depth; level++) {
      const prevLevel = tree[level - 1];
      const currentLevel: bigint[] = [];
      for (let i = 0; i < prevLevel.length; i += 2) {
        currentLevel.push(hash2(prevLevel[i], prevLevel[i + 1]));
      }
      tree.push(currentLevel);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      pathElements.push(tree[level][siblingIndex]);
      pathIndices.push(isLeft ? 0 : 1);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: tree[this.depth][0],
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
