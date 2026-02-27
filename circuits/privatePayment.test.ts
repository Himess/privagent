import { describe, it, expect, beforeAll } from "vitest";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import * as path from "path";
import * as fs from "fs";

// These tests require the circuit to be built first (circuits/scripts/build.sh)
// Skip if build artifacts don't exist

const BUILD_DIR = path.join(import.meta.dirname ?? __dirname, "build");
const WASM_PATH = path.join(BUILD_DIR, "privatePayment_js", "privatePayment.wasm");
const ZKEY_PATH = path.join(BUILD_DIR, "privatePayment_final.zkey");
const VKEY_PATH = path.join(BUILD_DIR, "verification_key.json");

const circuitBuilt = fs.existsSync(WASM_PATH) && fs.existsSync(ZKEY_PATH);

describe.skipIf(!circuitBuilt)("privatePayment circuit", () => {
  let poseidon: any;
  let F: any;

  function hash2(a: bigint, b: bigint): bigint {
    return F.toObject(poseidon([a, b]));
  }

  function buildMerkleTree(leaves: bigint[], depth: number) {
    const zeros: bigint[] = [0n];
    let z = 0n;
    for (let i = 1; i <= depth; i++) {
      z = hash2(z, z);
      zeros.push(z);
    }

    const numLeaves = 2 ** depth;
    const tree: bigint[][] = [];
    const level0: bigint[] = [];
    for (let i = 0; i < numLeaves; i++) {
      level0.push(i < leaves.length ? leaves[i] : zeros[0]);
    }
    tree.push(level0);

    for (let l = 1; l <= depth; l++) {
      const prev = tree[l - 1];
      const curr: bigint[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        curr.push(hash2(prev[i], prev[i + 1]));
      }
      tree.push(curr);
    }

    return { tree, zeros, root: tree[depth][0] };
  }

  function getProof(tree: bigint[][], leafIndex: number, depth: number) {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex;
    for (let l = 0; l < depth; l++) {
      const isLeft = idx % 2 === 0;
      const sibling = isLeft ? idx + 1 : idx - 1;
      pathElements.push(tree[l][sibling]);
      pathIndices.push(isLeft ? 0 : 1);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }

  beforeAll(async () => {
    poseidon = await buildPoseidon();
    F = poseidon.F;
  });

  it("should generate and verify a valid proof", async () => {
    const DEPTH = 20;

    const balance = 10000000n; // 10 USDC
    const randomness = 12345n;
    const nullifierSecret = 67890n;
    const newRandomness = 11111n;
    const amount = 5000000n; // 5 USDC
    const fee = 50000n; // 0.05 USDC
    const recipient = 0xdeadbeefn;
    const relayer = 0xcafebaben;

    const commitment = hash2(balance, randomness);
    const nullifierHash = hash2(nullifierSecret, commitment);
    const change = balance - amount - fee;
    const newCommitment = hash2(change, newRandomness);

    const { tree, root } = buildMerkleTree([commitment], DEPTH);
    const { pathElements, pathIndices } = getProof(tree, 0, DEPTH);

    const input = {
      balance: balance.toString(),
      randomness: randomness.toString(),
      nullifierSecret: nullifierSecret.toString(),
      newRandomness: newRandomness.toString(),
      pathElements: pathElements.map((e) => e.toString()),
      pathIndices: pathIndices.map((i) => i.toString()),
      root: root.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: recipient.toString(),
      amount: amount.toString(),
      relayer: relayer.toString(),
      fee: fee.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      WASM_PATH,
      ZKEY_PATH
    );

    // Verify
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);

    // Check public signals:
    // [0] newCommitment, [1] root, [2] nullifierHash, [3] recipient, [4] amount, [5] relayer, [6] fee
    expect(BigInt(publicSignals[0])).toBe(newCommitment);
    expect(BigInt(publicSignals[1])).toBe(root);
    expect(BigInt(publicSignals[2])).toBe(nullifierHash);
    expect(BigInt(publicSignals[3])).toBe(recipient);
    expect(BigInt(publicSignals[4])).toBe(amount);
    expect(BigInt(publicSignals[5])).toBe(relayer);
    expect(BigInt(publicSignals[6])).toBe(fee);
  });

  it("should generate proof for full spend (zero change)", async () => {
    const DEPTH = 20;

    const balance = 1000000n;
    const randomness = 99999n;
    const nullifierSecret = 88888n;
    const newRandomness = 77777n;
    const amount = 1000000n; // full balance
    const fee = 0n;
    const recipient = 0x1234n;
    const relayer = 0n;

    const commitment = hash2(balance, randomness);
    const nullifierHash = hash2(nullifierSecret, commitment);

    const { tree, root } = buildMerkleTree([commitment], DEPTH);
    const { pathElements, pathIndices } = getProof(tree, 0, DEPTH);

    const input = {
      balance: balance.toString(),
      randomness: randomness.toString(),
      nullifierSecret: nullifierSecret.toString(),
      newRandomness: newRandomness.toString(),
      pathElements: pathElements.map((e) => e.toString()),
      pathIndices: pathIndices.map((i) => i.toString()),
      root: root.toString(),
      nullifierHash: nullifierHash.toString(),
      recipient: recipient.toString(),
      amount: amount.toString(),
      relayer: relayer.toString(),
      fee: fee.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      WASM_PATH,
      ZKEY_PATH
    );

    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);

    // change = 0, newCommitment = hash(0, newRandomness)
    const expectedNewCommitment = hash2(0n, newRandomness);
    expect(BigInt(publicSignals[0])).toBe(expectedNewCommitment);
  });
});
