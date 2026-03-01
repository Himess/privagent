pragma circom 2.0.0;

include "../joinSplit.circom";

// 2 inputs, 2 outputs, depth 20 (1M leaves)
// Consolidation: merge two UTXOs into payment + change
component main {public [root, publicAmount, extDataHash, protocolFee, inputNullifiers, outputCommitments]} = JoinSplit(2, 2, 20);
