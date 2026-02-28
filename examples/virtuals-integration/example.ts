/**
 * GhostPay + Virtuals Agent Integration Example
 *
 * Shows how to add private USDC payments to a Virtuals Protocol agent.
 * The agent can pay for API access without revealing amounts or identity.
 */

import { ShieldedWallet, initPoseidon } from "ghostpay-sdk";
import { ghostFetchV4 } from "ghostpay-sdk/x402";
import { JsonRpcProvider, Wallet } from "ethers";

const POOL_ADDRESS = "0x17B6209385c2e36E6095b89572273175902547f9";

async function main() {
  // 1. Initialize Poseidon hash
  await initPoseidon();

  // 2. Connect to Base Sepolia
  const provider = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const signer = new Wallet(process.env.PRIVATE_KEY!, provider);
  console.log(`Agent wallet: ${signer.address}`);

  // 3. Create shielded wallet
  const wallet = new ShieldedWallet({
    signer,
    poolAddress: POOL_ADDRESS,
    circuitWasmPath: "./circuits/joinSplit_1x2.wasm",
    circuitZkeyPath: "./circuits/joinSplit_1x2_final.zkey",
    verificationKeyPath: "./circuits/verification_key.json",
  });

  // 4. Sync existing UTXOs from chain
  await wallet.sync();
  console.log(`Shielded balance: ${wallet.getBalance()} (raw units)`);

  // 5. Deposit USDC if needed
  if (wallet.getBalance() < 2_000000n) {
    console.log("Depositing 10 USDC...");
    const tx = await wallet.deposit(10_000000n);
    console.log(`Deposit TX: ${tx.hash}`);
  }

  // 6. Make private API call
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
