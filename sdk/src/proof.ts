import * as snarkjs from "snarkjs";
import * as fs from "fs";
import { ProofData, CircuitInput } from "./types.js";

export class ProofGenerator {
  private wasmPath: string;
  private zkeyPath: string;
  private vkeyPath: string;

  constructor(wasmPath: string, zkeyPath: string, vkeyPath: string) {
    this.wasmPath = wasmPath;
    this.zkeyPath = zkeyPath;
    this.vkeyPath = vkeyPath;
  }

  async generateProof(input: CircuitInput): Promise<{
    proofData: ProofData;
    publicSignals: string[];
  }> {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      this.wasmPath,
      this.zkeyPath
    );

    // Verify locally
    const vkey = JSON.parse(fs.readFileSync(this.vkeyPath, "utf8"));
    const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!valid) {
      throw new Error("Proof verification failed locally");
    }

    const proofData = this.formatProofForContract(proof, publicSignals);
    return { proofData, publicSignals };
  }

  /**
   * Format proof for Solidity contract.
   * CRITICAL: pi_b coordinates are swapped (x,y → y,x) for BN254 pairing
   */
  private formatProofForContract(
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
   * Format proof as flat uint256[8] for contract call
   */
  static proofToArray(proof: ProofData): bigint[] {
    return [
      proof.pA[0],
      proof.pA[1],
      proof.pB[0][0],
      proof.pB[0][1],
      proof.pB[1][0],
      proof.pB[1][1],
      proof.pC[0],
      proof.pC[1],
    ];
  }
}
