pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkleTree.circom";

/**
 * Private Payment Circuit for GhostPay
 *
 * Proves: "I own a note in the Merkle tree with sufficient balance,
 *          and I'm spending `amount` to `recipient` with `fee` to `relayer`,
 *          producing a change commitment."
 *
 * Public signals (outputs first in snarkjs):
 *   [0] newCommitment  (output)
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
    signal input randomness;
    signal input nullifierSecret;
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

    // 1. Compute commitment = Poseidon(balance, randomness)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== balance;
    commitmentHasher.inputs[1] <== randomness;
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

    // 4. Amount + fee must not exceed balance
    signal totalSpend;
    totalSpend <== amount + fee;
    component balanceCheck = LessEqThan(252);
    balanceCheck.in[0] <== totalSpend;
    balanceCheck.in[1] <== balance;
    balanceCheck.out === 1;

    // 5. Amount must be > 0
    component amountNonZero = IsZero();
    amountNonZero.in <== amount;
    amountNonZero.out === 0;

    // 6. Compute change = balance - amount - fee
    signal change;
    change <== balance - amount - fee;

    // 7. Compute new commitment = Poseidon(change, newRandomness)
    component newCommitmentHasher = Poseidon(2);
    newCommitmentHasher.inputs[0] <== change;
    newCommitmentHasher.inputs[1] <== newRandomness;
    newCommitment <== newCommitmentHasher.out;

    // 8. Constrain recipient and relayer to prevent tampering
    //    (public inputs are inherently constrained, but we add
    //     a square constraint to prevent the optimizer from removing them)
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
    signal relayerSquare;
    relayerSquare <== relayer * relayer;
}

component main {public [root, nullifierHash, recipient, amount, relayer, fee]} = PrivatePayment(20);
