import {
  GameWorker,
  GameFunction,
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { JsonRpcProvider, Wallet } from "ethers";
import {
  ShieldedWallet,
  initPoseidon,
  keypairFromPrivateKey,
  BASE_SEPOLIA_USDC,
} from "privagent-sdk";
import type { ShieldedWalletConfig } from "privagent-sdk";

// ============================================================================
// Types
// ============================================================================

export interface IPrivAgentPluginOptions {
  id?: string;
  name?: string;
  description?: string;
  credentials: {
    privateKey: string; // ETH private key (hex, for gas + USDC approval)
    poseidonPrivateKey: string; // Poseidon private key (bigint string, for ZK proofs)
    rpcUrl?: string; // Base Sepolia RPC (default: https://sepolia.base.org)
    poolAddress?: string; // ShieldedPoolV4 address
    usdcAddress?: string; // USDC address
    circuitDir: string; // Path to circuits/build directory
    deployBlock?: number; // Block to start scanning (default: 38347380)
  };
}

const DEFAULT_POOL = "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
const DEFAULT_DEPLOY_BLOCK = 38347380;

// ============================================================================
// Plugin
// ============================================================================

class PrivAgentPlugin {
  private id: string;
  private name: string;
  private description: string;
  private wallet: ShieldedWallet | null = null;
  private initPromise: Promise<void> | null = null;
  private credentials: IPrivAgentPluginOptions["credentials"];

  constructor(options: IPrivAgentPluginOptions) {
    this.id = options.id || "privagent_worker";
    this.name = options.name || "PrivAgent Privacy Worker";
    this.description =
      options.description ||
      "Manages private USDC payments using ZK proofs on Base. Can deposit, transfer privately, withdraw, and check shielded balance.";
    this.credentials = options.credentials;

    if (!this.credentials.privateKey) {
      throw new Error("ETH private key is required");
    }
    if (!this.credentials.poseidonPrivateKey) {
      throw new Error("Poseidon private key is required");
    }
    if (!this.credentials.circuitDir) {
      throw new Error("Circuit directory path is required");
    }
  }

  // Lazy-init wallet singleton
  private async getWallet(): Promise<ShieldedWallet> {
    if (!this.initPromise) {
      this.initPromise = this.initWallet();
    }
    await this.initPromise;
    return this.wallet!;
  }

  private async initWallet(): Promise<void> {
    await initPoseidon();

    const rpc = this.credentials.rpcUrl || "https://sepolia.base.org";
    const provider = new JsonRpcProvider(rpc);
    const signer = new Wallet(this.credentials.privateKey, provider);

    this.wallet = new ShieldedWallet(
      {
        provider,
        signer,
        poolAddress: this.credentials.poolAddress || DEFAULT_POOL,
        usdcAddress: this.credentials.usdcAddress || BASE_SEPOLIA_USDC,
        circuitDir: this.credentials.circuitDir,
        deployBlock: this.credentials.deployBlock || DEFAULT_DEPLOY_BLOCK,
      },
      BigInt(this.credentials.poseidonPrivateKey)
    );

    await this.wallet.initialize();
    await this.wallet.syncTree();
  }

  // ============================================================================
  // GameFunction: privagent_deposit
  // ============================================================================

  get depositFunction() {
    const self = this;
    return new GameFunction({
      name: "privagent_deposit",
      description:
        "Deposit USDC into the PrivAgent shielded pool. Converts public USDC into private shielded USDC using a ZK proof. Amount is in USDC (e.g. '2' for 2 USDC).",
      args: [
        {
          name: "amount",
          description:
            "Amount of USDC to deposit (e.g. '2' for 2 USDC, '0.5' for 0.5 USDC)",
        },
      ] as const,
      executable: async (args, logger) => {
        try {
          const amountStr = args.amount;
          if (!amountStr) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Amount is required"
            );
          }

          // Parse USDC amount (6 decimals)
          const amountFloat = parseFloat(amountStr);
          if (isNaN(amountFloat) || amountFloat <= 0) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Invalid amount. Must be a positive number."
            );
          }
          const rawAmount = BigInt(Math.round(amountFloat * 1_000_000));

          logger(`Depositing ${amountStr} USDC (${rawAmount} raw units)...`);

          const wallet = await self.getWallet();
          const result = await wallet.deposit(rawAmount);

          logger(`Deposit confirmed: TX ${result.txHash}`);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              action: "deposit",
              amount: amountStr,
              txHash: result.txHash,
              blockNumber: result.blockNumber,
              newBalance: wallet.getBalance().toString(),
            })
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `Deposit failed: ${msg}`
          );
        }
      },
    });
  }

  // ============================================================================
  // GameFunction: privagent_transfer
  // ============================================================================

  get transferFunction() {
    const self = this;
    return new GameFunction({
      name: "privagent_transfer",
      description:
        "Privately transfer shielded USDC to another agent. The transfer is completely private — amount, sender, and receiver are hidden on-chain. Requires the recipient's Poseidon public key.",
      args: [
        {
          name: "amount",
          description: "Amount of USDC to transfer (e.g. '1' for 1 USDC)",
        },
        {
          name: "recipient_pubkey",
          description:
            "Recipient's Poseidon public key (bigint string). This is NOT an Ethereum address.",
        },
      ] as const,
      executable: async (args, logger) => {
        try {
          const amountStr = args.amount;
          const recipientPubkeyStr = args.recipient_pubkey;

          if (!amountStr || !recipientPubkeyStr) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Both amount and recipient_pubkey are required"
            );
          }

          const amountFloat = parseFloat(amountStr);
          if (isNaN(amountFloat) || amountFloat <= 0) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Invalid amount"
            );
          }
          const rawAmount = BigInt(Math.round(amountFloat * 1_000_000));
          const recipientPubkey = BigInt(recipientPubkeyStr);

          logger(
            `Generating private transfer proof for ${amountStr} USDC...`
          );

          const wallet = await self.getWallet();
          const proof = await wallet.generateTransferProof(
            rawAmount,
            recipientPubkey
          );

          logger("Proof generated. Submitting on-chain...");

          const result = await wallet.submitTransact(proof);

          logger(`Transfer confirmed: TX ${result.txHash}`);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              action: "private_transfer",
              amount: amountStr,
              txHash: result.txHash,
              blockNumber: result.blockNumber,
              remainingBalance: wallet.getBalance().toString(),
            })
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `Transfer failed: ${msg}`
          );
        }
      },
    });
  }

  // ============================================================================
  // GameFunction: privagent_withdraw
  // ============================================================================

  get withdrawFunction() {
    const self = this;
    return new GameFunction({
      name: "privagent_withdraw",
      description:
        "Withdraw shielded USDC from the privacy pool to a regular Ethereum address. Converts private USDC back to public USDC.",
      args: [
        {
          name: "amount",
          description: "Amount of USDC to withdraw (e.g. '1' for 1 USDC)",
        },
        {
          name: "recipient",
          description:
            "Ethereum address to receive the USDC (e.g. '0x1234...')",
        },
      ] as const,
      executable: async (args, logger) => {
        try {
          const amountStr = args.amount;
          const recipient = args.recipient;

          if (!amountStr || !recipient) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Both amount and recipient address are required"
            );
          }

          if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Invalid Ethereum address format"
            );
          }

          const amountFloat = parseFloat(amountStr);
          if (isNaN(amountFloat) || amountFloat <= 0) {
            return new ExecutableGameFunctionResponse(
              ExecutableGameFunctionStatus.Failed,
              "Invalid amount"
            );
          }
          const rawAmount = BigInt(Math.round(amountFloat * 1_000_000));

          logger(`Withdrawing ${amountStr} USDC to ${recipient}...`);

          const wallet = await self.getWallet();
          const result = await wallet.withdraw(rawAmount, recipient);

          logger(`Withdrawal confirmed: TX ${result.txHash}`);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              action: "withdraw",
              amount: amountStr,
              recipient,
              txHash: result.txHash,
              blockNumber: result.blockNumber,
              remainingBalance: wallet.getBalance().toString(),
            })
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `Withdrawal failed: ${msg}`
          );
        }
      },
    });
  }

  // ============================================================================
  // GameFunction: privagent_balance
  // ============================================================================

  get balanceFunction() {
    const self = this;
    return new GameFunction({
      name: "privagent_balance",
      description:
        "Check the current shielded USDC balance and UTXO count. Syncs with on-chain state before returning.",
      args: [] as const,
      executable: async (_args, logger) => {
        try {
          logger("Syncing tree and checking balance...");

          const wallet = await self.getWallet();
          await wallet.syncTree();

          const balance = wallet.getBalance();
          const utxos = wallet.getUTXOs();
          const balanceUSDC = (Number(balance) / 1_000_000).toFixed(2);

          logger(`Shielded balance: ${balanceUSDC} USDC (${utxos.length} UTXOs)`);

          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
              action: "balance",
              shieldedBalance: balance.toString(),
              shieldedBalanceUSDC: balanceUSDC,
              utxoCount: utxos.length,
              publicKey: wallet.publicKey.toString(),
            })
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `Balance check failed: ${msg}`
          );
        }
      },
    });
  }

  // ============================================================================
  // Worker
  // ============================================================================

  public getWorker(data?: {
    functions?: GameFunction<any>[];
    getEnvironment?: () => Promise<Record<string, any>>;
  }): GameWorker {
    const self = this;
    return new GameWorker({
      id: this.id,
      name: this.name,
      description: this.description,
      functions: data?.functions || [
        this.depositFunction,
        this.transferFunction,
        this.withdrawFunction,
        this.balanceFunction,
      ],
      getEnvironment:
        data?.getEnvironment ||
        (async () => {
          try {
            const wallet = await self.getWallet();
            const balance = wallet.getBalance();
            return {
              shielded_balance_usdc: (Number(balance) / 1_000_000).toFixed(2),
              utxo_count: wallet.getUTXOs().length,
              network: "Base Sepolia",
              pool_address: self.credentials.poolAddress || DEFAULT_POOL,
            };
          } catch {
            return {
              shielded_balance_usdc: "unknown",
              utxo_count: 0,
              network: "Base Sepolia",
              pool_address: self.credentials.poolAddress || DEFAULT_POOL,
            };
          }
        }),
    });
  }
}

export default PrivAgentPlugin;
export { PrivAgentPlugin };
