// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RejectVerifier {
    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[7] calldata
    ) external pure returns (bool) {
        return false;
    }
}
