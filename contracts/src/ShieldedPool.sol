// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./PoseidonHasher.sol";
import "./Groth16Verifier.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title ShieldedPool
 * @notice Privacy-preserving USDC payment pool for x402
 *
 * Flow:
 * 1. deposit(amount, commitment) — transfers USDC in, inserts commitment
 * 2. withdraw(recipient, amount, ..., proof) — ZK proof verifies note ownership,
 *    USDC split between recipient and relayer, change commitment inserted
 *
 * Public signal order (snarkjs outputs first):
 *   [0] newCommitment
 *   [1] root
 *   [2] nullifierHash
 *   [3] recipient
 *   [4] amount
 *   [5] relayer
 *   [6] fee
 */
contract ShieldedPool {
    // ============ Constants ============
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant MAX_TREE_SIZE = 2 ** TREE_DEPTH; // 1,048,576
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant ROOT_HISTORY_SIZE = 30;

    // ============ Immutables ============
    IGroth16Verifier public immutable verifier;
    PoseidonHasher public immutable poseidonHasher;
    IERC20 public immutable usdc;

    // ============ State ============
    mapping(uint256 => bytes32) public filledSubtrees;
    mapping(uint256 => bytes32) public zeros;
    mapping(uint256 => bytes32) public roots;
    uint256 public currentRootIndex;
    uint256 public nextLeafIndex;

    mapping(bytes32 => bool) public nullifiers;
    mapping(bytes32 => bool) public commitmentExists;

    // ============ Events ============
    event Deposited(
        address indexed depositor,
        uint256 amount,
        bytes32 indexed commitment,
        uint256 leafIndex
    );

    event Withdrawn(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed nullifierHash,
        bytes32 newCommitment,
        uint256 newLeafIndex,
        address relayer,
        uint256 fee
    );

    // ============ Constructor ============
    constructor(
        address _verifier,
        address _poseidonHasher,
        address _usdc
    ) {
        verifier = IGroth16Verifier(_verifier);
        poseidonHasher = PoseidonHasher(_poseidonHasher);
        usdc = IERC20(_usdc);

        // Initialize Merkle tree zeros
        bytes32 currentZero = bytes32(0);
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            zeros[i] = currentZero;
            filledSubtrees[i] = currentZero;
            currentZero = _hashPair(currentZero, currentZero);
        }
        roots[0] = currentZero;
    }

    // ============ Deposit ============
    function deposit(uint256 amount, bytes32 commitment) external {
        require(amount > 0, "Amount must be > 0");
        require(commitment != bytes32(0), "Invalid commitment");
        require(!commitmentExists[commitment], "Commitment exists");
        require(nextLeafIndex < MAX_TREE_SIZE, "Tree is full");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        uint256 leafIndex = _insertCommitment(commitment);
        commitmentExists[commitment] = true;

        emit Deposited(msg.sender, amount, commitment, leafIndex);
    }

    // ============ Withdraw ============
    function withdraw(
        address recipient,
        uint256 amount,
        bytes32 nullifierHash,
        bytes32 newCommitment,
        bytes32 merkleRoot,
        address relayer,
        uint256 fee,
        uint256[8] calldata proof
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(!nullifiers[nullifierHash], "Nullifier already used");
        require(isKnownRoot(merkleRoot), "Unknown merkle root");

        uint256 totalOut = amount + fee;
        require(usdc.balanceOf(address(this)) >= totalOut, "Insufficient liquidity");

        // Verify ZK proof on-chain
        {
            uint256[2] memory pA = [proof[0], proof[1]];
            uint256[2][2] memory pB = [[proof[2], proof[3]], [proof[4], proof[5]]];
            uint256[2] memory pC = [proof[6], proof[7]];

            // Public signal order: newCommitment, root, nullifierHash, recipient, amount, relayer, fee
            uint256[7] memory pubSignals = [
                uint256(newCommitment),
                uint256(merkleRoot),
                uint256(nullifierHash),
                uint256(uint160(recipient)),
                amount,
                uint256(uint160(relayer)),
                fee
            ];

            require(verifier.verifyProof(pA, pB, pC, pubSignals), "Invalid proof");
        }

        // Mark nullifier as used
        nullifiers[nullifierHash] = true;

        // Insert change commitment (if non-zero)
        uint256 newLeafIndex = 0;
        if (newCommitment != bytes32(0)) {
            newLeafIndex = _insertCommitment(newCommitment);
            commitmentExists[newCommitment] = true;
        }

        // Transfer USDC to recipient
        require(usdc.transfer(recipient, amount), "Recipient transfer failed");

        // Transfer fee to relayer (if any)
        if (fee > 0 && relayer != address(0)) {
            require(usdc.transfer(relayer, fee), "Relayer fee transfer failed");
        }

        emit Withdrawn(recipient, amount, nullifierHash, newCommitment, newLeafIndex, relayer, fee);
    }

    // ============ Merkle Tree ============
    function _insertCommitment(bytes32 commitment) internal returns (uint256) {
        uint256 currentIndex = nextLeafIndex;
        require(currentIndex < MAX_TREE_SIZE, "Tree is full");

        bytes32 currentHash = commitment;
        bytes32 left;
        bytes32 right;

        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                left = currentHash;
                right = zeros[i];
                filledSubtrees[i] = currentHash;
            } else {
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = _hashPair(left, right);
            currentIndex = currentIndex / 2;
        }

        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentHash;
        nextLeafIndex++;

        return nextLeafIndex - 1;
    }

    function _hashPair(bytes32 left, bytes32 right) internal view returns (bytes32) {
        return bytes32(poseidonHasher.hash2(uint256(left), uint256(right)));
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;

        uint256 i = currentRootIndex;
        do {
            if (roots[i] == root) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != currentRootIndex);

        return false;
    }

    function getLastRoot() external view returns (bytes32) {
        return roots[currentRootIndex];
    }

    function getTreeInfo() external view returns (
        uint256 _nextLeafIndex,
        uint256 _maxSize,
        bytes32 _currentRoot
    ) {
        return (nextLeafIndex, MAX_TREE_SIZE, roots[currentRootIndex]);
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
