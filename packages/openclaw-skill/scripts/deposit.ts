// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { getWallet, ok, fail, parseAmount, formatUSDC, parseCliArgs } from "./_wallet.js";

export async function run(args: Record<string, string>): Promise<string> {
  try {
    const amountStr = args.amount;
    if (!amountStr) {
      return fail("--amount is required");
    }

    let rawAmount: bigint;
    try {
      rawAmount = parseAmount(amountStr);
    } catch {
      return fail("Invalid amount. Must be a positive number.");
    }

    const wallet = await getWallet();
    const result = await wallet.deposit(rawAmount);

    const newBalance = wallet.getBalance();

    return ok({
      action: "deposit",
      amount: amountStr,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      newBalanceUSDC: formatUSDC(newBalance),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Deposit failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("deposit.ts")) {
  const args = parseCliArgs(process.argv.slice(2));
  run(args).then(console.log);
}
