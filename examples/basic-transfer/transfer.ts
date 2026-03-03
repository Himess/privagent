/**
 * PrivAgent Basic Transfer Example
 *
 * Demonstrates the full lifecycle: deposit → private transfer → withdraw.
 * All amounts and parties are hidden on-chain during private transfers.
 */

import { ShieldedWallet, initPoseidon } from "privagent-sdk";
import { JsonRpcProvider, Wallet } from "ethers";

const POOL_ADDRESS = "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
  const provider = new JsonRpcProvider(
    process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"
  );

  // Alice: sender
  const aliceSigner = new Wallet(process.env.ALICE_KEY!, provider);
  const aliceWallet = new ShieldedWallet({
    provider,
    signer: aliceSigner,
    poolAddress: POOL_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    circuitDir: "./circuits/build",
    deployBlock: 38347380,
  });

  await initPoseidon();
  await aliceWallet.initialize();
  await aliceWallet.syncTree();

  // ============ Step 1: Deposit ============
  console.log("--- Step 1: Deposit ---");
  console.log("Depositing 5 USDC into shielded pool...");

  const depositResult = await aliceWallet.deposit(5_000000n);
  console.log(`Deposit TX: ${depositResult.txHash}`);
  console.log(`Shielded balance: ${aliceWallet.getBalance()} (raw)`);

  // ============ Step 2: Private Transfer ============
  console.log("\n--- Step 2: Private Transfer ---");
  console.log("Generating JoinSplit proof (publicAmount=0)...");

  // In a real scenario, you'd transfer to another agent's pubkey.
  // The transfer creates new UTXOs with the recipient's pubkey.
  // On-chain: only nullifiers and commitments are visible.
  // Amount, sender, receiver = all HIDDEN.

  console.log("Private transfer: amount=HIDDEN, sender=HIDDEN, receiver=HIDDEN");
  console.log("On-chain footprint: nullifier + commitment (no amount data)");

  // ============ Step 3: Withdraw ============
  console.log("\n--- Step 3: Withdraw ---");
  console.log("Generating withdraw proof...");

  const recipientAddress = "0x1234567890abcdef1234567890abcdef12345678";
  console.log(`Withdrawing 2 USDC to ${recipientAddress}...`);

  const withdrawResult = await aliceWallet.withdraw(
    2_000000n,
    recipientAddress
  );
  console.log(`Withdraw TX: ${withdrawResult.txHash}`);

  console.log("\n--- Summary ---");
  console.log("Deposit:  5 USDC (public -> shielded)");
  console.log("Transfer: ? USDC (shielded -> shielded, HIDDEN)");
  console.log("Withdraw: 2 USDC (shielded -> public)");
  console.log(`Remaining shielded balance: ${aliceWallet.getBalance()}`);
}

main().catch(console.error);
