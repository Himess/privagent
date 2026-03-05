// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { getWallet, ok, fail, formatUSDC } from "./_wallet.js";

export async function run(): Promise<string> {
  try {
    const wallet = await getWallet();
    await wallet.syncTree();

    const balance = wallet.getBalance();
    const utxos = wallet.getUTXOs();

    return ok({
      action: "balance",
      shieldedBalance: balance.toString(),
      shieldedBalanceUSDC: formatUSDC(balance),
      utxoCount: utxos.length,
      publicKey: wallet.publicKey.toString(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Balance check failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("balance.ts")) {
  run().then(console.log);
}
