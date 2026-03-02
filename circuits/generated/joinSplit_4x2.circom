pragma circom 2.0.0;

include "../joinSplit.circom";

// 4 inputs, 2 outputs, depth 20 (1M leaves)
// Large consolidation: merge four UTXOs
component main {public [root, publicAmount, extDataHash, protocolFee, inputNullifiers, outputCommitments]} = JoinSplit(4, 2, 20);
