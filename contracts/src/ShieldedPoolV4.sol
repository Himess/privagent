// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PoseidonHasher.sol";

/// @notice V4.5 TODO: Proof of Innocence
/// - Add SanctionsList oracle integration
/// - Add transactWithPOI() with dual-proof verification
/// - Add compliantDeposits tracking
/// - Add POI circuit verifier
/// See docs/POI-ROADMAP.md for full design

/**
 * @title ShieldedPool V4 — JoinSplit UTXO Privacy Pool
 * @notice Single entry point for deposits, transfers, and withdrawals.
 *         All amounts are HIDDEN via ZK proofs. UTXO model with JoinSplit.
 *
 * Architecture:
 *   - transact() is the ONLY entry point (deposit, transfer, withdraw)
 *   - Variable circuit support via IVerifier per (nIns, nOuts)
 *   - Merkle tree depth 20 (1M leaves)
 *   - extDataHash binding (recipient, relayer, fee, encrypted outputs)
 *
 * Public signal order (snarkjs — V4.4):
 *   [0] root
 *   [1] publicAmount
 *   [2] extDataHash
 *   [3] protocolFee          (circuit-enforced fee)
 *   [4..4+nIns-1] inputNullifiers
 *   [4+nIns..4+nIns+nOuts-1] outputCommitments
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
    error ZeroRecipientAmount();
    error InvalidPublicAmountRange();
    error MissingVerifiers();
    error DuplicateNullifierInBatch();
    error InvalidTreasury();
    error FeeTooHigh();
    error ViewTagCountMismatch();
    error ProtocolFeeTooLow();
    error WithdrawToSelf();
    error ZeroAddress();

    // ============ Constants ============
    uint32 public constant MERKLE_TREE_DEPTH = 20;
    uint32 public constant MAX_LEAVES = 1048576; // 2^20
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
        uint256 protocolFee;         // circuit-enforced fee (V4.4)
        bytes32[] inputNullifiers;
        bytes32[] outputCommitments;
        uint8[] viewTags;            // 1 byte per output for note scanning (V4.4)
    }

    // ============ Immutables ============
    PoseidonHasher public immutable poseidonHasher;
    IERC20 public immutable usdc;

    // ============ State ============
    // Verifiers per circuit config: key = nIns * 10 + nOuts
    mapping(uint256 => address) public verifiers;

    // Merkle tree (depth 20)
    mapping(uint256 => bytes32) public filledSubtrees;
    mapping(uint256 => bytes32) public merkleZeros;
    mapping(uint256 => bytes32) public roots;
    uint256 public currentRootIndex;
    uint256 public nextLeafIndex;

    // Nullifier tracking (global)
    mapping(bytes32 => bool) public nullifiers;

    // Protocol fee
    uint256 public protocolFeeBps = 10;       // 0.1% (basis points)
    uint256 public minProtocolFee = 10000;    // 0.01 USDC (6 decimals) — V4.4
    address public treasury;                   // fee recipient (address(0) = no fee)

    // ============ Events ============
    event NewCommitment(
        bytes32 indexed commitment,
        uint256 indexed leafIndex,
        bytes encryptedOutput,
        uint8 viewTag
    );
    event NewNullifier(bytes32 indexed nullifier);
    event PublicDeposit(address indexed depositor, uint256 amount);
    event PublicWithdraw(address indexed recipient, uint256 indexed amount, address relayer, uint256 fee); // [SC-L1]
    event ProtocolFeeCollected(uint256 indexed amount);
    event TreasuryUpdated(address indexed newTreasury);
    event ProtocolFeeUpdated(uint256 newFeeBps, uint256 newMinFee);

    // ============ Constructor ============
    constructor(
        address _poseidonHasher,
        address _usdc,
        address _verifier1x2,
        address _verifier2x2
    ) Ownable(msg.sender) {
        // [L1] Zero-address checks for critical immutables
        if (_poseidonHasher == address(0)) revert ZeroAddress();
        if (_usdc == address(0)) revert ZeroAddress();

        poseidonHasher = PoseidonHasher(_poseidonHasher);
        usdc = IERC20(_usdc);

        // Register verifiers — both required [SC-H2]
        if (_verifier1x2 == address(0) || _verifier2x2 == address(0)) revert MissingVerifiers();
        verifiers[12] = _verifier1x2; // 1*10+2
        verifiers[22] = _verifier2x2; // 2*10+2

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
    /// @notice Execute a deposit, transfer, or withdrawal via ZK proof.
    /// @param args Proof data, root, publicAmount, nullifiers, and commitments
    /// @param extData External data (recipient, relayer, fee, encrypted outputs)
    function transact(
        TransactArgs calldata args,
        ExtData calldata extData
    ) external nonReentrant whenNotPaused {
        // 1. Validate extDataHash
        if (args.extDataHash != _hashExtData(extData)) revert InvalidExtDataHash();

        // 2. Validate nullifiers (intra-tx uniqueness + storage check)
        for (uint256 i = 0; i < args.inputNullifiers.length; i++) {
            if (nullifiers[args.inputNullifiers[i]]) revert NullifierAlreadyUsed();
            for (uint256 j = i + 1; j < args.inputNullifiers.length; j++) {
                if (args.inputNullifiers[i] == args.inputNullifiers[j]) revert DuplicateNullifierInBatch();
            }
        }

        // 3. Validate root
        if (!isKnownRoot(args.root)) revert UnknownMerkleRoot();

        // 4. Validate view tags count matches outputs
        if (args.viewTags.length != args.outputCommitments.length) revert ViewTagCountMismatch();

        // 5. Validate circuit-enforced protocol fee (V4.4)
        if (treasury != address(0)) {
            if (args.publicAmount > 0) {
                uint256 expectedFee = _calculateProtocolFee(uint256(args.publicAmount));
                if (args.protocolFee < expectedFee) revert ProtocolFeeTooLow();
            } else if (args.publicAmount < 0) {
                if (args.publicAmount == type(int256).min) revert InvalidPublicAmountRange();
                uint256 expectedFee = _calculateProtocolFee(uint256(-args.publicAmount));
                if (args.protocolFee < expectedFee) revert ProtocolFeeTooLow();
            } else {
                // Private transfer: enforce minimum fee only (amount is hidden)
                if (args.protocolFee < minProtocolFee) revert ProtocolFeeTooLow();
            }
        }

        // 6. Select verifier
        uint256 configKey = args.inputNullifiers.length * 10 + args.outputCommitments.length;
        address verifierAddr = verifiers[configKey];
        if (verifierAddr == address(0)) revert UnsupportedCircuit();

        // 7. Verify ZK proof (includes protocolFee as public signal)
        uint256[] memory pubSignals = _buildPublicSignals(args);
        if (!_verifyProof(verifierAddr, args.pA, args.pB, args.pC, pubSignals)) {
            revert InvalidProof();
        }

        // 8. Mark nullifiers as spent
        for (uint256 i = 0; i < args.inputNullifiers.length; i++) {
            nullifiers[args.inputNullifiers[i]] = true;
            emit NewNullifier(args.inputNullifiers[i]);
        }

        // 9. Insert output commitments into Merkle tree (with view tags)
        for (uint256 i = 0; i < args.outputCommitments.length; i++) {
            bytes memory encOutput = i == 0 ? extData.encryptedOutput1 : extData.encryptedOutput2;
            uint256 leafIndex = _insertLeaf(args.outputCommitments[i]);
            emit NewCommitment(args.outputCommitments[i], leafIndex, encOutput, args.viewTags[i]);
        }

        // 10. Handle public amount + circuit-enforced fee
        if (args.publicAmount > 0) {
            // Deposit
            uint256 depositAmount = uint256(args.publicAmount);
            if (depositAmount > MAX_DEPOSIT) revert InvalidPublicAmount();
            if (args.protocolFee > 0 && treasury != address(0)) {
                if (!usdc.transferFrom(msg.sender, address(this), depositAmount - args.protocolFee)) revert TransferFailed();
                if (!usdc.transferFrom(msg.sender, treasury, args.protocolFee)) revert TransferFailed();
                emit ProtocolFeeCollected(args.protocolFee);
            } else {
                if (!usdc.transferFrom(msg.sender, address(this), depositAmount)) revert TransferFailed();
            }
            emit PublicDeposit(msg.sender, depositAmount);
        } else if (args.publicAmount < 0) {
            // Withdraw
            // Circuit enforces: sumInputs + publicAmount = sumOutputs + protocolFee
            // → pool releases |publicAmount| + protocolFee total USDC
            uint256 withdrawAmount = uint256(-args.publicAmount);
            uint256 totalOutflow = withdrawAmount + args.protocolFee;
            if (totalOutflow > usdc.balanceOf(address(this))) revert InsufficientPoolBalance();
            if (extData.fee >= withdrawAmount) revert FeeExceedsAmount();

            uint256 recipientAmount = withdrawAmount - extData.fee;
            if (recipientAmount == 0) revert ZeroRecipientAmount();
            if (extData.recipient == address(0)) revert InvalidRecipient();
            if (extData.recipient == address(this)) revert WithdrawToSelf(); // [M8]
            if (!usdc.transfer(extData.recipient, recipientAmount)) revert TransferFailed();

            if (extData.fee > 0) {
                if (extData.relayer == address(0)) revert RelayerRequiredForFee();
                if (!usdc.transfer(extData.relayer, extData.fee)) revert TransferFailed();
            }
            // protocolFee comes from pool surplus (circuit-enforced UTXO deduction)
            if (args.protocolFee > 0 && treasury != address(0)) {
                if (!usdc.transfer(treasury, args.protocolFee)) revert TransferFailed();
                emit ProtocolFeeCollected(args.protocolFee);
            }
            emit PublicWithdraw(extData.recipient, withdrawAmount, extData.relayer, extData.fee);
        } else {
            // Private transfer (publicAmount == 0):
            // Circuit enforces: sum(inputs) = sum(outputs) + protocolFee
            // Surplus stays in pool → transfer to treasury
            if (args.protocolFee > 0 && treasury != address(0)) {
                if (!usdc.transfer(treasury, args.protocolFee)) revert TransferFailed();
                emit ProtocolFeeCollected(args.protocolFee);
            }
        }
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
        // Modulo FIELD_SIZE ensures the hash fits in the BN254 scalar field [SC-L3]
        return bytes32(uint256(hash) % FIELD_SIZE);
    }

    /// @notice Compute extDataHash for a given ExtData (public wrapper for testing)
    function hashExtData(ExtData calldata extData) external pure returns (bytes32) {
        return _hashExtData(extData);
    }

    // ============ Public Signals Builder ============
    function _buildPublicSignals(TransactArgs calldata args) internal pure returns (uint256[] memory) {
        uint256 nIns = args.inputNullifiers.length;
        uint256 nOuts = args.outputCommitments.length;
        uint256[] memory signals = new uint256[](4 + nIns + nOuts);

        // [0] root, [1] publicAmount, [2] extDataHash, [3] protocolFee
        signals[0] = uint256(args.root);

        // publicAmount: positive for deposit, field-wrapped negative for withdraw
        if (args.publicAmount >= 0) {
            signals[1] = uint256(args.publicAmount);
        } else {
            if (args.publicAmount == type(int256).min) revert InvalidPublicAmountRange(); // [SC-H4]
            signals[1] = FIELD_SIZE - uint256(-args.publicAmount);
        }

        signals[2] = uint256(args.extDataHash);
        signals[3] = args.protocolFee;

        // [4..4+nIns-1] nullifiers
        for (uint256 i = 0; i < nIns; i++) {
            signals[4 + i] = uint256(args.inputNullifiers[i]);
        }

        // [4+nIns..4+nIns+nOuts-1] commitments
        for (uint256 i = 0; i < nOuts; i++) {
            signals[4 + nIns + i] = uint256(args.outputCommitments[i]);
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
        // For 1x2: uint[7] (root, pubAmount, extDataHash, protocolFee, 1 null, 2 commits)
        // For 2x2: uint[8] (root, pubAmount, extDataHash, protocolFee, 2 nulls, 2 commits)
        uint256 len = pubSignals.length;
        bytes memory callData;

        if (len == 7) {
            uint256[7] memory fixed7;
            for (uint256 i = 0; i < 7; i++) fixed7[i] = pubSignals[i];
            callData = abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[7])",
                pA, pB, pC, fixed7
            );
        } else if (len == 8) {
            uint256[8] memory fixed8;
            for (uint256 i = 0; i < 8; i++) fixed8[i] = pubSignals[i];
            callData = abi.encodeWithSignature(
                "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[8])",
                pA, pB, pC, fixed8
            );
        } else {
            revert UnsupportedCircuit(); // [SC-C1] explicit error instead of silent false
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

    /// @notice Check if a root is in the recent history ring buffer. [SC-M1] refactored
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        for (uint256 j = 0; j < ROOT_HISTORY_SIZE; j++) {
            uint256 idx = (currentRootIndex + ROOT_HISTORY_SIZE - j) % ROOT_HISTORY_SIZE;
            if (roots[idx] == root) return true;
        }
        return false;
    }

    /// @notice Return the most recent Merkle root
    function getLastRoot() external view returns (bytes32) {
        return roots[currentRootIndex];
    }

    // ============ Admin ============
    /// @notice Update verifier for a circuit config. Pass address(0) to remove. [SC-M3]
    function setVerifier(uint256 nIns, uint256 nOuts, address verifierAddr) external onlyOwner {
        if (verifierAddr != address(0)) {
            uint256 size;
            assembly { size := extcodesize(verifierAddr) }
            require(size > 0, "Not a contract");
        }
        verifiers[nIns * 10 + nOuts] = verifierAddr;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Set the treasury address for protocol fee collection
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Update protocol fee parameters. Max 1% fee, max 0.1 USDC min fee.
    function setProtocolFee(uint256 _feeBps, uint256 _minFee) external onlyOwner {
        if (_feeBps > 100) revert FeeTooHigh();     // max 1%
        if (_minFee > 100000) revert FeeTooHigh();   // max 0.1 USDC
        protocolFeeBps = _feeBps;
        minProtocolFee = _minFee;
        emit ProtocolFeeUpdated(_feeBps, _minFee);
    }

    // ============ View ============
    /// @notice Return (nextLeafIndex, maxLeaves, currentRoot)
    function getTreeInfo() external view returns (uint256, uint256, bytes32) {
        return (nextLeafIndex, MAX_LEAVES, roots[currentRootIndex]);
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ============ Protocol Fee ============
    function _calculateProtocolFee(uint256 amount) internal view returns (uint256) {
        if (treasury == address(0)) return 0;
        uint256 percentFee = (amount * protocolFeeBps) / 10000;
        return percentFee > minProtocolFee ? percentFee : minProtocolFee;
    }

    /// @notice Emergency withdrawal — only when paused. [SC-M4]
    function emergencyWithdraw(address to) external onlyOwner whenPaused {
        if (to == address(0)) revert InvalidRecipient();
        uint256 balance = usdc.balanceOf(address(this));
        if (balance > 0) {
            if (!usdc.transfer(to, balance)) revert TransferFailed();
        }
    }
}
