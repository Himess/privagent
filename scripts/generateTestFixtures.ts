// SPDX-License-Identifier: BUSL-1.1
/**
 * Generate Groth16 proof fixtures for Foundry integration tests.
 *
 * Uses the real SDK proof generation pipeline to create valid proofs,
 * then saves them as JSON files that Foundry can read via vm.readFile().
 *
 * Run: cd sdk && npx tsx ../scripts/generateTestFixtures.ts
 * Output: contracts/test/fixtures/*.json
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as snarkjs from "snarkjs";
import { ethers } from "ethers";
import { initPoseidon, hash1, hash3 } from "../sdk/src/poseidon.js";
import { MerkleTree } from "../sdk/src/merkle.js";
import { FIELD_SIZE } from "../sdk/src/types.js";
import {
  createUTXO,
  createDummyUTXO,
  computeNullifierV4,
  computeCommitmentV4,
  derivePublicKey,
  V4_MERKLE_DEPTH,
} from "../sdk/src/v4/utxo.js";
import { computeExtDataHash, ExtData } from "../sdk/src/v4/extData.js";
import {
  selectCircuit,
  generateJoinSplitProof,
  JoinSplitInput,
} from "../sdk/src/v4/joinSplitProver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "../contracts/test/fixtures");
const CIRCUIT_DIR = path.join(__dirname, "../circuits/build");

// Deterministic test private key (NOT a real key)
const TEST_PRIVATE_KEY = 12345678901234567890n;

function toJSON(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}

function saveFixture(name: string, data: unknown) {
  const filePath = path.join(FIXTURE_DIR, `${name}.json`);
  fs.writeFileSync(filePath, toJSON(data));
  console.log(`   Saved: ${filePath}`);
}

/**
 * Format proof for Solidity verifier:
 * snarkjs pi_b coordinates must be SWAPPED for on-chain verifier
 */
function formatProofForSolidity(proof: snarkjs.Groth16Proof) {
  return {
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
  };
}

/**
 * Build ExtData for testing — default to zero-recipient (private transfer)
 */
function buildExtData(overrides: Partial<ExtData> = {}): ExtData {
  return {
    recipient: ethers.ZeroAddress,
    relayer: ethers.ZeroAddress,
    fee: 0n,
    encryptedOutput1: new Uint8Array([0xaa]),
    encryptedOutput2: new Uint8Array([0xbb]),
    ...overrides,
  };
}

async function main() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  console.log("Generating proof fixtures for Foundry integration tests...\n");

  // ===== SETUP =====
  await initPoseidon();
  const publicKey = derivePublicKey(TEST_PRIVATE_KEY);
  const tree = new MerkleTree(V4_MERKLE_DEPTH);

  // Protocol fee: 0.1% with $0.01 min → for 10 USDC = max(10000, 10000) = 10000
  const PROTOCOL_FEE_BPS = 10n;
  const MIN_PROTOCOL_FEE = 10000n; // 0.01 USDC

  function calculateProtocolFee(amount: bigint): bigint {
    const percentFee = (amount * PROTOCOL_FEE_BPS) / 10000n;
    return percentFee > MIN_PROTOCOL_FEE ? percentFee : MIN_PROTOCOL_FEE;
  }

  // ===== FIXTURE 1: DEPOSIT (1x2) =====
  console.log("1. Generating deposit proof (1x2)...");
  {
    const depositAmount = 10_000_000n; // 10 USDC
    const protocolFee = calculateProtocolFee(depositAmount);
    const netAmount = depositAmount - protocolFee;

    const dummyInput = createDummyUTXO();
    const depositUTXO = createUTXO(netAmount, publicKey);
    const dummyOutput = createUTXO(0n, publicKey);

    const extData = buildExtData();
    const extDataHash = computeExtDataHash(extData);

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      buildCircuitInputRaw({
        inputs: [dummyInput],
        outputs: [depositUTXO, dummyOutput],
        publicAmount: depositAmount,
        protocolFee,
        tree,
        extDataHash,
        privateKey: TEST_PRIVATE_KEY,
      }),
      selectCircuit(1, 2, CIRCUIT_DIR).wasmPath,
      selectCircuit(1, 2, CIRCUIT_DIR).zkeyPath
    );

    // Verify locally
    const vkey = JSON.parse(
      fs.readFileSync(selectCircuit(1, 2, CIRCUIT_DIR).vkeyPath, "utf8")
    );
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!valid) throw new Error("Deposit proof failed local verification!");

    const solidityProof = formatProofForSolidity(proof);

    // Add deposit to tree for subsequent fixtures
    tree.addLeaf(depositUTXO.commitment);
    tree.addLeaf(dummyOutput.commitment);
    depositUTXO.leafIndex = 0;
    dummyOutput.leafIndex = 1;
    depositUTXO.nullifier = computeNullifierV4(
      depositUTXO.commitment,
      0,
      TEST_PRIVATE_KEY
    );

    saveFixture("deposit_1x2", {
      proof: solidityProof,
      publicSignals,
      args: {
        root: publicSignals[0],
        publicAmount: depositAmount.toString(),
        extDataHash: publicSignals[2],
        protocolFee: protocolFee.toString(),
        nullifiers: [publicSignals[4]],
        commitments: [publicSignals[5], publicSignals[6]],
        viewTags: [0, 0],
      },
      extData: {
        recipient: ethers.ZeroAddress,
        relayer: ethers.ZeroAddress,
        fee: "0",
        encryptedOutput1: "0xaa",
        encryptedOutput2: "0xbb",
      },
      metadata: {
        circuit: "1x2",
        type: "deposit",
        amount: depositAmount.toString(),
        netAmount: netAmount.toString(),
        protocolFee: protocolFee.toString(),
      },
    });
    console.log("   deposit_1x2.json");

    // ===== FIXTURE 2: WITHDRAW (1x2) =====
    console.log("2. Generating withdraw proof (1x2)...");
    {
      const withdrawAmount = 5_000_000n; // 5 USDC
      const withdrawFee = calculateProtocolFee(withdrawAmount);
      // publicAmount = -(withdrawAmount) for withdrawal
      const publicAmount = -withdrawAmount;
      // Need to deduct fee from UTXO
      const changeAmount = netAmount - withdrawAmount - withdrawFee;

      const recipientAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Anvil #1

      const changeUTXO = createUTXO(changeAmount, publicKey);

      const withdrawExtData = buildExtData({
        recipient: recipientAddr,
      });
      const withdrawExtDataHash = computeExtDataHash(withdrawExtData);

      const { proof: wProof, publicSignals: wSignals } =
        await snarkjs.groth16.fullProve(
          buildCircuitInputRaw({
            inputs: [depositUTXO],
            outputs: [changeUTXO, createUTXO(0n, publicKey)],
            publicAmount,
            protocolFee: withdrawFee,
            tree,
            extDataHash: withdrawExtDataHash,
            privateKey: TEST_PRIVATE_KEY,
          }),
          selectCircuit(1, 2, CIRCUIT_DIR).wasmPath,
          selectCircuit(1, 2, CIRCUIT_DIR).zkeyPath
        );

      const wVkey = JSON.parse(
        fs.readFileSync(selectCircuit(1, 2, CIRCUIT_DIR).vkeyPath, "utf8")
      );
      const wValid = await snarkjs.groth16.verify(wVkey, wSignals, wProof);
      if (!wValid) throw new Error("Withdraw proof failed local verification!");

      const wSolidityProof = formatProofForSolidity(wProof);

      // Field-wrap negative publicAmount for Solidity
      const publicAmountField = FIELD_SIZE + publicAmount;

      saveFixture("withdraw_1x2", {
        proof: wSolidityProof,
        publicSignals: wSignals,
        args: {
          root: wSignals[0],
          publicAmount: publicAmount.toString(),
          publicAmountSolidity: publicAmountField.toString(),
          extDataHash: wSignals[2],
          protocolFee: withdrawFee.toString(),
          nullifiers: [wSignals[4]],
          commitments: [wSignals[5], wSignals[6]],
          viewTags: [0, 0],
        },
        extData: {
          recipient: recipientAddr,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0xaa",
          encryptedOutput2: "0xbb",
        },
        metadata: {
          circuit: "1x2",
          type: "withdraw",
          amount: withdrawAmount.toString(),
          protocolFee: withdrawFee.toString(),
        },
      });
      console.log("   withdraw_1x2.json");
    }

    // ===== FIXTURE 3: INVALID PROOF =====
    console.log("3. Generating invalid proof...");
    {
      // Take valid deposit proof and corrupt pA[0]
      const invalidProof = JSON.parse(JSON.stringify(solidityProof));
      const pA0 = BigInt(invalidProof.pA[0]);
      invalidProof.pA[0] = (pA0 + 1n).toString();

      saveFixture("invalid_proof", {
        proof: invalidProof,
        publicSignals,
        args: {
          root: publicSignals[0],
          publicAmount: depositAmount.toString(),
          extDataHash: publicSignals[2],
          protocolFee: protocolFee.toString(),
          nullifiers: [publicSignals[4]],
          commitments: [publicSignals[5], publicSignals[6]],
          viewTags: [0, 0],
        },
        extData: {
          recipient: ethers.ZeroAddress,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0xaa",
          encryptedOutput2: "0xbb",
        },
        metadata: {
          circuit: "1x2",
          type: "invalid",
          note: "pA[0] corrupted by +1",
        },
      });
      console.log("   invalid_proof.json");
    }

    // ===== FIXTURE 4: DOUBLE-SPEND =====
    console.log("4. Generating double-spend proof pair...");
    {
      // First proof is the original deposit spend (fixture 2 uses same UTXO)
      // So we generate TWO proofs from the same deposit UTXO to different recipients

      // First spend (valid)
      const recipient1 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"; // Anvil #2
      const change1 = createUTXO(netAmount - 1_000_000n - MIN_PROTOCOL_FEE, publicKey);
      const ext1 = buildExtData({ recipient: recipient1 });
      const ext1Hash = computeExtDataHash(ext1);

      const { proof: ds1Proof, publicSignals: ds1Signals } =
        await snarkjs.groth16.fullProve(
          buildCircuitInputRaw({
            inputs: [depositUTXO],
            outputs: [change1, createUTXO(0n, publicKey)],
            publicAmount: -1_000_000n,
            protocolFee: MIN_PROTOCOL_FEE,
            tree,
            extDataHash: ext1Hash,
            privateKey: TEST_PRIVATE_KEY,
          }),
          selectCircuit(1, 2, CIRCUIT_DIR).wasmPath,
          selectCircuit(1, 2, CIRCUIT_DIR).zkeyPath
        );

      // Second spend (same nullifier — double-spend!)
      const recipient2 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Anvil #3
      const change2 = createUTXO(netAmount - 2_000_000n - MIN_PROTOCOL_FEE, publicKey);
      const ext2 = buildExtData({ recipient: recipient2 });
      const ext2Hash = computeExtDataHash(ext2);

      const { proof: ds2Proof, publicSignals: ds2Signals } =
        await snarkjs.groth16.fullProve(
          buildCircuitInputRaw({
            inputs: [depositUTXO],
            outputs: [change2, createUTXO(0n, publicKey)],
            publicAmount: -2_000_000n,
            protocolFee: MIN_PROTOCOL_FEE,
            tree,
            extDataHash: ext2Hash,
            privateKey: TEST_PRIVATE_KEY,
          }),
          selectCircuit(1, 2, CIRCUIT_DIR).wasmPath,
          selectCircuit(1, 2, CIRCUIT_DIR).zkeyPath
        );

      saveFixture("double_spend_first", {
        proof: formatProofForSolidity(ds1Proof),
        publicSignals: ds1Signals,
        args: {
          root: ds1Signals[0],
          publicAmount: (-1_000_000n).toString(),
          publicAmountSolidity: (FIELD_SIZE - 1_000_000n).toString(),
          extDataHash: ds1Signals[2],
          protocolFee: MIN_PROTOCOL_FEE.toString(),
          nullifiers: [ds1Signals[4]],
          commitments: [ds1Signals[5], ds1Signals[6]],
          viewTags: [0, 0],
        },
        extData: {
          recipient: recipient1,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0xaa",
          encryptedOutput2: "0xbb",
        },
        metadata: { type: "double_spend_first" },
      });

      saveFixture("double_spend_second", {
        proof: formatProofForSolidity(ds2Proof),
        publicSignals: ds2Signals,
        args: {
          root: ds2Signals[0],
          publicAmount: (-2_000_000n).toString(),
          publicAmountSolidity: (FIELD_SIZE - 2_000_000n).toString(),
          extDataHash: ds2Signals[2],
          protocolFee: MIN_PROTOCOL_FEE.toString(),
          nullifiers: [ds2Signals[4]],
          commitments: [ds2Signals[5], ds2Signals[6]],
          viewTags: [0, 0],
        },
        extData: {
          recipient: recipient2,
          relayer: ethers.ZeroAddress,
          fee: "0",
          encryptedOutput1: "0xaa",
          encryptedOutput2: "0xbb",
        },
        metadata: { type: "double_spend_second", note: "Same nullifier as first" },
      });
      console.log("   double_spend_first.json + double_spend_second.json");
    }
  }

  console.log(`\nAll fixtures saved to ${FIXTURE_DIR}`);
  console.log("Run: cd contracts && forge test --match-path test/integration/ -vvv");
}

// ============================================================================
// Raw circuit input builder (matches joinSplitProver.ts buildCircuitInput)
// ============================================================================

interface RawInput {
  inputs: ReturnType<typeof createDummyUTXO>[];
  outputs: ReturnType<typeof createUTXO>[];
  publicAmount: bigint;
  protocolFee: bigint;
  tree: MerkleTree;
  extDataHash: bigint;
  privateKey: bigint;
}

function buildCircuitInputRaw(
  params: RawInput
): Record<string, snarkjs.NumericString> {
  const { inputs, outputs, publicAmount, tree, extDataHash, privateKey } = params;
  const levels = V4_MERKLE_DEPTH;
  const nIns = inputs.length;
  const nOuts = outputs.length;

  const inAmount: string[] = [];
  const inPrivateKey: string[] = [];
  const inBlinding: string[] = [];
  const inPathIndices: string[] = [];
  const inPathElements: string[][] = [];
  const inputNullifiers: string[] = [];

  for (let i = 0; i < nIns; i++) {
    const utxo = inputs[i];
    inAmount.push(utxo.amount.toString());
    inPrivateKey.push(utxo.amount === 0n ? "0" : privateKey.toString());
    inBlinding.push(utxo.blinding.toString());

    if (utxo.amount === 0n || utxo.leafIndex === undefined) {
      inPathIndices.push("0");
      inPathElements.push(Array(levels).fill("0"));
      const dummyPubkey = derivePublicKey(0n);
      const dummyCommitment = computeCommitmentV4(0n, dummyPubkey, 0n);
      inputNullifiers.push(computeNullifierV4(dummyCommitment, 0, 0n).toString());
    } else {
      const proof = tree.getProof(utxo.leafIndex);
      inPathIndices.push(utxo.leafIndex.toString());
      inPathElements.push(proof.pathElements.map((e) => e.toString()));
      const nullifier =
        utxo.nullifier ??
        computeNullifierV4(utxo.commitment, utxo.leafIndex, privateKey);
      inputNullifiers.push(nullifier.toString());
    }
  }

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
    protocolFee: params.protocolFee.toString(),
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
  } as unknown as Record<string, snarkjs.NumericString>;
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
