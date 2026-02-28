// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PoseidonHasher.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[7] calldata _pubSignals
    ) external view returns (bool);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title ShieldedPool V3
 * @notice Privacy-preserving USDC payment pool for x402
 *
 * V3 Changes:
 *   - H1: ReentrancyGuard on deposit/withdraw
 *   - H3: Pausable + Ownable for emergency stop
 *   - M1: ROOT_HISTORY_SIZE = 100
 *   - L2: Custom errors
 *   - L1: Better event indexing
 *   - C7: commitment = Poseidon(amount, nullifierSecret, randomness) — circuit enforced
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
contract ShieldedPool is ReentrancyGuard, Pausable, Ownable {
    // ============ Errors ============
    error ZeroAmount();
    error InvalidCommitment();
    error TreeFull();
    error TransferFailed();
    error InvalidRecipient();
    error NullifierAlreadyUsed();
    error UnknownMerkleRoot();
    error InsufficientPoolBalance();
    error InvalidProof();
    error ExceedsMaxDeposit();
    error DuplicateCommitment();
    error RelayerRequiredForFee();

    // ============ Constants ============
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant MAX_TREE_SIZE = 2 ** TREE_DEPTH; // 1,048,576
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant ROOT_HISTORY_SIZE = 100; // M1: increased from 30
    uint256 public constant MAX_DEPOSIT = 1_000_000_000_000; // 1M USDC (6 decimals)

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
        bytes32 indexed commitment,
        uint256 indexed leafIndex,
        uint256 amount,
        uint256 timestamp
    );

    event Withdrawn(
        bytes32 indexed nullifierHash,
        address indexed recipient,
        address relayer,
        uint256 fee
    );

    event NewCommitment(
        bytes32 indexed commitment,
        uint256 indexed leafIndex
    );

    // ============ Constructor ============
    constructor(
        address _verifier,
        address _poseidonHasher,
        address _usdc
    ) Ownable(msg.sender) {
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
    function deposit(uint256 amount, bytes32 commitment) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_DEPOSIT) revert ExceedsMaxDeposit();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitmentExists[commitment]) revert DuplicateCommitment();
        if (nextLeafIndex >= MAX_TREE_SIZE) revert TreeFull();

        // C7: commitment = Poseidon(amount, nullifierSecret, randomness)
        // On-chain cannot verify (nullifierSecret is private)
        // Circuit enforces: commitment preimage includes correct balance
        // If attacker fakes balance: commitment won't be in Merkle tree with correct preimage

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        uint256 leafIndex = _insertCommitment(commitment);
        commitmentExists[commitment] = true;

        emit Deposited(commitment, leafIndex, amount, block.timestamp);
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
    ) external nonReentrant whenNotPaused {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (nullifiers[nullifierHash]) revert NullifierAlreadyUsed();
        if (!isKnownRoot(merkleRoot)) revert UnknownMerkleRoot();

        uint256 totalOut = amount + fee;
        if (usdc.balanceOf(address(this)) < totalOut) revert InsufficientPoolBalance();

        // Verify ZK proof on-chain — 7 public signals
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

            if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();
        }

        // Effects — mark nullifier as used
        nullifiers[nullifierHash] = true;

        // Insert change commitment (if non-zero)
        uint256 newLeafIndex = 0;
        if (newCommitment != bytes32(0)) {
            newLeafIndex = _insertCommitment(newCommitment);
            commitmentExists[newCommitment] = true;
            emit NewCommitment(newCommitment, newLeafIndex);
        }

        // Interactions (CEI pattern)
        if (!usdc.transfer(recipient, amount)) revert TransferFailed();

        if (fee > 0) {
            if (relayer == address(0)) revert RelayerRequiredForFee();
            if (!usdc.transfer(relayer, fee)) revert TransferFailed();
        }

        emit Withdrawn(nullifierHash, recipient, relayer, fee);
    }

    // ============ Pause (H3) ============
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Merkle Tree ============
    function _insertCommitment(bytes32 commitment) internal returns (uint256) {
        uint256 currentIndex = nextLeafIndex;
        if (currentIndex >= MAX_TREE_SIZE) revert TreeFull();

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
