import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { POOL_ADDRESS, USDC_ADDRESS } from "@/lib/contracts";
import { getWallet, getSDK, getPoseidonKey, addPendingDeposit } from "@/lib/wallet";

export const maxDuration = 60;

function toBytes32(value: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

export async function POST(request: Request) {
  try {
    const { amount } = await request.json();
    if (!amount) {
      return NextResponse.json({ error: "amount required" }, { status: 400 });
    }

    const depositAmount = BigInt(amount);
    const sdk = await getSDK();
    await sdk.initPoseidon(); // Ensure Poseidon is ready before any crypto ops
    const wallet = await getWallet();
    const keypair = sdk.keypairFromPrivateKey(BigInt(getPoseidonKey()));

    const extData = {
      recipient: ethers.ZeroAddress,
      relayer: ethers.ZeroAddress,
      fee: 0n,
      encryptedOutput1: new Uint8Array([0xaa]),
      encryptedOutput2: new Uint8Array([0xbb]),
    };

    const extDataHash = sdk.computeExtDataHash(extData);

    // Get protocol fee params
    const feeParams = await wallet.getProtocolFeeParams();
    const protocolFee = sdk.ShieldedWallet.calculateProtocolFee(
      depositAmount,
      feeParams.feeBps,
      feeParams.minFee,
      feeParams.treasury !== ethers.ZeroAddress
    );

    // Create output UTXOs
    const dummyInput = sdk.createDummyUTXO();
    const depositUTXO = sdk.createUTXO(depositAmount - protocolFee, keypair.publicKey);
    const dummyOutput = sdk.createUTXO(0n, keypair.publicKey);

    // Generate ZK proof (server-side, fast ~1-2s)
    const proofResult = await sdk.generateJoinSplitProof(
      {
        inputs: [dummyInput],
        outputs: [depositUTXO, dummyOutput],
        publicAmount: depositAmount,
        protocolFee,
        tree: wallet.getTree(),
        extDataHash,
        privateKey: keypair.privateKey,
      },
      wallet.circuitDir
    );

    // Extract public signals
    const ps = proofResult.proofData.publicSignals;
    const nIns = proofResult.nIns;
    const nOuts = proofResult.nOuts;
    const nullifiers = ps.slice(4, 4 + nIns).map((n) => toBytes32(n));
    const commitments = ps.slice(4 + nIns, 4 + nIns + nOuts).map((c) => toBytes32(c));

    // Generate view tags
    const viewTags = [depositUTXO, dummyOutput].map((u) =>
      sdk.generateViewTag(keypair.privateKey, u.pubkey, u.blinding)
    );

    // Store pending deposit for later registration
    addPendingDeposit({
      amount: depositUTXO.amount.toString(),
      pubkey: depositUTXO.pubkey.toString(),
      blinding: depositUTXO.blinding.toString(),
      commitment: depositUTXO.commitment.toString(),
    });

    // Calculate approval amount (deposit + protocol fee)
    const totalApproval = depositAmount + protocolFee;

    // Return calldata for MetaMask to sign
    return NextResponse.json({
      args: {
        pA: [proofResult.proofData.pA[0].toString(), proofResult.proofData.pA[1].toString()],
        pB: proofResult.proofData.pB.map((row) => row.map((v) => v.toString())),
        pC: [proofResult.proofData.pC[0].toString(), proofResult.proofData.pC[1].toString()],
        root: toBytes32(ps[0]),
        publicAmount: depositAmount.toString(),
        extDataHash: toBytes32(extDataHash),
        protocolFee: protocolFee.toString(),
        inputNullifiers: nullifiers,
        outputCommitments: commitments,
        viewTags,
      },
      extData: {
        recipient: extData.recipient,
        relayer: extData.relayer,
        fee: "0",
        encryptedOutput1: "0xaa",
        encryptedOutput2: "0xbb",
      },
      approvalAmount: totalApproval.toString(),
      poolAddress: POOL_ADDRESS,
      usdcAddress: USDC_ADDRESS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Deposit API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
