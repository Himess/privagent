/**
 * GhostPay Plugin for ElizaOS
 *
 * Adds private USDC payment actions to an ElizaOS agent.
 * Uses JoinSplit ZK proofs to hide all transaction details.
 */

import { ShieldedWallet, initPoseidon } from "ghostpay-sdk";
import { createGhostFetchV4 } from "ghostpay-sdk/x402";
import { JsonRpcProvider, Wallet } from "ethers";
import { randomBytes } from "crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

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

const POOL_ADDRESS = "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

let wallet: ShieldedWallet;
let ecdhPrivateKey: Uint8Array;
let ecdhPublicKey: Uint8Array;

export const ghostPayPlugin: Plugin = {
  name: "ghostpay",

  actions: [
    {
      name: "PRIVATE_PAY",
      description: "Make a private payment to access a paid API endpoint",
      handler: async (ctx: ActionContext): Promise<ActionResult> => {
        const url = ctx.params.url;
        if (!url) return { success: false, message: "URL required" };

        const ghostFetch = createGhostFetchV4(wallet, ecdhPrivateKey, ecdhPublicKey);
        const response = await ghostFetch(url);
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

    ecdhPrivateKey = randomBytes(32);
    ecdhPublicKey = secp256k1.getPublicKey(ecdhPrivateKey, true);

    wallet = new ShieldedWallet({
      provider,
      signer,
      poolAddress: POOL_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      circuitDir: "./circuits/build",
      deployBlock: 38347380,
    });

    await initPoseidon();
    await wallet.initialize();
    await wallet.syncTree();
    console.log("[GhostPay] Plugin initialized, wallet synced");
  },
};
