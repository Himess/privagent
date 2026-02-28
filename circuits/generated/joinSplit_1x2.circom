pragma circom 2.0.0;

include "../joinSplit.circom";

// 1 input, 2 outputs, depth 16
// Most common: single UTXO payment + change
component main {public [root, publicAmount, extDataHash, inputNullifiers, outputCommitments]} = JoinSplit(1, 2, 16);
