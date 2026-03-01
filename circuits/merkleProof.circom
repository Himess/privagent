// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// MerkleProofVerifier: verifies Merkle inclusion and outputs the computed root
// Used by JoinSplit circuit — root check is done externally (conditional for dummy inputs)
template MerkleProofVerifier(levels) {
    signal input leaf;
    signal input pathIndex;              // leaf index as a single number
    signal input pathElements[levels];
    signal output root;

    component indexBits = Num2Bits(levels);
    indexBits.in <== pathIndex;

    component hashers[levels];
    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);

        // If bit=0: hash(current, sibling)  — current is left child
        // If bit=1: hash(sibling, current)  — current is right child
        var bit = indexBits.out[i];
        hashers[i].inputs[0] <== hashes[i] + (pathElements[i] - hashes[i]) * bit;
        hashers[i].inputs[1] <== pathElements[i] + (hashes[i] - pathElements[i]) * bit;

        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[levels];
}
