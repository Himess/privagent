// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

/**
 * @title Groth16Verifier
 * @notice Placeholder — replace with `snarkjs zkey export solidityverifier` output
 *         after running `circuits/scripts/build.sh`
 *
 * Public signal order (snarkjs puts outputs first):
 *   [0] newCommitment
 *   [1] root
 *   [2] nullifierHash
 *   [3] recipient
 *   [4] amount
 *   [5] relayer
 *   [6] fee
 */
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[7] calldata _pubSignals
    ) external view returns (bool);
}

contract Groth16Verifier is IGroth16Verifier {
    // Placeholder: always returns true for testing
    // MUST be replaced with real verifier before mainnet deploy
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[7] calldata
    ) external pure override returns (bool) {
        return true;
    }
}
