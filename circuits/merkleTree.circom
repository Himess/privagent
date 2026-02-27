pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";

// Verifies Merkle inclusion for a leaf at a given path
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);

        // pathIndices[i] is 0 or 1
        // If 0: hash(current, sibling)  — current is left
        // If 1: hash(sibling, current)  — current is right
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i].inputs[0] <== hashes[i] + (pathElements[i] - hashes[i]) * pathIndices[i];
        hashers[i].inputs[1] <== pathElements[i] + (hashes[i] - pathElements[i]) * pathIndices[i];

        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[levels];
}
