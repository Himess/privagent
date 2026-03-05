import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { POOL_ADDRESS, POOL_ABI } from "@/lib/contracts";
import { getWallet, resyncWallet, getProvider } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await resyncWallet();
    const wallet = await getWallet();
    const provider = getProvider();

    const poolContract = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
    const [poolBalance, lastRoot] = await Promise.all([
      poolContract.getBalance(),
      poolContract.getLastRoot(),
    ]);

    return NextResponse.json({
      shieldedBalance: wallet.getBalance().toString(),
      utxoCount: wallet.getUTXOs().length,
      poolBalance: poolBalance.toString(),
      lastRoot,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Balance API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
