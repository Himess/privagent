// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock verifier for 1x2 JoinSplit (6 public signals) — always returns true
contract MockVerifier1x2 {
    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[6] calldata
    ) external pure returns (bool) {
        return true;
    }
}
