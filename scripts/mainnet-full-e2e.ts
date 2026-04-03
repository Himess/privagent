// Mainnet full E2E: deposit → withdraw (same wallet instance)
import { ethers } from "ethers";
import { ShieldedWallet } from "../sdk/src/v4/shieldedWallet.js";
import { initPoseidon } from "../sdk/src/poseidon.js";
import { FIELD_SIZE } from "../sdk/src/types.js";
import path from "path";

const RPC = "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const POOL = "0x02Ee3eCDb9791dad9a169A5C4F52Fc53318bEf2D";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function main() {
  await initPoseidon();

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = signer.address;
  console.log("Address:", address);

  const poseidonKey = BigInt(ethers.keccak256(ethers.toUtf8Bytes("privagent:" + PRIVATE_KEY))) % FIELD_SIZE;

  const wallet = new ShieldedWallet(
    {
      provider,
      signer,
      poolAddress: POOL,
      usdcAddress: USDC,
      circuitDir: path.resolve(__dirname, "../circuits/build"),
      deployBlock: 44230980,
    },
    poseidonKey
  );
  await wallet.initialize();
  console.log("Syncing tree...");
  await wallet.syncTree();

  const usdcContract = new ethers.Contract(USDC, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);

  const before = await usdcContract.balanceOf(address);
  console.log("USDC before:", before.toString());

  // === DEPOSIT 50000 (0.05 USDC) ===
  const depositAmount = 50000n;
  console.log(`\n=== DEPOSIT ${depositAmount} (0.05 USDC) ===`);
  const dep = await wallet.deposit(depositAmount);
  console.log("TX:", dep.txHash);
  console.log("Shielded:", wallet.getBalance().toString());

  // Small delay for RPC
  await new Promise(r => setTimeout(r, 3000));

  // === WITHDRAW 5000 (0.005 USDC) ===
  const withdrawAmount = 5000n;
  console.log(`\n=== WITHDRAW ${withdrawAmount} (0.005 USDC) ===`);
  const wd = await wallet.withdraw(withdrawAmount, address);
  console.log("TX:", wd.txHash);
  console.log("Shielded after:", wallet.getBalance().toString());

  const after = await usdcContract.balanceOf(address);
  console.log("\nUSDC after:", after.toString());
  console.log("\n=== E2E COMPLETE — DEPOSIT + WITHDRAW ON BASE MAINNET ===");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
