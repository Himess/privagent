import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon, hash2 } from "./poseidon.js";
import { MerkleTree } from "./merkle.js";

describe("MerkleTree", () => {
  beforeAll(async () => {
    await initPoseidon();
  });

  // Use small depth for fast tests
  const DEPTH = 4;

  it("should initialize with empty root", () => {
    const tree = new MerkleTree(DEPTH);
    const root = tree.getRoot();
    expect(root).toBeTypeOf("bigint");
  });

  it("should add leaves and change root", () => {
    const tree = new MerkleTree(DEPTH);
    const root1 = tree.getRoot();
    tree.addLeaf(123n);
    const root2 = tree.getRoot();
    expect(root1).not.toBe(root2);
  });

  it("should return correct leaf count", () => {
    const tree = new MerkleTree(DEPTH);
    expect(tree.getLeafCount()).toBe(0);
    tree.addLeaf(1n);
    expect(tree.getLeafCount()).toBe(1);
    tree.addLeaf(2n);
    expect(tree.getLeafCount()).toBe(2);
  });

  it("should generate valid proof for first leaf", () => {
    const tree = new MerkleTree(DEPTH);
    const commitment = hash2(1000000n, 12345n);
    tree.addLeaf(commitment);

    const proof = tree.getProof(0);
    expect(proof.pathElements).toHaveLength(DEPTH);
    expect(proof.pathIndices).toHaveLength(DEPTH);
    expect(proof.root).toBe(tree.getRoot());
    expect(proof.leafIndex).toBe(0);
  });

  it("should verify valid proof", () => {
    const tree = new MerkleTree(DEPTH);
    const leaf = hash2(100n, 200n);
    tree.addLeaf(leaf);

    const proof = tree.getProof(0);
    expect(tree.verifyProof(leaf, proof)).toBe(true);
  });

  it("should reject invalid proof", () => {
    const tree = new MerkleTree(DEPTH);
    tree.addLeaf(hash2(1n, 2n));

    const proof = tree.getProof(0);
    // Try to verify with wrong leaf
    expect(tree.verifyProof(999n, proof)).toBe(false);
  });

  it("should handle multiple leaves", () => {
    const tree = new MerkleTree(DEPTH);
    const leaves = [hash2(1n, 1n), hash2(2n, 2n), hash2(3n, 3n)];
    leaves.forEach((l) => tree.addLeaf(l));

    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      expect(tree.verifyProof(leaves[i], proof)).toBe(true);
    }
  });

  it("should throw on invalid leaf index", () => {
    const tree = new MerkleTree(DEPTH);
    tree.addLeaf(1n);
    expect(() => tree.getProof(5)).toThrow("Invalid leaf index");
    expect(() => tree.getProof(-1)).toThrow("Invalid leaf index");
  });

  it("setLeaves should replace all leaves", () => {
    const tree = new MerkleTree(DEPTH);
    tree.addLeaf(1n);
    tree.addLeaf(2n);

    const rootBefore = tree.getRoot();
    tree.setLeaves([3n, 4n]);
    const rootAfter = tree.getRoot();

    expect(rootBefore).not.toBe(rootAfter);
    expect(tree.getLeafCount()).toBe(2);
  });
});
