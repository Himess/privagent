// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { Contract } from "ethers";
import { getWallet, getProvider, getSigner, ok, fail } from "./_wallet.js";
import { BASE_SEPOLIA_USDC } from "privagent-sdk";

const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];
const DEFAULT_POOL = "0x8F1ae8209156C22dFD972352A415880040fB0b0c";

export async function run(): Promise<string> {
  try {
    const provider = getProvider();
    const signer = getSigner();
    const address = await signer.getAddress();

    const ethBalance = await provider.getBalance(address);
    const usdc = new Contract(BASE_SEPOLIA_USDC, USDC_ABI, provider);
    const usdcBalance: bigint = await usdc.balanceOf(address);

    const wallet = await getWallet();

    return ok({
      action: "info",
      network: "Base Sepolia",
      poolAddress: process.env.POOL_ADDRESS || DEFAULT_POOL,
      walletAddress: address,
      ethBalance: ethBalance.toString(),
      usdcBalance: usdcBalance.toString(),
      poseidonPublicKey: wallet.publicKey.toString(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Info failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("info.ts")) {
  run().then(console.log);
}
