pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkleTree.circom";

/**
 * Private Payment Circuit for GhostPay V3
 *
 * Proves: "I own a note in the Merkle tree with sufficient balance,
 *          and I'm spending `amount` to `recipient` with `fee` to `relayer`,
 *          producing a change commitment (or 0 for full-spend)."
 *
 * V3 Changes:
 *   - C6 FIX: commitment = Poseidon(balance, nullifierSecret, randomness) — 3-input
 *   - C2 FIX: conditional newCommitment (0 when change=0, hash when change>0)
 *   - C7 FIX: amount bound in commitment via circuit enforcement
 *   - M2 FIX: LessEqThan(64) instead of LessEqThan(252)
 *
 * Public signals (7 — output first in snarkjs):
 *   [0] newCommitment  (output, conditional)
 *   [1] root
 *   [2] nullifierHash
 *   [3] recipient
 *   [4] amount
 *   [5] relayer
 *   [6] fee
 */
template PrivatePayment(levels) {
    // === Private inputs ===
    signal input balance;
    signal input nullifierSecret;
    signal input randomness;
    signal input newBalance;           // declared change amount
    signal input newNullifierSecret;
    signal input newRandomness;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // === Public inputs ===
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;
    signal input relayer;
    signal input fee;

    // === Output ===
    signal output newCommitment;

    // 1. Compute commitment = Poseidon(balance, nullifierSecret, randomness)
    //    C6 FIX: nullifierSecret is now part of commitment
    //    C7 FIX: balance (amount) is bound to commitment
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== balance;
    commitmentHasher.inputs[1] <== nullifierSecret;
    commitmentHasher.inputs[2] <== randomness;
    signal commitment;
    commitment <== commitmentHasher.out;

    // 2. Verify Merkle inclusion
    component merkleChecker = MerkleTreeChecker(levels);
    merkleChecker.leaf <== commitment;
    for (var i = 0; i < levels; i++) {
        merkleChecker.pathElements[i] <== pathElements[i];
        merkleChecker.pathIndices[i] <== pathIndices[i];
    }
    merkleChecker.root === root;

    // 3. Verify nullifier hash = Poseidon(nullifierSecret, commitment)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifierSecret;
    nullifierHasher.inputs[1] <== commitment;
    nullifierHasher.out === nullifierHash;

    // 4. Amount + fee must not exceed balance (M2 FIX: 64-bit is sufficient for USDC)
    signal totalSpend;
    totalSpend <== amount + fee;
    component balanceCheck = LessEqThan(64);
    balanceCheck.in[0] <== totalSpend;
    balanceCheck.in[1] <== balance;
    balanceCheck.out === 1;

    // 5. Amount must be > 0
    component amountNonZero = IsZero();
    amountNonZero.in <== amount;
    amountNonZero.out === 0;

    // 6. Compute change and verify it matches declared newBalance
    signal change;
    change <== balance - amount - fee;
    change === newBalance;

    // 7. Compute new commitment with conditional logic (C2 FIX)
    //    change > 0: newCommitment = Poseidon(newBalance, newNullifierSecret, newRandomness)
    //    change = 0: newCommitment = 0 (full-spend)
    component newCommitmentHasher = Poseidon(3);
    newCommitmentHasher.inputs[0] <== newBalance;
    newCommitmentHasher.inputs[1] <== newNullifierSecret;
    newCommitmentHasher.inputs[2] <== newRandomness;

    component isZeroChange = IsZero();
    isZeroChange.in <== change;

    // If change=0 → isZero=1 → (1-1)*hash = 0
    // If change>0 → isZero=0 → (1-0)*hash = hash
    signal expectedNewCommitment;
    expectedNewCommitment <== (1 - isZeroChange.out) * newCommitmentHasher.out;
    newCommitment <== expectedNewCommitment;

    // 8. Constrain recipient and relayer to prevent optimizer removal
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    signal relayerSquare;
    relayerSquare <== relayer * relayer;
}

component main {public [root, nullifierHash, recipient, amount, relayer, fee]} = PrivatePayment(20);
