/**
 * GhostPay Plugin for ElizaOS
 *
 * Adds private USDC payment actions to an ElizaOS agent.
 * Uses JoinSplit ZK proofs to hide all transaction details.
 */

import { ShieldedWallet } from "ghostpay-sdk";
import { ghostFetchV4 } from "ghostpay-sdk/x402";
import { JsonRpcProvider, Wallet } from "ethers";

// ElizaOS plugin interface (simplified)
interface Action {
  name: string;
  description: string;
  handler: (context: ActionContext) => Promise<ActionResult>;
}

interface ActionContext {
  params: Record<string, string>;
  getService: (name: string) => unknown;
}

interface ActionResult {
  success: boolean;
  data?: unknown;
  message?: string;
}

interface Plugin {
  name: string;
  actions: Action[];
  initialize: () => Promise<void>;
}

const POOL_ADDRESS = "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

let wallet: ShieldedWallet;

export const ghostPayPlugin: Plugin = {
  name: "ghostpay",

  actions: [
    {
      name: "PRIVATE_PAY",
      description: "Make a private payment to access a paid API endpoint",
      handler: async (ctx: ActionContext): Promise<ActionResult> => {
        const url = ctx.params.url;
        if (!url) return { success: false, message: "URL required" };

        const response = await ghostFetchV4(url, wallet);
        if (response.ok) {
          const data = await response.json();
          return { success: true, data };
        }
        return { success: false, message: `Payment failed: ${response.status}` };
      },
    },

    {
      name: "CHECK_BALANCE",
      description: "Check the agent's shielded USDC balance",
      handler: async (): Promise<ActionResult> => {
        const balance = wallet.getBalance();
        const formatted = (Number(balance) / 1_000000).toFixed(2);
        return {
          success: true,
          data: { balance: formatted, raw: balance.toString() },
          message: `Shielded balance: ${formatted} USDC`,
        };
      },
    },

    {
      name: "DEPOSIT",
      description: "Deposit USDC into the shielded pool",
      handler: async (ctx: ActionContext): Promise<ActionResult> => {
        const amount = ctx.params.amount;
        if (!amount) return { success: false, message: "Amount required (in USDC)" };

        const amountRaw = BigInt(Math.floor(parseFloat(amount) * 1_000000));
        const result = await wallet.deposit(amountRaw);

        return {
          success: true,
          data: { txHash: result.txHash, amount: amount },
          message: `Deposited ${amount} USDC | TX: ${result.txHash}`,
        };
      },
    },
  ],

  initialize: async () => {
    const provider = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
    const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

    wallet = new ShieldedWallet({
      provider,
      signer,
      poolAddress: POOL_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      circuitDir: "./circuits/build",
      deployBlock: 22580000,
    });

    await wallet.initialize();
    await wallet.syncTree();
    console.log("[GhostPay] Plugin initialized, wallet synced");
  },
};
