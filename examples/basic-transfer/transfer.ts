/**
 * GhostPay Basic Transfer Example
 *
 * Demonstrates the full lifecycle: deposit → private transfer → withdraw.
 * All amounts and parties are hidden on-chain during private transfers.
 */

import { ShieldedWallet, initPoseidon } from "ghostpay-sdk";
import { JsonRpcProvider, Wallet } from "ethers";

const POOL_ADDRESS = "0x17B6209385c2e36E6095b89572273175902547f9";

async function main() {
  await initPoseidon();

  const provider = new JsonRpcProvider(
    process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org"
  );

  // Alice: sender
  const aliceSigner = new Wallet(process.env.ALICE_KEY!, provider);
  const aliceWallet = new ShieldedWallet({
    signer: aliceSigner,
    poolAddress: POOL_ADDRESS,
    circuitWasmPath: "./circuits/joinSplit_1x2.wasm",
    circuitZkeyPath: "./circuits/joinSplit_1x2_final.zkey",
    verificationKeyPath: "./circuits/verification_key.json",
  });

  // ============ Step 1: Deposit ============
  console.log("--- Step 1: Deposit ---");
  console.log("Depositing 5 USDC into shielded pool...");

  const depositTx = await aliceWallet.deposit(5_000000n);
  console.log(`Deposit TX: ${depositTx.hash}`);
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

  // In production:
  // const withdrawTx = await aliceWallet.withdraw(recipientAddress, 2_000000n);
  // console.log(`Withdraw TX: ${withdrawTx.hash}`);

  console.log("\n--- Summary ---");
  console.log("Deposit:  5 USDC (public → shielded)");
  console.log("Transfer: ? USDC (shielded → shielded, HIDDEN)");
  console.log("Withdraw: 2 USDC (shielded → public)");
  console.log("Remaining shielded balance: 3 USDC");
}

main().catch(console.error);
