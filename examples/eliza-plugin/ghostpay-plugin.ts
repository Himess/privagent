/**
 * GhostPay Plugin for ElizaOS
 *
 * Adds private USDC payment actions to an ElizaOS agent.
 * Uses JoinSplit ZK proofs to hide all transaction details.
 */

import { ShieldedWallet, initPoseidon } from "ghostpay-sdk";
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

const POOL_ADDRESS = "0x17B6209385c2e36E6095b89572273175902547f9";

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
        const tx = await wallet.deposit(amountRaw);

        return {
          success: true,
          data: { txHash: tx.hash, amount: amount },
          message: `Deposited ${amount} USDC | TX: ${tx.hash}`,
        };
      },
    },
  ],

  initialize: async () => {
    await initPoseidon();

    const provider = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
    const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

    wallet = new ShieldedWallet({
      signer,
      poolAddress: POOL_ADDRESS,
      circuitWasmPath: "./circuits/joinSplit_1x2.wasm",
      circuitZkeyPath: "./circuits/joinSplit_1x2_final.zkey",
      verificationKeyPath: "./circuits/verification_key.json",
    });

    await wallet.sync();
    console.log("[GhostPay] Plugin initialized, wallet synced");
  },
};
