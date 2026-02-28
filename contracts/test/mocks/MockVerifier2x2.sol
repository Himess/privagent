// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock verifier for 2x2 JoinSplit (7 public signals) — always returns true
contract MockVerifier2x2 {
    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[7] calldata
    ) external pure returns (bool) {
        return true;
    }
}
