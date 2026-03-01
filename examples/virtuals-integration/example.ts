/**
 * GhostPay + Virtuals Agent Integration Example
 *
 * Shows how to add private USDC payments to a Virtuals Protocol agent.
 * The agent can pay for API access without revealing amounts or identity.
 */

import { ShieldedWallet } from "ghostpay-sdk";
import { ghostFetchV4 } from "ghostpay-sdk/x402";
import { JsonRpcProvider, Wallet } from "ethers";

const POOL_ADDRESS = "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  // 1. Connect to Base Sepolia
  const provider = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const signer = new Wallet(process.env.PRIVATE_KEY!, provider);
  console.log(`Agent wallet: ${signer.address}`);

  // 2. Create shielded wallet
  const wallet = new ShieldedWallet({
    provider,
    signer,
    poolAddress: POOL_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    circuitDir: "./circuits/build",
    deployBlock: 22580000,
  });

  await wallet.initialize();

  // 3. Sync existing UTXOs from chain
  await wallet.syncTree();
  console.log(`Shielded balance: ${wallet.getBalance()} (raw units)`);

  // 4. Deposit USDC if needed
  if (wallet.getBalance() < 2_000000n) {
    console.log("Depositing 10 USDC...");
    const result = await wallet.deposit(10_000000n);
    console.log(`Deposit TX: ${result.txHash}`);
  }

  // 5. Make private API call
  console.log("Calling paid API with private payment...");
  const response = await ghostFetchV4(
    "https://api.example.com/premium/weather",
    wallet
  );

  if (response.ok) {
    const data = await response.json();
    console.log("Weather data:", data);
    console.log(`Remaining balance: ${wallet.getBalance()}`);
  }
}

main().catch(console.error);
