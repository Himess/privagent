// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1
// 4-Account Demo: Shows Poseidon keypairs, commitments, and nullifiers
// Usage: npx tsx scripts/demo-4accounts.ts

import {
  initPoseidon,
  derivePublicKey,
  createUTXO,
  computeNullifierV4,
} from "../sdk/src/index.js";

async function main() {
  await initPoseidon();

  // 4 deterministic private keys for demo
  const accounts = [
    { name: "Alice (Agent A)", privateKey: 777n },
    { name: "Bob (Agent B)", privateKey: 888n },
    { name: "Charlie (Server)", privateKey: 999n },
    { name: "Dave (Relayer)", privateKey: 1111n },
  ];

  console.log("=".repeat(80));
  console.log("PrivAgent 4-Account Demo — Poseidon Keypairs & Commitments");
  console.log("=".repeat(80));

  for (const acc of accounts) {
    const publicKey = derivePublicKey(acc.privateKey);
    console.log(`\n--- ${acc.name} ---`);
    console.log(`  Private Key:  ${acc.privateKey}`);
    console.log(`  Public Key:   ${publicKey}`);
    console.log(`  PubKey (hex): 0x${publicKey.toString(16).padStart(64, "0")}`);

    // Create an example UTXO: 1 USDC to this account
    const utxo = createUTXO(1_000_000n, publicKey);
    console.log(`\n  Example UTXO (1 USDC):`);
    console.log(`    amount:     ${utxo.amount} (1 USDC)`);
    console.log(`    pubkey:     ${utxo.pubkey}`);
    console.log(`    blinding:   ${utxo.blinding}`);
    console.log(`    commitment: ${utxo.commitment}`);
    console.log(
      `    commit hex: 0x${utxo.commitment.toString(16).padStart(64, "0")}`
    );

    // Compute nullifier (if this UTXO were at leaf index 0)
    const nullifier = computeNullifierV4(utxo.commitment, 0, acc.privateKey);
    console.log(`    nullifier:  ${nullifier}`);
    console.log(
      `    null hex:   0x${nullifier.toString(16).padStart(64, "0")}`
    );
  }

  // Show what an observer sees
  console.log("\n" + "=".repeat(80));
  console.log("ON-CHAIN VISIBILITY (What a blockchain observer sees):");
  console.log("=".repeat(80));

  const alice = derivePublicKey(777n);
  const bob = derivePublicKey(888n);

  // Alice sends 1 USDC to Bob
  const paymentUTXO = createUTXO(1_000_000n, bob); // Bob's pubkey inside
  const changeUTXO = createUTXO(500_000n, alice); // Alice's change

  console.log("\nScenario: Alice sends 1 USDC to Bob (0.5 USDC change)");
  console.log("\nObserver sees on-chain:");
  console.log(
    `  commitment_1: 0x${paymentUTXO.commitment.toString(16).padStart(64, "0")}`
  );
  console.log(
    `  commitment_2: 0x${changeUTXO.commitment.toString(16).padStart(64, "0")}`
  );
  console.log(`  publicAmount: 0 (private transfer)`);
  console.log(`  protocolFee:  10000 (0.01 USDC)`);

  console.log("\nObserver CANNOT determine:");
  console.log("  - commitment_1 is 1 USDC (amount hidden in hash)");
  console.log("  - commitment_1 belongs to Bob (pubkey hidden in hash)");
  console.log("  - commitment_2 is 0.5 USDC change to Alice");
  console.log("  - Which input UTXO was spent (nullifier is unlinkable)");

  console.log("\nObserver CAN determine:");
  console.log("  - A JoinSplit transaction occurred");
  console.log("  - publicAmount=0 → this is a private transfer (not deposit/withdraw)");
  console.log("  - 0.01 USDC protocol fee was collected");
  console.log("  - 2 new commitments were created");
  console.log(
    "  - The relayer address (msg.sender) — NOT the actual sender/recipient"
  );

  // Show that same amount + same pubkey = DIFFERENT commitment (due to blinding)
  console.log("\n" + "=".repeat(80));
  console.log("BLINDING FACTOR DEMO — Same inputs, different commitments:");
  console.log("=".repeat(80));

  const utxo1 = createUTXO(1_000_000n, bob);
  const utxo2 = createUTXO(1_000_000n, bob);
  const utxo3 = createUTXO(1_000_000n, bob);

  console.log("\n3 UTXOs: all 1 USDC to Bob, all DIFFERENT commitments:");
  console.log(
    `  UTXO 1: 0x${utxo1.commitment.toString(16).padStart(64, "0")}`
  );
  console.log(
    `  UTXO 2: 0x${utxo2.commitment.toString(16).padStart(64, "0")}`
  );
  console.log(
    `  UTXO 3: 0x${utxo3.commitment.toString(16).padStart(64, "0")}`
  );
  console.log(
    "\n→ Observer cannot tell these all have the same amount and recipient!"
  );
  console.log("→ Each has a random blinding factor making the hash unique.");
}

main().catch(console.error);
