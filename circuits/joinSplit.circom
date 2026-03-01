// Copyright (c) 2026 GhostPay Contributors — BUSL-1.1
pragma circom 2.0.0;

include "merkleProof.circom";
include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/**
 * GhostPay V4 — JoinSplit UTXO Circuit
 *
 * Based on Tornado Cash Nova's transaction.circom pattern.
 * Proves ownership of input UTXOs and creates new output UTXOs
 * while conserving balance. All amounts are HIDDEN.
 *
 * Public signals:
 *   root              — Merkle tree root (proves inputs exist)
 *   publicAmount      — external amount (>0 deposit, <0 withdraw, 0 transfer)
 *   extDataHash       — hash of external data (recipient, relayer, fee, encrypted outputs)
 *   inputNullifiers[] — one per input (prevents double-spend)
 *   outputCommitments[] — one per output (new UTXOs)
 *
 * Privacy:
 *   - Amounts: HIDDEN (private signals)
 *   - Sender: HIDDEN (privateKey never exposed, nullifier unlinkable)
 *   - Receiver: HIDDEN (pubkey in commitment, encrypted in extData)
 */

// Keypair: publicKey = Poseidon(privateKey)
template Keypair() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

// UTXO commitment: Poseidon(amount, pubkey, blinding)
template UTXOCommitment() {
    signal input amount;
    signal input pubkey;
    signal input blinding;
    signal output commitment;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== pubkey;
    hasher.inputs[2] <== blinding;
    commitment <== hasher.out;
}

// Nullifier: Poseidon(commitment, pathIndex, privateKey)
template NullifierHasher() {
    signal input commitment;
    signal input pathIndex;
    signal input privateKey;
    signal output nullifier;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== pathIndex;
    hasher.inputs[2] <== privateKey;
    nullifier <== hasher.out;
}

/**
 * JoinSplit(nIns, nOuts, levels)
 *
 * nIns:   number of input UTXOs (1-4)
 * nOuts:  number of output UTXOs (1-4)
 * levels: Merkle tree depth (16)
 *
 * Balance conservation: sum(inputs) + publicAmount === sum(outputs)
 */
template JoinSplit(nIns, nOuts, levels) {
    // === PUBLIC SIGNALS ===
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input inputNullifiers[nIns];
    signal input outputCommitments[nOuts];

    // === PRIVATE SIGNALS — per input UTXO ===
    signal input inAmount[nIns];
    signal input inPrivateKey[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns];
    signal input inPathElements[nIns][levels];

    // === PRIVATE SIGNALS — per output UTXO ===
    signal input outAmount[nOuts];
    signal input outPubkey[nOuts];
    signal input outBlinding[nOuts];

    // === COMPONENTS ===
    component inKeypair[nIns];
    component inCommitmentHasher[nIns];
    component inNullifierHasher[nIns];
    component inTree[nIns];
    component inRootCheck[nIns];
    component inAmountCheck[nIns];

    component outCommitmentHasher[nOuts];
    component outAmountCheck[nOuts];

    var sumIns = 0;
    var sumOuts = 0;

    // === VERIFY INPUTS ===
    for (var i = 0; i < nIns; i++) {
        // 1. Derive publicKey from privateKey
        inKeypair[i] = Keypair();
        inKeypair[i].privateKey <== inPrivateKey[i];

        // 2. Compute commitment = Poseidon(amount, pubkey, blinding)
        inCommitmentHasher[i] = UTXOCommitment();
        inCommitmentHasher[i].amount <== inAmount[i];
        inCommitmentHasher[i].pubkey <== inKeypair[i].publicKey;
        inCommitmentHasher[i].blinding <== inBlinding[i];

        // 3. Compute nullifier = Poseidon(commitment, pathIndex, privateKey)
        inNullifierHasher[i] = NullifierHasher();
        inNullifierHasher[i].commitment <== inCommitmentHasher[i].commitment;
        inNullifierHasher[i].pathIndex <== inPathIndices[i];
        inNullifierHasher[i].privateKey <== inPrivateKey[i];
        inputNullifiers[i] === inNullifierHasher[i].nullifier;

        // 4. Merkle proof — compute root from leaf + path
        inTree[i] = MerkleProofVerifier(levels);
        inTree[i].leaf <== inCommitmentHasher[i].commitment;
        inTree[i].pathIndex <== inPathIndices[i];
        for (var j = 0; j < levels; j++) {
            inTree[i].pathElements[j] <== inPathElements[i][j];
        }

        // 5. Conditional root check — skip for dummy inputs (amount=0)
        //    Tornado Nova pattern: ForceEqualIfEnabled
        inRootCheck[i] = ForceEqualIfEnabled();
        inRootCheck[i].in[0] <== root;
        inRootCheck[i].in[1] <== inTree[i].root;
        inRootCheck[i].enabled <== inAmount[i];

        // 6. Range check: 0 <= amount < 2^120
        inAmountCheck[i] = Num2Bits(120);
        inAmountCheck[i].in <== inAmount[i];

        sumIns += inAmount[i];
    }

    // === VERIFY OUTPUTS ===
    for (var i = 0; i < nOuts; i++) {
        // 1. Compute commitment = Poseidon(amount, pubkey, blinding)
        outCommitmentHasher[i] = UTXOCommitment();
        outCommitmentHasher[i].amount <== outAmount[i];
        outCommitmentHasher[i].pubkey <== outPubkey[i];
        outCommitmentHasher[i].blinding <== outBlinding[i];
        outputCommitments[i] === outCommitmentHasher[i].commitment;

        // 2. Range check: 0 <= amount < 2^120
        outAmountCheck[i] = Num2Bits(120);
        outAmountCheck[i].in <== outAmount[i];

        sumOuts += outAmount[i];
    }

    // === BALANCE CONSERVATION ===
    // sum(inputs) + publicAmount === sum(outputs)
    // publicAmount > 0: deposit (extra money coming in from public)
    // publicAmount < 0: withdraw (money going out to public)
    // publicAmount = 0: private transfer (no public USDC movement)
    sumIns + publicAmount === sumOuts;

    // === BIND EXTERNAL DATA ===
    // extDataHash prevents front-running and binds recipient/fee/encrypted notes to proof.
    // IMPORTANT: This quadratic constraint is REQUIRED. Without it, extDataHash would be an
    // unconstrained public input — any value would satisfy the proof, breaking the binding.
    // Pattern from Tornado Cash Nova: forces the optimizer to keep extDataHash constrained.
    signal extDataHashSquare;
    extDataHashSquare <== extDataHash * extDataHash;
}
