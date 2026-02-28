pragma circom 2.0.0;

include "../joinSplit.circom";

// 2 inputs, 2 outputs, depth 16
// Consolidation: merge two UTXOs into payment + change
component main {public [root, publicAmount, extDataHash, inputNullifiers, outputCommitments]} = JoinSplit(2, 2, 16);
