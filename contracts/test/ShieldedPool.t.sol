// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ShieldedPool.sol";
import "../src/PoseidonHasher.sol";
import "./mocks/MockVerifier.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/RejectVerifier.sol";

contract ShieldedPoolTest is Test {
    ShieldedPool public pool;
    PoseidonHasher public hasher;
    MockVerifier public verifier;
    MockUSDC public usdc;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public relayer = makeAddr("relayer");
    address public owner;

    uint256 constant DEPOSIT_AMOUNT = 10_000_000; // 10 USDC

    function setUp() public {
        owner = address(this);
        hasher = new PoseidonHasher();
        verifier = new MockVerifier();
        usdc = new MockUSDC();
        pool = new ShieldedPool(address(verifier), address(hasher), address(usdc));

        // Fund alice
        usdc.mint(alice, 100_000_000); // 100 USDC
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ============ Deposit Tests ============

    function test_deposit() public {
        bytes32 commitment = bytes32(uint256(123456));

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        assertEq(usdc.balanceOf(address(pool)), DEPOSIT_AMOUNT);
        assertEq(pool.nextLeafIndex(), 1);
        assertTrue(pool.commitmentExists(commitment));
    }

    function test_deposit_emitsEvent() public {
        bytes32 commitment = bytes32(uint256(42));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ShieldedPool.Deposited(commitment, 0, DEPOSIT_AMOUNT, block.timestamp);
        pool.deposit(DEPOSIT_AMOUNT, commitment);
    }

    function test_deposit_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ZeroAmount.selector);
        pool.deposit(0, bytes32(uint256(1)));
    }

    function test_deposit_zeroCommitment_reverts() public {
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.InvalidCommitment.selector);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(0));
    }

    function test_deposit_exceedsMaxDeposit_reverts() public {
        uint256 maxDeposit = pool.MAX_DEPOSIT();
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ExceedsMaxDeposit.selector);
        pool.deposit(maxDeposit + 1, bytes32(uint256(1)));
    }

    function test_deposit_duplicateCommitment_reverts() public {
        bytes32 commitment = bytes32(uint256(999));

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        vm.prank(alice);
        vm.expectRevert(ShieldedPool.DuplicateCommitment.selector);
        pool.deposit(DEPOSIT_AMOUNT, commitment);
    }

    function test_withdraw_feeWithZeroRelayer_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        uint256[8] memory proof;

        vm.expectRevert(ShieldedPool.RelayerRequiredForFee.selector);
        pool.withdraw(bob, 5_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, address(0), 50_000, proof);
    }

    function test_deposit_updatesRoot() public {
        bytes32 rootBefore = pool.getLastRoot();

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(111)));

        bytes32 rootAfter = pool.getLastRoot();
        assertTrue(rootBefore != rootAfter);
        assertTrue(pool.isKnownRoot(rootAfter));
    }

    function test_deposit_multipleDeposits() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(alice);
            pool.deposit(1_000_000, bytes32(i));
        }

        assertEq(pool.nextLeafIndex(), 5);
        assertEq(usdc.balanceOf(address(pool)), 5_000_000);
    }

    // ============ Withdraw Tests ============

    function test_withdraw() public {
        bytes32 commitment = bytes32(uint256(123));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        bytes32 nullifierHash = bytes32(uint256(456));
        bytes32 newCommitment = bytes32(uint256(789));
        uint256 withdrawAmount = 5_000_000; // 5 USDC
        uint256 fee = 50_000; // 0.05 USDC

        uint256[8] memory proof;

        pool.withdraw(
            bob,
            withdrawAmount,
            nullifierHash,
            newCommitment,
            root,
            relayer,
            fee,
            proof
        );

        assertEq(usdc.balanceOf(bob), withdrawAmount);
        assertEq(usdc.balanceOf(relayer), fee);
        assertEq(usdc.balanceOf(address(pool)), DEPOSIT_AMOUNT - withdrawAmount - fee);
        assertTrue(pool.nullifiers(nullifierHash));
        assertTrue(pool.commitmentExists(newCommitment));
    }

    function test_withdraw_emitsEvents() public {
        bytes32 commitment = bytes32(uint256(123));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        bytes32 nullifierHash = bytes32(uint256(456));
        bytes32 newCommitment = bytes32(uint256(789));
        uint256[8] memory proof;

        vm.expectEmit(true, true, false, true);
        emit ShieldedPool.NewCommitment(newCommitment, 1);
        vm.expectEmit(true, true, false, true);
        emit ShieldedPool.Withdrawn(nullifierHash, bob, relayer, 50_000);

        pool.withdraw(bob, 5_000_000, nullifierHash, newCommitment, root, relayer, 50_000, proof);
    }

    function test_withdraw_doubleSpend_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        bytes32 nullifierHash = bytes32(uint256(200));
        uint256[8] memory proof;

        pool.withdraw(bob, 1_000_000, nullifierHash, bytes32(uint256(300)), root, relayer, 0, proof);

        vm.expectRevert(ShieldedPool.NullifierAlreadyUsed.selector);
        pool.withdraw(bob, 1_000_000, nullifierHash, bytes32(uint256(400)), root, relayer, 0, proof);
    }

    function test_withdraw_unknownRoot_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 fakeRoot = bytes32(uint256(999999));
        uint256[8] memory proof;

        vm.expectRevert(ShieldedPool.UnknownMerkleRoot.selector);
        pool.withdraw(bob, 1_000_000, bytes32(uint256(200)), bytes32(uint256(300)), fakeRoot, relayer, 0, proof);
    }

    function test_withdraw_zeroRecipient_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        uint256[8] memory proof;

        vm.expectRevert(ShieldedPool.InvalidRecipient.selector);
        pool.withdraw(address(0), 1_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, relayer, 0, proof);
    }

    function test_withdraw_zeroAmount_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        uint256[8] memory proof;

        vm.expectRevert(ShieldedPool.ZeroAmount.selector);
        pool.withdraw(bob, 0, bytes32(uint256(200)), bytes32(uint256(300)), root, relayer, 0, proof);
    }

    function test_withdraw_noFee() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        uint256[8] memory proof;

        pool.withdraw(bob, 5_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, address(0), 0, proof);

        assertEq(usdc.balanceOf(bob), 5_000_000);
    }

    function test_withdraw_zeroNewCommitment_fullSpend() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        uint256 leafsBefore = pool.nextLeafIndex();
        uint256[8] memory proof;

        // Zero new commitment = full spend, no change note
        pool.withdraw(bob, DEPOSIT_AMOUNT, bytes32(uint256(200)), bytes32(0), root, address(0), 0, proof);

        // Leaf index should NOT increase (no new commitment inserted)
        assertEq(pool.nextLeafIndex(), leafsBefore);
        assertEq(usdc.balanceOf(bob), DEPOSIT_AMOUNT);
    }

    function test_withdraw_nonZeroNewCommitment_insertsLeaf() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        uint256 leafsBefore = pool.nextLeafIndex();
        uint256[8] memory proof;

        pool.withdraw(bob, 5_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, address(0), 0, proof);

        // Change note should insert new leaf
        assertEq(pool.nextLeafIndex(), leafsBefore + 1);
    }

    function test_withdraw_insufficientPool_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(1_000_000, commitment); // only 1 USDC

        bytes32 root = pool.getLastRoot();
        uint256[8] memory proof;

        vm.expectRevert(ShieldedPool.InsufficientPoolBalance.selector);
        pool.withdraw(bob, 2_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, address(0), 0, proof);
    }

    // ============ Proof Verification Tests ============

    function test_withdraw_invalidProof_reverts() public {
        // Deploy pool with reject verifier
        RejectVerifier rejectVerifier = new RejectVerifier();
        ShieldedPool rejectPool = new ShieldedPool(address(rejectVerifier), address(hasher), address(usdc));

        usdc.mint(address(rejectPool), DEPOSIT_AMOUNT);

        // Manually insert a commitment (direct deposit)
        vm.prank(alice);
        usdc.approve(address(rejectPool), type(uint256).max);
        vm.prank(alice);
        rejectPool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(100)));

        bytes32 root = rejectPool.getLastRoot();
        uint256[8] memory proof;

        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        rejectPool.withdraw(bob, 1_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, address(0), 0, proof);
    }

    // ============ Pause Tests (H3) ============

    function test_pause_blocksDeposit() public {
        pool.pause();

        vm.prank(alice);
        vm.expectRevert();
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(1)));
    }

    function test_pause_blocksWithdraw() public {
        // Deposit first while unpaused
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(100)));

        pool.pause();

        bytes32 root = pool.getLastRoot();
        uint256[8] memory proof;

        vm.expectRevert();
        pool.withdraw(bob, 1_000_000, bytes32(uint256(200)), bytes32(uint256(300)), root, address(0), 0, proof);
    }

    function test_unpause_allowsOperations() public {
        pool.pause();
        pool.unpause();

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(1)));
        assertEq(pool.nextLeafIndex(), 1);
    }

    function test_pause_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.pause();
    }

    // ============ Root History Tests (M1: ROOT_HISTORY_SIZE = 100) ============

    function test_rootHistorySize() public {
        assertEq(pool.ROOT_HISTORY_SIZE(), 100);
    }

    function test_rootHistory_oldRootsStillValid() public {
        // Deposit 50 times — all roots within history
        for (uint256 i = 1; i <= 50; i++) {
            vm.prank(alice);
            pool.deposit(1_000_000, bytes32(i));
        }

        // First deposit root should still be valid (within 100)
        bytes32 firstRoot = pool.roots(1);
        assertTrue(pool.isKnownRoot(firstRoot));
    }

    function test_rootHistory_zeroRootNotValid() public {
        assertFalse(pool.isKnownRoot(bytes32(0)));
    }

    // ============ Tree Info Tests ============

    function test_getTreeInfo() public {
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(42)));

        (uint256 nextLeaf, uint256 maxSize, bytes32 currentRoot) = pool.getTreeInfo();
        assertEq(nextLeaf, 1);
        assertEq(maxSize, 2 ** 20);
        assertTrue(currentRoot != bytes32(0));
    }

    function test_getBalance() public {
        assertEq(pool.getBalance(), 0);

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(1)));

        assertEq(pool.getBalance(), DEPOSIT_AMOUNT);
    }

    function test_maxDeposit() public {
        assertEq(pool.MAX_DEPOSIT(), 1_000_000_000_000);
    }

    // ============ Ownership Tests ============

    function test_owner() public view {
        assertEq(pool.owner(), owner);
    }

    function test_transferOwnership() public {
        pool.transferOwnership(alice);
        assertEq(pool.owner(), alice);
    }
}
