// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PoseidonT3.sol";

/**
 * @title PoseidonHasher
 * @notice Wrapper contract for Poseidon hash, compatible with circomlibjs
 * @dev Uses PoseidonT3 library with exact constants from circomlib
 */
contract PoseidonHasher {
    function hash2(uint256 a, uint256 b) external pure returns (uint256) {
        uint256[2] memory inputs = [a, b];
        return PoseidonT3.hash(inputs);
    }

    function poseidon(uint256[2] memory inputs) external pure returns (uint256) {
        return PoseidonT3.hash(inputs);
    }
}
