// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PoseidonHasher.sol";

/**
 * @title ShieldedPool V4 — JoinSplit UTXO Privacy Pool
 * @notice Single entry point for deposits, transfers, and withdrawals.
 *         All amounts are HIDDEN via ZK proofs. UTXO model with JoinSplit.
 *
 * Architecture:
 *   - transact() is the ONLY entry point (deposit, transfer, withdraw)
 *   - Variable circuit support via IVerifier per (nIns, nOuts)
 *   - Merkle tree depth 16 (65K leaves), multi-tree rollover
 *   - extDataHash binding (recipient, relayer, fee, encrypted outputs)
 *
 * Public signal order (snarkjs):
 *   [0] root
 *   [1] publicAmount
 *   [2] extDataHash
 *   [3..3+nIns-1] inputNullifiers
 *   [3+nIns..3+nIns+nOuts-1] outputCommitments
 */

interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[] calldata _pubSignals
    ) external view returns (bool);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ShieldedPoolV4 is ReentrancyGuard, Pausable, Ownable {
    // ============ Errors ============
    error InvalidExtDataHash();
    error NullifierAlreadyUsed();
    error UnknownMerkleRoot();
    error UnsupportedCircuit();
    error InvalidProof();
    error InvalidRecipient();
    error FeeExceedsAmount();
    error RelayerRequiredForFee();
    error TransferFailed();
    error TreeFull();
    error InvalidPublicAmount();
    error InsufficientPoolBalance();

    // ============ Constants ============
    uint32 public constant MERKLE_TREE_DEPTH = 16;
    uint32 public constant MAX_LEAVES = 65536; // 2^16
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant ROOT_HISTORY_SIZE = 100;
    uint256 public constant MAX_DEPOSIT = 1_000_000_000_000; // 1M USDC

    // ============ Structs ============
    struct ExtData {
        address recipient;       // withdraw recipient (or address(0) for transfer)
        address relayer;
        uint256 fee;
        bytes encryptedOutput1;  // encrypted UTXO data for output 1
        bytes encryptedOutput2;  // encrypted UTXO data for output 2
    }

    struct TransactArgs {
        uint256[2] pA;
        uint256[2][2] pB;
        uint256[2] pC;
        bytes32 root;
        int256 publicAmount;
        bytes32 extDataHash;
        bytes32[] inputNullifiers;
        bytes32[] outputCommitments;
    }

    // ============ Immutables ============
    PoseidonHasher public immutable poseidonHasher;
    IERC20 public immutable usdc;

    // ============ State ============
    // Verifiers per circuit config: key = nIns * 10 + nOuts
    mapping(uint256 => address) public verifiers;

    // Merkle tree (depth 16)
    mapping(uint256 => bytes32) public filledSubtrees;
    mapping(uint256 => bytes32) public merkleZeros;
    mapping(uint256 => bytes32) public roots;
    uint256 public currentRootIndex;
    uint256 public nextLeafIndex;

    // Nullifier tracking (global)
    mapping(bytes32 => bool) public nullifiers;

    // ============ Events ============
    event NewCommitment(
        bytes32 indexed commitment,
        uint256 indexed leafIndex,
        bytes encryptedOutput
    );
    event NewNullifier(bytes32 indexed nullifier);
    event PublicDeposit(address indexed depositor, uint256 amount);
    event PublicWithdraw(address indexed recipient, uint256 amount, address relayer, uint256 fee);

    // ============ Constructor ============
    constructor(
        address _poseidonHasher,
        address _usdc,
        address _verifier1x2,
        address _verifier2x2
    ) Ownable(msg.sender) {
        poseidonHasher = PoseidonHasher(_poseidonHasher);
        usdc = IERC20(_usdc);

        // Register verifiers
        if (_verifier1x2 != address(0)) verifiers[12] = _verifier1x2; // 1*10+2
        if (_verifier2x2 != address(0)) verifiers[22] = _verifier2x2; // 2*10+2

        // Initialize Merkle tree zeros
        bytes32 currentZero = bytes32(0);
        for (uint256 i = 0; i < MERKLE_TREE_DEPTH; i++) {
            merkleZeros[i] = currentZero;
            filledSubtrees[i] = currentZero;
            currentZero = _hashPair(currentZero, currentZero);
        }
        roots[0] = currentZero;
    }

    // ============ transact() — SINGLE ENTRY POINT ============
    function transact(
        TransactArgs calldata args,
        ExtData calldata extData
    ) external nonReentrant whenNotPaused {
        // 1. Validate extDataHash
        if (args.extDataHash != _hashExtData(extData)) revert InvalidExtDataHash();

        // 2. Validate nullifiers
        for (uint256 i = 0; i < args.inputNullifiers.length; i++) {
            if (nullifiers[args.inputNullifiers[i]]) revert NullifierAlreadyUsed();
        }

        // 3. Validate root
        if (!isKnownRoot(args.root)) revert UnknownMerkleRoot();

        // 4. Select verifier
        uint256 configKey = args.inputNullifiers.length * 10 + args.outputCommitments.length;
        address verifierAddr = verifiers[configKey];
        if (verifierAddr == address(0)) revert UnsupportedCircuit();

        // 5. Verify ZK proof
        uint256[] memory pubSignals = _buildPublicSignals(args);
        if (!_verifyProof(verifierAddr, args.pA, args.pB, args.pC, pubSignals)) {
            revert InvalidProof();
        }

        // 6. Mark nullifiers as spent
        for (uint256 i = 0; i < args.inputNullifiers.length; i++) {
            nullifiers[args.inputNullifiers[i]] = true;
            emit NewNullifier(args.inputNullifiers[i]);
        }

        // 7. Insert output commitments into Merkle tree
        for (uint256 i = 0; i < args.outputCommitments.length; i++) {
            bytes memory encOutput = i == 0 ? extData.encryptedOutput1 : extData.encryptedOutput2;
            uint256 leafIndex = _insertLeaf(args.outputCommitments[i]);
            emit NewCommitment(args.outputCommitments[i], leafIndex, encOutput);
        }

        // 8. Handle public amount
        if (args.publicAmount > 0) {
            // Deposit
            uint256 depositAmount = uint256(args.publicAmount);
            if (depositAmount > MAX_DEPOSIT) revert InvalidPublicAmount();
            if (!usdc.transferFrom(msg.sender, address(this), depositAmount)) {
                revert TransferFailed();
            }
            emit PublicDeposit(msg.sender, depositAmount);
        } else if (args.publicAmount < 0) {
            // Withdraw
            uint256 withdrawAmount = uint256(-args.publicAmount);
            if (withdrawAmount > usdc.balanceOf(address(this))) revert InsufficientPoolBalance();
            if (extData.fee > withdrawAmount) revert FeeExceedsAmount();

            uint256 recipientAmount = withdrawAmount - extData.fee;
            if (extData.recipient == address(0)) revert InvalidRecipient();
            if (!usdc.transfer(extData.recipient, recipientAmount)) revert TransferFailed();

            if (extData.fee > 0) {
                if (extData.relayer == address(0)) revert RelayerRequiredForFee();
                if (!usdc.transfer(extData.relayer, extData.fee)) revert TransferFailed();
            }
            emit PublicWithdraw(extData.recipient, withdrawAmount, extData.relayer, extData.fee);
        }
        // publicAmount == 0: pure private transfer (no USDC movement)
    }

    // ============ extDataHash ============
    function _hashExtData(ExtData calldata extData) internal pure returns (bytes32) {
        bytes32 hash = keccak256(abi.encode(
            extData.recipient,
            extData.relayer,
            extData.fee,
            keccak256(extData.encryptedOutput1),
            keccak256(extData.encryptedOutput2)
        ));
        return bytes32(uint256(hash) % FIELD_SIZE);
    }

    function hashExtData(ExtData calldata extData) external pure returns (bytes32) {
        return _hashExtData(extData);
    }

    // ============ Public Signals Builder ============
    function _buildPublicSignals(TransactArgs calldata args) internal pure returns (uint256[] memory) {
        uint256 nIns = args.inputNullifiers.length;
        uint256 nOuts = args.outputCommitments.length;
        uint256[] memory signals = new uint256[](3 + nIns + nOuts);

        // [0] root, [1] publicAmount, [2] extDataHash
        signals[0] = uint256(args.root);

        // publicAmount: positive for deposit, field-wrapped negative for withdraw
        if (args.publicAmount >= 0) {
            signals[1] = uint256(args.publicAmount);
        } else {
            signals[1] = FIELD_SIZE - uint256(-args.publicAmount);
        }

        signals[2] = uint256(args.extDataHash);

        // [3..3+nIns-1] nullifiers
        for (uint256 i = 0; i < nIns; i++) {
            signals[3 + i] = uint256(args.inputNullifiers[i]);
        }

        // [3+nIns..3+nIns+nOuts-1] commitments
        for (uint256 i = 0; i < nOuts; i++) {
            signals[3 + nIns + i] = uint256(args.outputCommitments[i]);
        }

        return signals;
    }

    // ============ Proof Verification ============
    function _verifyProof(
        address verifierAddr,
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[] memory pubSignals
    ) internal view returns (bool) {
        // The snarkjs-generated verifier uses fixed-size arrays.
        // We need to call it with the right signature based on pubSignals length.
        // For 1x2: uint[6] (root, pubAmount, extDataHash, 1 null, 2 commits)
        // For 2x2: uint[7] (root, pubAmount, extDataHash, 2 nulls, 2 commits)
        uint256 len = pubSignals.length;
        bytes memory callData;

        if (len == 6) {
            uint256[6] memory fixed6;
            for (uint256 i = 0; i < 6; i++) fixed6[i] = pubSignals[i];
            callData = abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[6])",
                pA, pB, pC, fixed6
            );
        } else if (len == 7) {
            uint256[7] memory fixed7;
            for (uint256 i = 0; i < 7; i++) fixed7[i] = pubSignals[i];
            callData = abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[7])",
                pA, pB, pC, fixed7
            );
        } else {
            return false;
        }

        (bool success, bytes memory result) = verifierAddr.staticcall(callData);
        if (!success || result.length < 32) return false;
        return abi.decode(result, (bool));
    }

    // ============ Merkle Tree ============
    function _insertLeaf(bytes32 leaf) internal returns (uint256) {
        uint256 currentIndex = nextLeafIndex;
        if (currentIndex >= MAX_LEAVES) revert TreeFull();

        bytes32 currentHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint256 i = 0; i < MERKLE_TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                left = currentHash;
                right = merkleZeros[i];
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

    // ============ Admin ============
    function setVerifier(uint256 nIns, uint256 nOuts, address verifierAddr) external onlyOwner {
        verifiers[nIns * 10 + nOuts] = verifierAddr;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ============ View ============
    function getTreeInfo() external view returns (uint256, uint256, bytes32) {
        return (nextLeafIndex, MAX_LEAVES, roots[currentRootIndex]);
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
