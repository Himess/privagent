// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
import { getWallet, ok, fail, parseAmount, formatUSDC, parseCliArgs } from "./_wallet.js";

export async function run(args: Record<string, string>): Promise<string> {
  try {
    const amountStr = args.amount;
    const pubkeyStr = args.pubkey;

    if (!amountStr || !pubkeyStr) {
      return fail("Both --amount and --pubkey are required");
    }

    let rawAmount: bigint;
    try {
      rawAmount = parseAmount(amountStr);
    } catch {
      return fail("Invalid amount. Must be a positive number.");
    }

    let recipientPubkey: bigint;
    try {
      recipientPubkey = BigInt(pubkeyStr);
    } catch {
      return fail("Invalid pubkey. Must be a valid bigint string.");
    }

    const wallet = await getWallet();
    const proof = await wallet.generateTransferProof(rawAmount, recipientPubkey);
    const result = await wallet.submitTransact(proof);

    const remainingBalance = wallet.getBalance();

    return ok({
      action: "private_transfer",
      amount: amountStr,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      remainingBalanceUSDC: formatUSDC(remainingBalance),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Transfer failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("transfer.ts")) {
  const args = parseCliArgs(process.argv.slice(2));
  run(args).then(console.log);
}
