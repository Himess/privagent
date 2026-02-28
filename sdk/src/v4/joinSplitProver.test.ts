import { describe, it, expect, beforeAll } from "vitest";
import { initPoseidon } from "../poseidon.js";
import { MerkleTree } from "../merkle.js";
import {
  createUTXO,
  createDummyUTXO,
  derivePublicKey,
  computeNullifierV4,
  V4_MERKLE_DEPTH,
} from "./utxo.js";
import { generateJoinSplitProof, proofToArray } from "./joinSplitProver.js";
import { computeExtDataHash, ExtData } from "./extData.js";
import { ethers } from "ethers";
import * as path from "path";

// Longer timeout for proof generation
const PROOF_TIMEOUT = 60_000;

// Circuit directory (relative to project root)
const CIRCUIT_DIR = path.resolve(
  process.cwd().replace(/sdk$/, ""),
  "circuits/build"
);

describe("V4 JoinSplit Prover", () => {
  let privateKey: bigint;
  let publicKey: bigint;
  let tree: MerkleTree;

  beforeAll(async () => {
    await initPoseidon();
    privateKey = 42n;
    publicKey = derivePublicKey(privateKey);
    tree = new MerkleTree(V4_MERKLE_DEPTH);
  });

  it(
    "should generate valid 1x2 deposit proof",
    async () => {
      // Deposit: 1 dummy input, 2 outputs (deposit + zero change)
      const depositAmount = 10000000n; // 10 USDC
      const depositUTXO = createUTXO(depositAmount, publicKey);
      const zeroUTXO = createUTXO(0n, publicKey);

      const extData: ExtData = {
        recipient: ethers.ZeroAddress,
        relayer: ethers.ZeroAddress,
        fee: 0n,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const result = await generateJoinSplitProof(
        {
          inputs: [createDummyUTXO()],
          outputs: [depositUTXO, zeroUTXO],
          publicAmount: depositAmount,
          tree,
          extDataHash: computeExtDataHash(extData),
          privateKey,
        },
        CIRCUIT_DIR
      );

      expect(result.nIns).toBe(1);
      expect(result.nOuts).toBe(2);
      expect(result.publicSignals).toHaveLength(6); // root, pubAmount, extDataHash, 1 null, 2 commits
      expect(result.proofData.pA).toHaveLength(2);

      const proofArray = proofToArray(result.proofData);
      expect(proofArray).toHaveLength(8);
    },
    PROOF_TIMEOUT
  );

  it(
    "should generate valid 1x2 transfer proof",
    async () => {
      // First insert a UTXO into the tree
      const inputUTXO = createUTXO(10000000n, publicKey);
      const leafIndex = tree.addLeaf(inputUTXO.commitment);
      inputUTXO.leafIndex = leafIndex;
      inputUTXO.nullifier = computeNullifierV4(
        inputUTXO.commitment,
        leafIndex,
        privateKey
      );

      // Transfer: 3 USDC payment + 7 USDC change
      const paymentUTXO = createUTXO(3000000n, publicKey);
      const changeUTXO = createUTXO(7000000n, publicKey);

      const extData: ExtData = {
        recipient: ethers.ZeroAddress,
        relayer: ethers.ZeroAddress,
        fee: 0n,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const result = await generateJoinSplitProof(
        {
          inputs: [inputUTXO],
          outputs: [paymentUTXO, changeUTXO],
          publicAmount: 0n, // private transfer
          tree,
          extDataHash: computeExtDataHash(extData),
          privateKey,
        },
        CIRCUIT_DIR
      );

      expect(result.nIns).toBe(1);
      expect(result.nOuts).toBe(2);
      expect(result.publicSignals).toHaveLength(6);
    },
    PROOF_TIMEOUT
  );

  it(
    "should generate valid 1x2 withdraw proof",
    async () => {
      // Insert a UTXO
      const inputUTXO = createUTXO(5000000n, publicKey);
      const leafIndex = tree.addLeaf(inputUTXO.commitment);
      inputUTXO.leafIndex = leafIndex;
      inputUTXO.nullifier = computeNullifierV4(
        inputUTXO.commitment,
        leafIndex,
        privateKey
      );

      // Withdraw 3 USDC, 2 USDC change
      const changeUTXO = createUTXO(2000000n, publicKey);
      const zeroUTXO = createUTXO(0n, publicKey);

      const extData: ExtData = {
        recipient: "0x1234567890abcdef1234567890abcdef12345678",
        relayer: ethers.ZeroAddress,
        fee: 0n,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const result = await generateJoinSplitProof(
        {
          inputs: [inputUTXO],
          outputs: [changeUTXO, zeroUTXO],
          publicAmount: -3000000n, // withdraw 3 USDC
          tree,
          extDataHash: computeExtDataHash(extData),
          privateKey,
        },
        CIRCUIT_DIR
      );

      expect(result.nIns).toBe(1);
      expect(result.nOuts).toBe(2);
    },
    PROOF_TIMEOUT
  );

  it(
    "should generate valid 2x2 consolidation proof",
    async () => {
      // Insert 2 UTXOs
      const utxo1 = createUTXO(4000000n, publicKey);
      const idx1 = tree.addLeaf(utxo1.commitment);
      utxo1.leafIndex = idx1;
      utxo1.nullifier = computeNullifierV4(utxo1.commitment, idx1, privateKey);

      const utxo2 = createUTXO(6000000n, publicKey);
      const idx2 = tree.addLeaf(utxo2.commitment);
      utxo2.leafIndex = idx2;
      utxo2.nullifier = computeNullifierV4(utxo2.commitment, idx2, privateKey);

      // Consolidate: 2 inputs → 1 big output + 0 change
      const consolidatedUTXO = createUTXO(10000000n, publicKey);
      const zeroUTXO = createUTXO(0n, publicKey);

      const extData: ExtData = {
        recipient: ethers.ZeroAddress,
        relayer: ethers.ZeroAddress,
        fee: 0n,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const result = await generateJoinSplitProof(
        {
          inputs: [utxo1, utxo2],
          outputs: [consolidatedUTXO, zeroUTXO],
          publicAmount: 0n,
          tree,
          extDataHash: computeExtDataHash(extData),
          privateKey,
        },
        CIRCUIT_DIR
      );

      expect(result.nIns).toBe(2);
      expect(result.nOuts).toBe(2);
      expect(result.publicSignals).toHaveLength(7); // root, pubAmount, extDataHash, 2 nulls, 2 commits
    },
    PROOF_TIMEOUT
  );

  it(
    "should handle dummy input in 1x2",
    async () => {
      const dummy = createDummyUTXO();
      const out1 = createUTXO(5000000n, publicKey);
      const out2 = createUTXO(0n, publicKey);

      const extData: ExtData = {
        recipient: ethers.ZeroAddress,
        relayer: ethers.ZeroAddress,
        fee: 0n,
        encryptedOutput1: new Uint8Array([0xaa]),
        encryptedOutput2: new Uint8Array([0xbb]),
      };

      const result = await generateJoinSplitProof(
        {
          inputs: [dummy],
          outputs: [out1, out2],
          publicAmount: 5000000n, // deposit
          tree,
          extDataHash: computeExtDataHash(extData),
          privateKey,
        },
        CIRCUIT_DIR
      );

      expect(result.nIns).toBe(1);
      expect(result.publicSignals).toHaveLength(6);
    },
    PROOF_TIMEOUT
  );
});
