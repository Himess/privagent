/**
 * @deprecated V3 uses server-as-relayer middleware (privAgentPaywall in sdk/src/x402/middleware.ts).
 * This standalone relayer is kept for reference but is not used in the V3 flow.
 * The seller server now submits withdraw() on-chain directly.
 */
import express from "express";
import { ethers } from "ethers";

const POOL_ABI = [
  "function withdraw(address recipient, uint256 amount, bytes32 nullifierHash, bytes32 newCommitment, bytes32 merkleRoot, address relayer, uint256 fee, uint256[8] calldata proof) external",
  "function isKnownRoot(bytes32 root) external view returns (bool)",
  "function nullifiers(bytes32) external view returns (bool)",
];

export interface RelayerConfig {
  rpcUrl: string;
  privateKey: string;
  poolAddress: string;
  fee: bigint;
  port: number;
  vkeyPath?: string;
}

export function createRelayer(config: RelayerConfig) {
  const app = express();
  app.use(express.json());

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const poolContract = new ethers.Contract(config.poolAddress, POOL_ABI, wallet);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", chain: "base-sepolia" });
  });

  app.get("/info", async (_req, res) => {
    res.json({
      relayerAddress: wallet.address,
      fee: config.fee.toString(),
      poolAddress: config.poolAddress,
      network: "eip155:84532",
    });
  });

  app.post("/relay", async (req, res) => {
    try {
      const {
        recipient,
        amount,
        nullifierHash,
        newCommitment,
        merkleRoot,
        fee,
        proof,
      } = req.body;

      // Validate inputs
      if (!recipient || !amount || !nullifierHash || !merkleRoot || !proof) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      if (!Array.isArray(proof) || proof.length !== 8) {
        res.status(400).json({ error: "Proof must be array of 8 uint256" });
        return;
      }

      // Check fee
      const feeAmount = BigInt(fee ?? "0");
      if (feeAmount < config.fee) {
        res.status(400).json({
          error: `Insufficient fee. Minimum: ${config.fee.toString()}`,
        });
        return;
      }

      // Verify root is known
      const rootKnown = await poolContract.isKnownRoot(merkleRoot);
      if (!rootKnown) {
        res.status(400).json({ error: "Unknown merkle root" });
        return;
      }

      // Verify nullifier hasn't been used
      const nullifierUsed = await poolContract.nullifiers(nullifierHash);
      if (nullifierUsed) {
        res.status(400).json({ error: "Nullifier already used" });
        return;
      }

      // Submit withdrawal on-chain
      const tx = await poolContract.withdraw(
        recipient,
        BigInt(amount),
        nullifierHash,
        newCommitment ?? ethers.ZeroHash,
        merkleRoot,
        wallet.address, // relayer = us
        feeAmount,
        proof.map((p: string) => BigInt(p))
      );

      const receipt = await tx.wait();

      res.json({
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Relay failed: ${message}` });
    }
  });

  return app;
}

// Start server if run directly
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");

if (isMain) {
  const config: RelayerConfig = {
    rpcUrl: process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org",
    privateKey: process.env.PRIVATE_KEY ?? "",
    poolAddress: process.env.SHIELDED_POOL_ADDRESS ?? "",
    fee: BigInt(process.env.RELAYER_FEE ?? "50000"), // 0.05 USDC default
    port: Number(process.env.RELAYER_PORT ?? "4402"),
  };

  if (!config.privateKey) {
    console.error("PRIVATE_KEY env var required");
    process.exit(1);
  }

  const app = createRelayer(config);
  app.listen(config.port, () => {
    console.log(`PrivAgent Relayer listening on port ${config.port}`);
    console.log(`  Pool: ${config.poolAddress}`);
    console.log(`  Fee: ${config.fee.toString()} (${Number(config.fee) / 1e6} USDC)`);
  });
}

export default createRelayer;
