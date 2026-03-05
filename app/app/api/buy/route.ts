import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getWallet, resyncWallet, getServerSigner } from "@/lib/wallet";

export const maxDuration = 60;

function toBytes32(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const amount = BigInt(body.amount || "1000000"); // Default: 1 USDC

    // Re-sync tree to pick up any confirmed deposits
    await resyncWallet();
    const wallet = await getWallet();

    const balance = wallet.getBalance();
    if (balance < amount) {
      return NextResponse.json(
        {
          error: `Insufficient shielded balance: ${balance.toString()} < ${amount.toString()}. Deposit first.`,
          shieldedBalance: balance.toString(),
        },
        { status: 400 }
      );
    }

    // Withdraw to server address (relayer pattern: pool -> server -> API response)
    const signer = getServerSigner();
    const serverAddr = await signer.getAddress();
    const result = await wallet.withdraw(amount, serverAddr);

    // Mock weather data (the "product" being purchased)
    const weatherData = {
      location: "Istanbul, TR",
      temperature: 18 + Math.floor(Math.random() * 10),
      condition: ["Sunny", "Partly Cloudy", "Clear", "Overcast"][Math.floor(Math.random() * 4)],
      humidity: 40 + Math.floor(Math.random() * 40),
      wind: Math.floor(Math.random() * 30) + " km/h",
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json({
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      nullifiers: result.nullifiers.map((n) => n.toString()),
      commitments: result.commitments.map((c) => c.toString()),
      root: toBytes32(wallet.getTree().getRoot()),
      weatherData,
      shieldedBalance: wallet.getBalance().toString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Buy API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
