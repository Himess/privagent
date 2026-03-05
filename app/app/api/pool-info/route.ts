import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { POOL_ADDRESS, POOL_ABI } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";
    const provider = new ethers.JsonRpcProvider(rpc);
    const poolContract = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);

    const [nextLeafIndex, lastRoot, poolBalance, protocolFeeBps, minFee, treasury] =
      await Promise.all([
        poolContract.nextLeafIndex(),
        poolContract.getLastRoot(),
        poolContract.getBalance(),
        poolContract.protocolFeeBps(),
        poolContract.minProtocolFee(),
        poolContract.treasury(),
      ]);

    return NextResponse.json({
      nextLeafIndex: nextLeafIndex.toString(),
      lastRoot,
      poolBalance: poolBalance.toString(),
      protocolFeeBps: protocolFeeBps.toString(),
      minFee: minFee.toString(),
      treasury,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Pool info API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
