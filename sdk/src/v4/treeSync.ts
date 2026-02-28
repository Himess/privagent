import { Provider, Contract } from "ethers";
import { MerkleTree } from "../merkle.js";
import { V4_MERKLE_DEPTH } from "./utxo.js";

const POOL_ABI_EVENTS = [
  "event NewCommitment(bytes32 indexed commitment, uint256 indexed leafIndex, bytes encryptedOutput)",
  "event NewNullifier(bytes32 indexed nullifier)",
];

const CHUNK_SIZE = 9000; // RPC 10K block range limit

/**
 * Sync a Merkle tree from on-chain NewCommitment events.
 * Paginates in 9000-block chunks for public RPC compatibility.
 */
export async function syncTreeFromEvents(
  provider: Provider,
  poolAddress: string,
  deployBlock: number = 0
): Promise<{ tree: MerkleTree; commitments: bigint[]; encryptedOutputs: Map<number, Uint8Array> }> {
  const tree = new MerkleTree(V4_MERKLE_DEPTH);
  const commitments: bigint[] = [];
  const encryptedOutputs = new Map<number, Uint8Array>();

  const contract = new Contract(poolAddress, POOL_ABI_EVENTS, provider);
  const currentBlock = await provider.getBlockNumber();

  for (let from = deployBlock; from <= currentBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
    const events = await contract.queryFilter(
      contract.filters.NewCommitment(),
      from,
      to
    );

    for (const event of events) {
      const log = event as any;
      const commitment = BigInt(log.args[0]);
      const leafIndex = Number(log.args[1]);
      const encOutput = log.args[2] as string;

      // [SDK-M2] Assert ordering — leafIndex must be >= current length
      if (leafIndex < commitments.length) {
        throw new Error(`Out-of-order leaf: index ${leafIndex}, expected >= ${commitments.length}`);
      }

      // Ensure leaves are inserted in order
      while (commitments.length < leafIndex) {
        commitments.push(0n);
        tree.addLeaf(0n);
      }

      commitments.push(commitment);
      tree.addLeaf(commitment);

      if (encOutput && encOutput !== "0x") {
        encryptedOutputs.set(
          leafIndex,
          Uint8Array.from(Buffer.from(encOutput.slice(2), "hex"))
        );
      }
    }
  }

  return { tree, commitments, encryptedOutputs };
}

/**
 * Get spent nullifiers from on-chain events.
 */
export async function getSpentNullifiers(
  provider: Provider,
  poolAddress: string,
  deployBlock: number = 0
): Promise<Set<bigint>> {
  const contract = new Contract(poolAddress, POOL_ABI_EVENTS, provider);
  const currentBlock = await provider.getBlockNumber();
  const nullifiers = new Set<bigint>();

  for (let from = deployBlock; from <= currentBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
    const events = await contract.queryFilter(
      contract.filters.NewNullifier(),
      from,
      to
    );

    for (const event of events) {
      const log = event as any;
      nullifiers.add(BigInt(log.args[0]));
    }
  }

  return nullifiers;
}
