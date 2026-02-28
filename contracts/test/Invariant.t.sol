// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ShieldedPoolV4.sol";
import "../src/PoseidonHasher.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/MockVerifier1x2.sol";
import "./mocks/MockVerifier2x2.sol";

/// @notice Handler contract for invariant testing
contract PoolHandler is Test {
    ShieldedPoolV4 public pool;
    MockUSDC public usdc;
    address public depositor;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public txCount;

    uint256 constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    constructor(ShieldedPoolV4 _pool, MockUSDC _usdc, address _depositor) {
        pool = _pool;
        usdc = _usdc;
        depositor = _depositor;
    }

    function _computeExtDataHash(ShieldedPoolV4.ExtData memory extData) internal pure returns (bytes32) {
        bytes32 hash = keccak256(abi.encode(
            extData.recipient,
            extData.relayer,
            extData.fee,
            keccak256(extData.encryptedOutput1),
            keccak256(extData.encryptedOutput2)
        ));
        return bytes32(uint256(hash) % FIELD_SIZE);
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 100_000_000); // 0-100 USDC

        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: address(0),
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"aabb",
            encryptedOutput2: hex"ccdd"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(keccak256(abi.encode("inv_d", txCount))));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(keccak256(abi.encode("inv_dc0", txCount))));
        commitments[1] = bytes32(uint256(keccak256(abi.encode("inv_dc1", txCount))));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: int256(amount),
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        usdc.mint(depositor, amount);
        vm.prank(depositor);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(depositor);
        pool.transact(args, extData);

        totalDeposited += amount;
        txCount++;
    }

    function withdraw(uint256 amount) external {
        uint256 poolBal = usdc.balanceOf(address(pool));
        if (poolBal == 0) return;
        amount = bound(amount, 1, poolBal);

        address recipient = makeAddr("withdrawer");

        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: recipient,
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"eeff",
            encryptedOutput2: hex"1122"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(keccak256(abi.encode("inv_w", txCount))));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(keccak256(abi.encode("inv_wc0", txCount))));
        commitments[1] = bytes32(uint256(keccak256(abi.encode("inv_wc1", txCount))));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: -int256(amount),
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        pool.transact(args, extData);

        totalWithdrawn += amount;
        txCount++;
    }
}

contract InvariantTest is Test {
    ShieldedPoolV4 public pool;
    PoseidonHasher public hasher;
    MockVerifier1x2 public verifier1x2;
    MockVerifier2x2 public verifier2x2;
    MockUSDC public usdc;
    PoolHandler public handler;

    address public depositor = makeAddr("depositor");

    function setUp() public {
        hasher = new PoseidonHasher();
        verifier1x2 = new MockVerifier1x2();
        verifier2x2 = new MockVerifier2x2();
        usdc = new MockUSDC();
        pool = new ShieldedPoolV4(
            address(hasher),
            address(usdc),
            address(verifier1x2),
            address(verifier2x2)
        );

        handler = new PoolHandler(pool, usdc, depositor);

        // Only target the handler
        targetContract(address(handler));
    }

    // ============ Invariant: Pool Balance Consistency ============
    /// @notice Pool USDC balance must equal totalDeposited - totalWithdrawn
    function invariant_poolBalanceConsistency() public view {
        uint256 poolBalance = usdc.balanceOf(address(pool));
        uint256 expected = handler.totalDeposited() - handler.totalWithdrawn();
        assertEq(poolBalance, expected);
    }

    // ============ Invariant: Root History Bounded ============
    /// @notice currentRootIndex must be < ROOT_HISTORY_SIZE
    function invariant_rootHistoryBounded() public view {
        assertTrue(pool.currentRootIndex() < pool.ROOT_HISTORY_SIZE());
    }

    // ============ Invariant: Leaf Index Monotonic ============
    /// @notice nextLeafIndex must equal txCount * 2 (each tx inserts 2 commitments)
    function invariant_leafIndexMonotonic() public view {
        assertEq(pool.nextLeafIndex(), handler.txCount() * 2);
    }

    // ============ Invariant: Latest Root Always Known ============
    /// @notice The latest root must always be recognized as valid
    function invariant_latestRootAlwaysKnown() public view {
        bytes32 lastRoot = pool.getLastRoot();
        assertTrue(pool.isKnownRoot(lastRoot));
    }

    // ============ Invariant: Pool Balance Never Negative ============
    /// @notice Pool balance can never go negative (uint256 guarantees this, but
    ///         we verify the accounting logic doesn't allow over-withdrawal)
    function invariant_poolBalanceNonNegative() public view {
        assertTrue(handler.totalDeposited() >= handler.totalWithdrawn());
    }
}

/// @notice Separate test for pause invariant (not using handler)
contract PauseInvariantTest is Test {
    ShieldedPoolV4 public pool;
    PoseidonHasher public hasher;
    MockUSDC public usdc;

    uint256 constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function setUp() public {
        hasher = new PoseidonHasher();
        MockVerifier1x2 v1 = new MockVerifier1x2();
        MockVerifier2x2 v2 = new MockVerifier2x2();
        usdc = new MockUSDC();
        pool = new ShieldedPoolV4(
            address(hasher),
            address(usdc),
            address(v1),
            address(v2)
        );
    }

    function _computeExtDataHash(ShieldedPoolV4.ExtData memory extData) internal pure returns (bytes32) {
        bytes32 hash = keccak256(abi.encode(
            extData.recipient, extData.relayer, extData.fee,
            keccak256(extData.encryptedOutput1), keccak256(extData.encryptedOutput2)
        ));
        return bytes32(uint256(hash) % FIELD_SIZE);
    }

    /// @notice When paused, all transact calls must revert
    function test_pauseBlocksAll() public {
        pool.pause();

        address alice = makeAddr("alice");
        usdc.mint(alice, 10_000_000);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);

        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: address(0), relayer: address(0), fee: 0,
            encryptedOutput1: hex"aa", encryptedOutput2: hex"bb"
        });

        // Deposit attempt
        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(0x1));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x2));
        commitments[1] = bytes32(uint256(0x3));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: int256(1_000_000),
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        vm.prank(alice);
        vm.expectRevert();
        pool.transact(args, extData);

        // Transfer attempt (publicAmount=0)
        args.publicAmount = int256(0);
        args.extDataHash = _computeExtDataHash(extData);
        nullifiers[0] = bytes32(uint256(0x4));

        vm.expectRevert();
        pool.transact(args, extData);

        // Withdraw attempt (publicAmount<0)
        extData.recipient = makeAddr("bob");
        args.publicAmount = -int256(1_000_000);
        args.extDataHash = _computeExtDataHash(extData);
        nullifiers[0] = bytes32(uint256(0x5));

        vm.expectRevert();
        pool.transact(args, extData);
    }
}
