// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { getWallet, ok, fail, parseAmount, formatUSDC, parseCliArgs } from "./_wallet.js";

export async function run(args: Record<string, string>): Promise<string> {
  try {
    const amountStr = args.amount;
    const recipient = args.recipient;

    if (!amountStr || !recipient) {
      return fail("Both --amount and --recipient are required");
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      return fail("Invalid Ethereum address format");
    }

    let rawAmount: bigint;
    try {
      rawAmount = parseAmount(amountStr);
    } catch {
      return fail("Invalid amount. Must be a positive number.");
    }

    const wallet = await getWallet();
    const result = await wallet.withdraw(rawAmount, recipient);

    const remainingBalance = wallet.getBalance();

    return ok({
      action: "withdraw",
      amount: amountStr,
      recipient,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      remainingBalanceUSDC: formatUSDC(remainingBalance),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Withdrawal failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("withdraw.ts")) {
  const args = parseCliArgs(process.argv.slice(2));
  run(args).then(console.log);
}
