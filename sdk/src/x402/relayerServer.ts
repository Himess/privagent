// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1

/**
 * [C3] GhostPay Relayer Server — real TX submission.
 *
 * A relayer accepts ZK proofs from clients and submits on-chain
 * transactions on their behalf, earning a fee for the gas cost.
 *
 * Usage:
 *   const app = createRelayerServer({ privateKey, poolAddress, poolAbi, rpcUrl });
 *   app.listen(3002, () => console.log('Relayer on :3002'));
 */

export interface RelayerConfig {
  privateKey: string;
  poolAddress: string;
  poolAbi: any; // ShieldedPoolV4 ABI
  rpcUrl: string;
  port?: number;
  minFee?: bigint;
  verificationKeys?: {
    vkey1x2Path: string;
    vkey2x2Path: string;
  };
}

export interface RelaySubmitRequest {
  proof: {
    pA: string[];
    pB: string[][];
    pC: string[];
  };
  publicSignals: string[];
  args: {
    pA: [string, string];
    pB: [[string, string], [string, string]];
    pC: [string, string];
    root: string;
    publicAmount: string;
    extDataHash: string;
    protocolFee: string;
    inputNullifiers: string[];
    outputCommitments: string[];
    viewTags: number[];
  };
  extData: {
    recipient: string;
    relayer: string;
    fee: string;
    encryptedOutput1: string;
    encryptedOutput2: string;
  };
}

export interface RelaySubmitResponse {
  success: boolean;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  fee?: string;
  message?: string;
}

/**
 * Create a relayer Express app with real on-chain TX submission.
 */
export function createRelayerServer(config: RelayerConfig) {
  // Dynamic import to avoid bundling express as hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require("express") as any;
  const app = express.default ? express.default() : express();
  app.use((express.default || express).json({ limit: "100kb" }));

  // Lazy-init provider/wallet/pool on first request
  let _pool: any = null;
  let _wallet: any = null;
  let _provider: any = null;

  async function getPool() {
    if (!_pool) {
      const { ethers } = await import("ethers");
      _provider = new ethers.JsonRpcProvider(config.rpcUrl);
      _wallet = new ethers.Wallet(config.privateKey, _provider);
      _pool = new ethers.Contract(
        config.poolAddress,
        config.poolAbi,
        _wallet
      );
    }
    return { pool: _pool, wallet: _wallet, provider: _provider };
  }

  app.get("/v1/info", async (_req: any, res: any) => {
    try {
      const { wallet, provider } = await getPool();
      const balance = await provider.getBalance(wallet.address);
      const feeData = await provider.getFeeData();
      res.json({
        status: "online",
        address: wallet.address,
        fee: (config.minFee || 20000n).toString(),
        supportedPools: [config.poolAddress],
        gasPrice: feeData.gasPrice?.toString() || "0",
        ethBalance: balance.toString(),
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ status: "error", message: msg });
    }
  });

  app.post("/v1/relay", async (req: any, res: any) => {
    try {
      const { args, extData } = req.body as RelaySubmitRequest;

      if (!args || !extData) {
        return res
          .status(400)
          .json({ success: false, message: "Missing args or extData" });
      }

      if (!args.inputNullifiers || !args.outputCommitments) {
        return res
          .status(400)
          .json({ success: false, message: "Missing nullifiers or commitments" });
      }

      // Min fee check
      const relayerFee = BigInt(extData.fee || "0");
      if (config.minFee && relayerFee < config.minFee) {
        return res
          .status(400)
          .json({
            success: false,
            message: `Fee too low. Minimum: ${config.minFee}`,
          });
      }

      // Off-chain proof verification (optional)
      if (config.verificationKeys) {
        try {
          const snarkjs = await import("snarkjs");
          const fsModule = await import("fs");
          const nInputs = args.inputNullifiers.length;
          const vkeyPath =
            nInputs === 1
              ? config.verificationKeys.vkey1x2Path
              : config.verificationKeys.vkey2x2Path;

          const vkey = JSON.parse(
            fsModule.readFileSync(vkeyPath, "utf8")
          );

          // Reconstruct proof + signals for snarkjs verification
          const proof = {
            pi_a: [args.pA[0], args.pA[1], "1"],
            pi_b: [
              [args.pB[0][1], args.pB[0][0]],
              [args.pB[1][1], args.pB[1][0]],
              ["1", "0"],
            ],
            pi_c: [args.pC[0], args.pC[1], "1"],
            protocol: "groth16",
            curve: "bn128",
          };

          const pubSignals = [
            args.root,
            args.publicAmount,
            args.extDataHash,
            args.protocolFee,
            ...args.inputNullifiers,
            ...args.outputCommitments,
          ];

          const valid = await snarkjs.groth16.verify(
            vkey,
            pubSignals,
            proof as any
          );
          if (!valid) {
            return res
              .status(400)
              .json({ success: false, message: "Invalid ZK proof" });
          }
        } catch (verifyError: unknown) {
          // Off-chain verify failed — on-chain verifier will catch it
          console.error(
            "Off-chain verify error:",
            verifyError instanceof Error ? verifyError.message : verifyError
          );
        }
      }

      // [C3] Submit real TX to pool contract
      const { pool } = await getPool();

      // Gas estimation
      let gasEstimate: bigint;
      try {
        gasEstimate = await pool.transact.estimateGas(args, extData);
      } catch (gasError: unknown) {
        const reason =
          gasError instanceof Error ? gasError.message : "Unknown";
        return res
          .status(400)
          .json({ success: false, message: `TX would fail: ${reason}` });
      }

      // Submit TX with 20% gas buffer
      const tx = await pool.transact(args, extData, {
        gasLimit: (gasEstimate * 120n) / 100n,
      });

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        return res
          .status(500)
          .json({ success: false, message: "Transaction reverted on-chain" });
      }

      res.json({
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        fee: relayerFee.toString(),
      } satisfies RelaySubmitResponse);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("Relay error:", error);
      res.status(500).json({ success: false, message: msg });
    }
  });

  app.get("/v1/health", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return app;
}
