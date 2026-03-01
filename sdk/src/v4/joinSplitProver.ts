// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import { MerkleTree } from "../merkle.js";
import {
  UTXO,
  createDummyUTXO,
  computeNullifierV4,
  computeCommitmentV4,
  derivePublicKey,
  V4_MERKLE_DEPTH,
} from "./utxo.js";
import { ProofData, FIELD_SIZE } from "../types.js";

// ============================================================================
// Circuit Artifact Paths
// ============================================================================

export interface CircuitArtifacts {
  wasmPath: string;
  zkeyPath: string;
  vkeyPath: string;
}

export interface JoinSplitProofResult {
  proofData: ProofData;
  publicSignals: string[];
  nIns: number;
  nOuts: number;
}

// ============================================================================
// Circuit Selection
// ============================================================================

/**
 * Select the right circuit based on input/output count.
 * Available circuits: 1x2 and 2x2
 */
export function selectCircuit(
  nIns: number,
  nOuts: number,
  circuitDir: string
): CircuitArtifacts {
  const key = `${nIns}x${nOuts}`;
  const base = `${circuitDir}/v4/${key}`;

  return {
    wasmPath: `${base}/joinSplit_${key}_js/joinSplit_${key}.wasm`,
    zkeyPath: `${base}/joinSplit_${key}_final.zkey`,
    vkeyPath: `${base}/verification_key.json`,
  };
}

// ============================================================================
// Proof Generation
// ============================================================================

export interface JoinSplitInput {
  inputs: UTXO[]; // UTXOs being consumed
  outputs: UTXO[]; // UTXOs being created
  publicAmount: bigint; // >0 deposit, <0 withdraw, 0 transfer
  tree: MerkleTree;
  extDataHash: bigint;
  privateKey: bigint;
}

/**
 * Generate a JoinSplit ZK proof.
 *
 * Pads inputs with dummy UTXOs to match circuit requirements.
 * Currently supports 1x2 and 2x2 circuits.
 */
export async function generateJoinSplitProof(
  params: JoinSplitInput,
  circuitDir: string
): Promise<JoinSplitProofResult> {
  const { inputs, outputs, publicAmount, tree, extDataHash, privateKey } =
    params;

  // Determine circuit config
  const nIns = inputs.length;
  const nOuts = outputs.length;

  if (nOuts !== 2) {
    throw new Error(`Only 2 outputs supported, got ${nOuts}`);
  }
  if (nIns < 1 || nIns > 2) {
    throw new Error(`Only 1-2 inputs supported, got ${nIns}`);
  }

  const artifacts = selectCircuit(nIns, nOuts, circuitDir);

  // Build circuit input
  const circuitInput = buildCircuitInput(params, nIns, nOuts);

  // Generate proof
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput as unknown as Record<string, snarkjs.NumericString>,
    artifacts.wasmPath,
    artifacts.zkeyPath
  );

  // Verify locally
  const vkey = JSON.parse(fs.readFileSync(artifacts.vkeyPath, "utf8"));
  const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  if (!valid) {
    throw new Error("JoinSplit proof verification failed locally");
  }

  const proofData = formatProofForContract(proof, publicSignals);

  return { proofData, publicSignals, nIns, nOuts };
}

// ============================================================================
// Circuit Input Builder
// ============================================================================

function buildCircuitInput(
  params: JoinSplitInput,
  nIns: number,
  nOuts: number
): Record<string, string | string[] | string[][]> {
  const { inputs, outputs, publicAmount, tree, extDataHash, privateKey } =
    params;
  const levels = V4_MERKLE_DEPTH;

  // Pad inputs with dummy UTXOs if needed
  const paddedInputs = [...inputs];
  while (paddedInputs.length < nIns) {
    paddedInputs.push(createDummyUTXO());
  }

  // Build input arrays
  const inAmount: string[] = [];
  const inPrivateKey: string[] = [];
  const inBlinding: string[] = [];
  const inPathIndices: string[] = [];
  const inPathElements: string[][] = [];
  const inputNullifiers: string[] = [];

  for (let i = 0; i < nIns; i++) {
    const utxo = paddedInputs[i];
    inAmount.push(utxo.amount.toString());
    inPrivateKey.push(utxo.amount === 0n ? "0" : privateKey.toString());
    inBlinding.push(utxo.blinding.toString());

    if (utxo.amount === 0n || utxo.leafIndex === undefined) {
      // Dummy input — use zero path
      inPathIndices.push("0");
      inPathElements.push(Array(levels).fill("0"));
      // Compute nullifier for dummy (amount=0, so root check skipped by circuit)
      // Circuit derives pubkey = Poseidon(privateKey=0) internally
      const dummyPubkey = derivePublicKey(0n);
      const dummyCommitment = computeCommitmentV4(0n, dummyPubkey, 0n);
      inputNullifiers.push(
        computeNullifierV4(dummyCommitment, 0, 0n).toString()
      );
    } else {
      // Real input — get Merkle proof
      const proof = tree.getProof(utxo.leafIndex);
      inPathIndices.push(utxo.leafIndex.toString());
      inPathElements.push(proof.pathElements.map((e) => e.toString()));
      const nullifier =
        utxo.nullifier ??
        computeNullifierV4(utxo.commitment, utxo.leafIndex, privateKey);
      inputNullifiers.push(nullifier.toString());
    }
  }

  // Build output arrays
  const outAmount: string[] = [];
  const outPubkey: string[] = [];
  const outBlinding: string[] = [];
  const outputCommitments: string[] = [];

  for (let i = 0; i < nOuts; i++) {
    const utxo = outputs[i];
    outAmount.push(utxo.amount.toString());
    outPubkey.push(utxo.pubkey.toString());
    outBlinding.push(utxo.blinding.toString());
    outputCommitments.push(utxo.commitment.toString());
  }

  // Handle publicAmount — field-wrap negatives for the circuit [SDK-H2]
  let publicAmountStr: string;
  if (publicAmount >= 0n) {
    publicAmountStr = publicAmount.toString();
  } else {
    publicAmountStr = (FIELD_SIZE + publicAmount).toString();
  }

  return {
    root: tree.getRoot().toString(),
    publicAmount: publicAmountStr,
    extDataHash: extDataHash.toString(),
    inputNullifiers,
    outputCommitments,
    inAmount,
    inPrivateKey,
    inBlinding,
    inPathIndices,
    inPathElements,
    outAmount,
    outPubkey,
    outBlinding,
  };
}

// ============================================================================
// Proof Formatting
// ============================================================================

function formatProofForContract(
  proof: snarkjs.Groth16Proof,
  publicSignals: string[]
): ProofData {
  return {
    pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    pB: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    publicSignals: publicSignals.map((s) => BigInt(s)),
  };
}

/**
 * Flatten proof to uint256[8] for contract call
 */
export function proofToArray(proofData: ProofData): bigint[] {
  return [
    proofData.pA[0],
    proofData.pA[1],
    proofData.pB[0][0],
    proofData.pB[0][1],
    proofData.pB[1][0],
    proofData.pB[1][1],
    proofData.pC[0],
    proofData.pC[1],
  ];
}
