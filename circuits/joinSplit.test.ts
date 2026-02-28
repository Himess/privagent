import { describe, it, expect, beforeAll } from "vitest";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import * as path from "path";
import * as fs from "fs";

// V4 JoinSplit circuit tests
// Requires: circuits/scripts/build-v4.sh (or manual compile)

const BUILD_DIR = path.join(import.meta.dirname ?? __dirname, "build", "v4");
const DEPTH = 16;
const TEST_TIMEOUT = 60_000; // 60s per test (proof gen is slow)

// 1x2 circuit artifacts
const WASM_1x2 = path.join(BUILD_DIR, "1x2", "joinSplit_1x2_js", "joinSplit_1x2.wasm");
const ZKEY_1x2 = path.join(BUILD_DIR, "1x2", "joinSplit_1x2_final.zkey");
const VKEY_1x2 = path.join(BUILD_DIR, "1x2", "verification_key.json");

// 2x2 circuit artifacts
const WASM_2x2 = path.join(BUILD_DIR, "2x2", "joinSplit_2x2_js", "joinSplit_2x2.wasm");
const ZKEY_2x2 = path.join(BUILD_DIR, "2x2", "joinSplit_2x2_final.zkey");
const VKEY_2x2 = path.join(BUILD_DIR, "2x2", "verification_key.json");

const circuit1x2Built = fs.existsSync(WASM_1x2) && fs.existsSync(ZKEY_1x2);
const circuit2x2Built = fs.existsSync(WASM_2x2) && fs.existsSync(ZKEY_2x2);

describe.skipIf(!circuit1x2Built)("JoinSplit 1x2 circuit", () => {
  let poseidon: any;
  let F: any;

  function hash1(a: bigint): bigint {
    return F.toObject(poseidon([a]));
  }
  function hash2(a: bigint, b: bigint): bigint {
    return F.toObject(poseidon([a, b]));
  }
  function hash3(a: bigint, b: bigint, c: bigint): bigint {
    return F.toObject(poseidon([a, b, c]));
  }

  // Sparse Merkle tree — only compute paths needed, not all 2^16 leaves
  function buildSparseMerkleTree(leaves: Map<number, bigint>) {
    // Precompute zero hashes at each level
    const zeros: bigint[] = [0n];
    let z = 0n;
    for (let i = 1; i <= DEPTH; i++) {
      z = hash2(z, z);
      zeros.push(z);
    }

    // Build sparse tree level by level
    const levels: Map<number, bigint>[] = [new Map(leaves)];
    for (let l = 0; l < DEPTH; l++) {
      const prev = levels[l];
      const curr = new Map<number, bigint>();
      // Find all parent indices we need
      const parentIndices = new Set<number>();
      for (const idx of prev.keys()) {
        parentIndices.add(Math.floor(idx / 2));
      }
      for (const pi of parentIndices) {
        const left = prev.get(pi * 2) ?? zeros[l];
        const right = prev.get(pi * 2 + 1) ?? zeros[l];
        curr.set(pi, hash2(left, right));
      }
      levels.push(curr);
    }

    const root = levels[DEPTH].get(0) ?? zeros[DEPTH];
    return { levels, zeros, root };
  }

  function getSparseMerkleProof(levels: Map<number, bigint>[], zeros: bigint[], leafIndex: number) {
    const pathElements: bigint[] = [];
    let idx = leafIndex;
    for (let l = 0; l < DEPTH; l++) {
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      pathElements.push(levels[l].get(sibling) ?? zeros[l]);
      idx = Math.floor(idx / 2);
    }
    return pathElements;
  }

  // Create a UTXO commitment: Poseidon(amount, pubkey, blinding)
  function createUTXO(amount: bigint, privateKey: bigint, blinding: bigint) {
    const pubkey = hash1(privateKey);
    const commitment = hash3(amount, pubkey, blinding);
    return { amount, privateKey, pubkey, blinding, commitment };
  }

  // Compute nullifier: Poseidon(commitment, pathIndex, privateKey)
  function computeNullifier(commitment: bigint, pathIndex: number, privateKey: bigint) {
    return hash3(commitment, BigInt(pathIndex), privateKey);
  }

  // Compute extDataHash: keccak256(...) % BN254 field (simplified as Poseidon for tests)
  function computeExtDataHash(recipient: bigint, relayer: bigint, fee: bigint): bigint {
    return hash3(recipient, relayer, fee);
  }

  beforeAll(async () => {
    poseidon = await buildPoseidon();
    F = poseidon.F;
  });

  it("valid private transfer: 1 input → 2 outputs (payment + change)", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const inputUTXO = createUTXO(10_000_000n, privateKey, 111n); // 10 USDC
    const paymentUTXO = createUTXO(3_000_000n, 99999n, 222n);    // 3 USDC to seller
    const changeUTXO = createUTXO(7_000_000n, privateKey, 333n);  // 7 USDC change

    const { levels, zeros, root } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(inputUTXO.commitment, 0, privateKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [paymentUTXO.commitment.toString(), changeUTXO.commitment.toString()],
      // Private
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [paymentUTXO.amount.toString(), changeUTXO.amount.toString()],
      outPubkey: [paymentUTXO.pubkey.toString(), changeUTXO.pubkey.toString()],
      outBlinding: [paymentUTXO.blinding.toString(), changeUTXO.blinding.toString()],
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2);
    const vkey = JSON.parse(fs.readFileSync(VKEY_1x2, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);

    // Check public signals: [root, publicAmount, extDataHash, nullifier, commitment1, commitment2]
    expect(BigInt(publicSignals[0])).toBe(root);
    expect(BigInt(publicSignals[1])).toBe(0n); // publicAmount = 0
    expect(BigInt(publicSignals[2])).toBe(extDataHash);
    expect(BigInt(publicSignals[3])).toBe(nullifier);
    expect(BigInt(publicSignals[4])).toBe(paymentUTXO.commitment);
    expect(BigInt(publicSignals[5])).toBe(changeUTXO.commitment);
  });

  it("valid deposit: publicAmount > 0, dummy input", { timeout: TEST_TIMEOUT }, async () => {
    const depositAmount = 10_000_000n; // 10 USDC
    const recipientKey = 55555n;
    const outputUTXO = createUTXO(depositAmount, recipientKey, 444n);

    // Dummy input (amount=0, any values for path)
    const dummyKey = 1n;
    const dummyUTXO = createUTXO(0n, dummyKey, 0n);

    // Build tree with zero leaf (dummy doesn't need real inclusion)
    const { levels, zeros, root } = buildSparseMerkleTree(new Map());
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(dummyUTXO.commitment, 0, dummyKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);

    // Deposit: 0 (input) + 10 (public) = 10 (output)
    // Second output is zero (dummy)
    const zeroOutput = createUTXO(0n, 1n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: depositAmount.toString(),
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [outputUTXO.commitment.toString(), zeroOutput.commitment.toString()],
      inAmount: ["0"],
      inPrivateKey: [dummyKey.toString()],
      inBlinding: ["0"],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [depositAmount.toString(), "0"],
      outPubkey: [outputUTXO.pubkey.toString(), zeroOutput.pubkey.toString()],
      outBlinding: [outputUTXO.blinding.toString(), "0"],
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2);
    const vkey = JSON.parse(fs.readFileSync(VKEY_1x2, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);

    expect(BigInt(publicSignals[1])).toBe(depositAmount); // publicAmount = 10 USDC
  });

  it("valid withdraw: publicAmount < 0", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 77777n;
    const inputUTXO = createUTXO(5_000_000n, privateKey, 555n); // 5 USDC
    const withdrawAmount = 5_000_000n;

    const { levels, zeros, root } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(inputUTXO.commitment, 0, privateKey);
    const extDataHash = computeExtDataHash(0xdeadbeefn, 0n, 0n);

    // Withdraw: 5 (input) + (-5) (public) = 0 (output)
    // Both outputs are zero (full spend)
    const zeroOut1 = createUTXO(0n, 1n, 0n);
    const zeroOut2 = createUTXO(0n, 1n, 1n);

    // publicAmount is negative for withdraw
    // In the field, -5000000 = FIELD_SIZE - 5000000
    const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const negPublicAmount = FIELD_SIZE - withdrawAmount;

    const input = {
      root: root.toString(),
      publicAmount: negPublicAmount.toString(),
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [zeroOut1.commitment.toString(), zeroOut2.commitment.toString()],
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: ["0", "0"],
      outPubkey: [zeroOut1.pubkey.toString(), zeroOut2.pubkey.toString()],
      outBlinding: [zeroOut1.blinding.toString(), zeroOut2.blinding.toString()],
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2);
    const vkey = JSON.parse(fs.readFileSync(VKEY_1x2, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);
  });

  it("fails with balance mismatch (sum(in) + publicAmount !== sum(out))", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const inputUTXO = createUTXO(10_000_000n, privateKey, 111n);
    // Try to create more output than input (fraud)
    const fraudOutput = createUTXO(15_000_000n, 99999n, 222n); // 15 USDC from 10 input!
    const changeUTXO = createUTXO(0n, privateKey, 333n);

    const { levels, zeros, root } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(inputUTXO.commitment, 0, privateKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [fraudOutput.commitment.toString(), changeUTXO.commitment.toString()],
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [fraudOutput.amount.toString(), changeUTXO.amount.toString()],
      outPubkey: [fraudOutput.pubkey.toString(), changeUTXO.pubkey.toString()],
      outBlinding: [fraudOutput.blinding.toString(), changeUTXO.blinding.toString()],
    };

    await expect(
      snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2)
    ).rejects.toThrow();
  });

  it("fails with wrong nullifier (wrong privateKey)", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const wrongKey = 99999n;
    const inputUTXO = createUTXO(10_000_000n, privateKey, 111n);
    const paymentUTXO = createUTXO(5_000_000n, 88888n, 222n);
    const changeUTXO = createUTXO(5_000_000n, privateKey, 333n);

    const { levels, zeros, root } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    // Compute nullifier with WRONG key
    const wrongNullifier = computeNullifier(inputUTXO.commitment, 0, wrongKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [wrongNullifier.toString()],
      outputCommitments: [paymentUTXO.commitment.toString(), changeUTXO.commitment.toString()],
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [paymentUTXO.amount.toString(), changeUTXO.amount.toString()],
      outPubkey: [paymentUTXO.pubkey.toString(), changeUTXO.pubkey.toString()],
      outBlinding: [paymentUTXO.blinding.toString(), changeUTXO.blinding.toString()],
    };

    await expect(
      snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2)
    ).rejects.toThrow();
  });

  it("fails with wrong Merkle root", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const inputUTXO = createUTXO(10_000_000n, privateKey, 111n);
    const paymentUTXO = createUTXO(5_000_000n, 88888n, 222n);
    const changeUTXO = createUTXO(5_000_000n, privateKey, 333n);

    const { levels, zeros } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(inputUTXO.commitment, 0, privateKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);
    const fakeRoot = 999999999n; // Wrong root

    const input = {
      root: fakeRoot.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [paymentUTXO.commitment.toString(), changeUTXO.commitment.toString()],
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [paymentUTXO.amount.toString(), changeUTXO.amount.toString()],
      outPubkey: [paymentUTXO.pubkey.toString(), changeUTXO.pubkey.toString()],
      outBlinding: [paymentUTXO.blinding.toString(), changeUTXO.blinding.toString()],
    };

    await expect(
      snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2)
    ).rejects.toThrow();
  });

  it("dummy input (amount=0) with any path is valid", { timeout: TEST_TIMEOUT }, async () => {
    const dummyKey = 1n;
    const dummyUTXO = createUTXO(0n, dummyKey, 0n);
    const outputUTXO = createUTXO(5_000_000n, 88888n, 222n);
    const zeroOut = createUTXO(0n, 1n, 1n);

    // Build an empty tree
    const { levels, zeros, root } = buildSparseMerkleTree(new Map());
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(dummyUTXO.commitment, 0, dummyKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "5000000", // deposit
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [outputUTXO.commitment.toString(), zeroOut.commitment.toString()],
      inAmount: ["0"],
      inPrivateKey: [dummyKey.toString()],
      inBlinding: ["0"],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [outputUTXO.amount.toString(), "0"],
      outPubkey: [outputUTXO.pubkey.toString(), zeroOut.pubkey.toString()],
      outBlinding: [outputUTXO.blinding.toString(), zeroOut.blinding.toString()],
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2);
    const vkey = JSON.parse(fs.readFileSync(VKEY_1x2, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);
  });

  it("extDataHash binding: different extDataHash = different proof", { timeout: TEST_TIMEOUT * 2 }, async () => {
    const privateKey = 12345n;
    const inputUTXO = createUTXO(10_000_000n, privateKey, 111n);
    const paymentUTXO = createUTXO(5_000_000n, 99999n, 222n);
    const changeUTXO = createUTXO(5_000_000n, privateKey, 333n);

    const { levels, zeros, root } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(inputUTXO.commitment, 0, privateKey);
    const extData1 = computeExtDataHash(0xdeadbeefn, 0n, 0n);
    const extData2 = computeExtDataHash(0xcafebaben, 0n, 0n);

    const makeInput = (edh: bigint) => ({
      root: root.toString(),
      publicAmount: "0",
      extDataHash: edh.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [paymentUTXO.commitment.toString(), changeUTXO.commitment.toString()],
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [paymentUTXO.amount.toString(), changeUTXO.amount.toString()],
      outPubkey: [paymentUTXO.pubkey.toString(), changeUTXO.pubkey.toString()],
      outBlinding: [paymentUTXO.blinding.toString(), changeUTXO.blinding.toString()],
    });

    const result1 = await snarkjs.groth16.fullProve(makeInput(extData1), WASM_1x2, ZKEY_1x2);
    const result2 = await snarkjs.groth16.fullProve(makeInput(extData2), WASM_1x2, ZKEY_1x2);

    // Both should be valid with their own extDataHash
    const vkey = JSON.parse(fs.readFileSync(VKEY_1x2, "utf8"));
    expect(await snarkjs.groth16.verify(vkey, result1.publicSignals, result1.proof)).toBe(true);
    expect(await snarkjs.groth16.verify(vkey, result2.publicSignals, result2.proof)).toBe(true);

    // But extDataHash in public signals should differ
    expect(result1.publicSignals[2]).not.toBe(result2.publicSignals[2]);
  });

  it("wrong output commitment = proof fails verification", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const inputUTXO = createUTXO(10_000_000n, privateKey, 111n);
    const paymentUTXO = createUTXO(5_000_000n, 99999n, 222n);
    const changeUTXO = createUTXO(5_000_000n, privateKey, 333n);
    const fakeCommitment = hash3(999n, 888n, 777n); // wrong commitment

    const { levels, zeros, root } = buildSparseMerkleTree(new Map([[0, inputUTXO.commitment]]));
    const pathElements = getSparseMerkleProof(levels, zeros, 0);
    const nullifier = computeNullifier(inputUTXO.commitment, 0, privateKey);
    const extDataHash = computeExtDataHash(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [nullifier.toString()],
      outputCommitments: [fakeCommitment.toString(), changeUTXO.commitment.toString()],
      inAmount: [inputUTXO.amount.toString()],
      inPrivateKey: [privateKey.toString()],
      inBlinding: [inputUTXO.blinding.toString()],
      inPathIndices: ["0"],
      inPathElements: [pathElements.map(e => e.toString())],
      outAmount: [paymentUTXO.amount.toString(), changeUTXO.amount.toString()],
      outPubkey: [paymentUTXO.pubkey.toString(), changeUTXO.pubkey.toString()],
      outBlinding: [paymentUTXO.blinding.toString(), changeUTXO.blinding.toString()],
    };

    await expect(
      snarkjs.groth16.fullProve(input, WASM_1x2, ZKEY_1x2)
    ).rejects.toThrow();
  });
});

describe.skipIf(!circuit2x2Built)("JoinSplit 2x2 circuit", () => {
  let poseidon: any;
  let F: any;

  function hash1(a: bigint): bigint {
    return F.toObject(poseidon([a]));
  }
  function hash2(a: bigint, b: bigint): bigint {
    return F.toObject(poseidon([a, b]));
  }
  function hash3(a: bigint, b: bigint, c: bigint): bigint {
    return F.toObject(poseidon([a, b, c]));
  }

  function buildSparseMerkleTree2(leaves: Map<number, bigint>) {
    const zeros: bigint[] = [0n];
    let z = 0n;
    for (let i = 1; i <= DEPTH; i++) {
      z = hash2(z, z);
      zeros.push(z);
    }
    const levels: Map<number, bigint>[] = [new Map(leaves)];
    for (let l = 0; l < DEPTH; l++) {
      const prev = levels[l];
      const curr = new Map<number, bigint>();
      const parentIndices = new Set<number>();
      for (const idx of prev.keys()) parentIndices.add(Math.floor(idx / 2));
      for (const pi of parentIndices) {
        const left = prev.get(pi * 2) ?? zeros[l];
        const right = prev.get(pi * 2 + 1) ?? zeros[l];
        curr.set(pi, hash2(left, right));
      }
      levels.push(curr);
    }
    const root = levels[DEPTH].get(0) ?? zeros[DEPTH];
    return { levels, zeros, root };
  }

  function getSparseMerkleProof2(levels: Map<number, bigint>[], zeros: bigint[], leafIndex: number) {
    const pathElements: bigint[] = [];
    let idx = leafIndex;
    for (let l = 0; l < DEPTH; l++) {
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      pathElements.push(levels[l].get(sibling) ?? zeros[l]);
      idx = Math.floor(idx / 2);
    }
    return pathElements;
  }

  function createUTXO(amount: bigint, privateKey: bigint, blinding: bigint) {
    const pubkey = hash1(privateKey);
    const commitment = hash3(amount, pubkey, blinding);
    return { amount, privateKey, pubkey, blinding, commitment };
  }

  function computeNullifier(commitment: bigint, pathIndex: number, privateKey: bigint) {
    return hash3(commitment, BigInt(pathIndex), privateKey);
  }

  beforeAll(async () => {
    poseidon = await buildPoseidon();
    F = poseidon.F;
  });

  it("valid 2x2 consolidation: 2 inputs → 2 outputs", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const utxo1 = createUTXO(3_000_000n, privateKey, 111n); // 3 USDC
    const utxo2 = createUTXO(7_000_000n, privateKey, 222n); // 7 USDC

    const paymentOut = createUTXO(4_000_000n, 99999n, 333n);  // 4 USDC to seller
    const changeOut = createUTXO(6_000_000n, privateKey, 444n); // 6 USDC change

    const { levels, zeros, root } = buildSparseMerkleTree2(new Map([[0, utxo1.commitment], [1, utxo2.commitment]]));
    const path1 = getSparseMerkleProof2(levels, zeros, 0);
    const path2 = getSparseMerkleProof2(levels, zeros, 1);
    const null1 = computeNullifier(utxo1.commitment, 0, privateKey);
    const null2 = computeNullifier(utxo2.commitment, 1, privateKey);
    const extDataHash = hash3(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [null1.toString(), null2.toString()],
      outputCommitments: [paymentOut.commitment.toString(), changeOut.commitment.toString()],
      inAmount: [utxo1.amount.toString(), utxo2.amount.toString()],
      inPrivateKey: [privateKey.toString(), privateKey.toString()],
      inBlinding: [utxo1.blinding.toString(), utxo2.blinding.toString()],
      inPathIndices: ["0", "1"],
      inPathElements: [path1.map(e => e.toString()), path2.map(e => e.toString())],
      outAmount: [paymentOut.amount.toString(), changeOut.amount.toString()],
      outPubkey: [paymentOut.pubkey.toString(), changeOut.pubkey.toString()],
      outBlinding: [paymentOut.blinding.toString(), changeOut.blinding.toString()],
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_2x2, ZKEY_2x2);
    const vkey = JSON.parse(fs.readFileSync(VKEY_2x2, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);

    // Public signals: [root, publicAmount, extDataHash, null1, null2, commit1, commit2]
    expect(BigInt(publicSignals[0])).toBe(root);
    expect(BigInt(publicSignals[1])).toBe(0n);
    expect(BigInt(publicSignals[3])).toBe(null1);
    expect(BigInt(publicSignals[4])).toBe(null2);
    expect(BigInt(publicSignals[5])).toBe(paymentOut.commitment);
    expect(BigInt(publicSignals[6])).toBe(changeOut.commitment);
  });

  it("2x2 with one dummy input (amount=0)", { timeout: TEST_TIMEOUT }, async () => {
    const privateKey = 12345n;
    const dummyKey = 1n;
    const utxo1 = createUTXO(5_000_000n, privateKey, 111n); // 5 USDC real
    const utxo2 = createUTXO(0n, dummyKey, 0n);              // dummy

    const paymentOut = createUTXO(3_000_000n, 99999n, 333n);
    const changeOut = createUTXO(2_000_000n, privateKey, 444n);

    const { levels, zeros, root } = buildSparseMerkleTree2(new Map([[0, utxo1.commitment]]));
    const path1 = getSparseMerkleProof2(levels, zeros, 0);
    const path2 = getSparseMerkleProof2(levels, zeros, 1); // dummy path — doesn't matter
    const null1 = computeNullifier(utxo1.commitment, 0, privateKey);
    const null2 = computeNullifier(utxo2.commitment, 1, dummyKey);
    const extDataHash = hash3(0n, 0n, 0n);

    const input = {
      root: root.toString(),
      publicAmount: "0",
      extDataHash: extDataHash.toString(),
      inputNullifiers: [null1.toString(), null2.toString()],
      outputCommitments: [paymentOut.commitment.toString(), changeOut.commitment.toString()],
      inAmount: [utxo1.amount.toString(), "0"],
      inPrivateKey: [privateKey.toString(), dummyKey.toString()],
      inBlinding: [utxo1.blinding.toString(), "0"],
      inPathIndices: ["0", "1"],
      inPathElements: [path1.map(e => e.toString()), path2.map(e => e.toString())],
      outAmount: [paymentOut.amount.toString(), changeOut.amount.toString()],
      outPubkey: [paymentOut.pubkey.toString(), changeOut.pubkey.toString()],
      outBlinding: [paymentOut.blinding.toString(), changeOut.blinding.toString()],
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_2x2, ZKEY_2x2);
    const vkey = JSON.parse(fs.readFileSync(VKEY_2x2, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(valid).toBe(true);
  });
});
