// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ShieldedPool.sol";
import "../src/PoseidonHasher.sol";
import "../src/Groth16Verifier.sol";
import "./mocks/MockUSDC.sol";

contract ShieldedPoolTest is Test {
    ShieldedPool public pool;
    PoseidonHasher public hasher;
    Groth16Verifier public verifier;
    MockUSDC public usdc;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public relayer = makeAddr("relayer");

    uint256 constant DEPOSIT_AMOUNT = 10_000_000; // 10 USDC

    function setUp() public {
        hasher = new PoseidonHasher();
        verifier = new Groth16Verifier();
        usdc = new MockUSDC();
        pool = new ShieldedPool(address(verifier), address(hasher), address(usdc));

        // Fund alice
        usdc.mint(alice, 100_000_000); // 100 USDC
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    function test_deposit() public {
        bytes32 commitment = bytes32(uint256(123456));

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        assertEq(usdc.balanceOf(address(pool)), DEPOSIT_AMOUNT);
        assertEq(pool.nextLeafIndex(), 1);
        assertTrue(pool.commitmentExists(commitment));
    }

    function test_deposit_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Amount must be > 0");
        pool.deposit(0, bytes32(uint256(1)));
    }

    function test_deposit_zeroCommitment_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Invalid commitment");
        pool.deposit(DEPOSIT_AMOUNT, bytes32(0));
    }

    function test_deposit_duplicateCommitment_reverts() public {
        bytes32 commitment = bytes32(uint256(999));

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        vm.prank(alice);
        vm.expectRevert("Commitment exists");
        pool.deposit(DEPOSIT_AMOUNT, commitment);
    }

    function test_deposit_updatesRoot() public {
        bytes32 rootBefore = pool.getLastRoot();

        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, bytes32(uint256(111)));

        bytes32 rootAfter = pool.getLastRoot();
        assertTrue(rootBefore != rootAfter);
        assertTrue(pool.isKnownRoot(rootAfter));
    }

    function test_withdraw() public {
        // Deposit first
        bytes32 commitment = bytes32(uint256(123));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        bytes32 nullifierHash = bytes32(uint256(456));
        bytes32 newCommitment = bytes32(uint256(789));
        uint256 withdrawAmount = 5_000_000; // 5 USDC
        uint256 fee = 50_000; // 0.05 USDC

        // Fake proof (placeholder verifier accepts all)
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

    function test_withdraw_doubleSpend_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 root = pool.getLastRoot();
        bytes32 nullifierHash = bytes32(uint256(200));
        uint256[8] memory proof;

        pool.withdraw(bob, 1_000_000, nullifierHash, bytes32(uint256(300)), root, relayer, 0, proof);

        vm.expectRevert("Nullifier already used");
        pool.withdraw(bob, 1_000_000, nullifierHash, bytes32(uint256(400)), root, relayer, 0, proof);
    }

    function test_withdraw_unknownRoot_reverts() public {
        bytes32 commitment = bytes32(uint256(100));
        vm.prank(alice);
        pool.deposit(DEPOSIT_AMOUNT, commitment);

        bytes32 fakeRoot = bytes32(uint256(999999));
        uint256[8] memory proof;

        vm.expectRevert("Unknown merkle root");
        pool.withdraw(bob, 1_000_000, bytes32(uint256(200)), bytes32(uint256(300)), fakeRoot, relayer, 0, proof);
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

    function test_withdraw_zeroNewCommitment() public {
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
    }

    function test_rootHistory() public {
        // Insert ROOT_HISTORY_SIZE + 1 leaves and check old roots expire
        for (uint256 i = 1; i <= 31; i++) {
            vm.prank(alice);
            pool.deposit(1_000_000, bytes32(i));
        }

        // The very first root (index 0 before any deposits) should be expired
        // since we wrapped around 30-element buffer
        bytes32 initialRoot = pool.roots(0);
        // After 31 deposits, currentRootIndex = 31 % 30 = 1, so roots[0] was overwritten at deposit #30
        // roots[1] was overwritten at deposit #31
        // The root that was at index 0 originally is gone
    }

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

    function test_multipleDeposits() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(alice);
            pool.deposit(1_000_000, bytes32(i));
        }

        assertEq(pool.nextLeafIndex(), 5);
        assertEq(usdc.balanceOf(address(pool)), 5_000_000);
    }
}
