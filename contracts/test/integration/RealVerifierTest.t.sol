// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/ShieldedPoolV4.sol";
import "../../src/PoseidonHasher.sol";
import "../../src/verifiers/Groth16Verifier_1x2.sol";
import "../../src/verifiers/Groth16Verifier_2x2.sol";
import "../mocks/MockUSDC.sol";

/**
 * Integration tests with REAL Groth16 verifiers.
 * Uses pre-generated proof fixtures from scripts/generateTestFixtures.ts.
 *
 * Existing 111 tests use MockVerifier for fast logic tests.
 * This file tests REAL ZK proof verification on-chain.
 *
 * Generate fixtures:  cd sdk && npx tsx ../scripts/generateTestFixtures.ts
 * Run these tests:    forge test --match-path test/integration/ -vvv
 *
 * NOTE: These tests require fixture files in test/fixtures/.
 *       If fixtures are missing, tests will revert with "stdStorage find" error.
 *       Run the fixture generator script first.
 */
contract RealVerifierTest is Test {
    ShieldedPoolV4 pool;
    MockUSDC usdc;
    address treasury;
    address depositor;

    // Real verifiers (NOT mocks!)
    Groth16Verifier_1x2 verifier1x2;
    Groth16Verifier_2x2 verifier2x2;

    function setUp() public {
        // 1. Deploy real verifiers
        verifier1x2 = new Groth16Verifier_1x2();
        verifier2x2 = new Groth16Verifier_2x2();

        // 2. Deploy supporting contracts
        PoseidonHasher hasher = new PoseidonHasher();
        usdc = new MockUSDC();

        // 3. Deploy pool with REAL verifiers
        pool = new ShieldedPoolV4(
            address(hasher),
            address(usdc),
            address(verifier1x2),
            address(verifier2x2)
        );

        // 4. Setup treasury and depositor
        treasury = makeAddr("treasury");
        pool.setTreasury(treasury);

        depositor = makeAddr("depositor");
        usdc.mint(depositor, 100_000_000); // 100 USDC
        usdc.mint(address(pool), 100_000_000); // Pool liquidity for withdrawals
    }

    // ============================================================================
    // Fixture Loading Helpers
    // ============================================================================

    struct FixtureProof {
        uint256[2] pA;
        uint256[2][2] pB;
        uint256[2] pC;
    }

    struct FixtureArgs {
        bytes32 root;
        int256 publicAmount;
        bytes32 extDataHash;
        uint256 protocolFee;
        bytes32[] nullifiers;
        bytes32[] commitments;
        uint8[] viewTags;
    }

    function _loadFixture(string memory name) internal view returns (
        string memory json
    ) {
        string memory path = string.concat("test/fixtures/", name, ".json");
        json = vm.readFile(path);
    }

    function _parseProof(string memory json) internal pure returns (FixtureProof memory proof) {
        proof.pA[0] = vm.parseJsonUint(json, ".proof.pA[0]");
        proof.pA[1] = vm.parseJsonUint(json, ".proof.pA[1]");
        proof.pB[0][0] = vm.parseJsonUint(json, ".proof.pB[0][0]");
        proof.pB[0][1] = vm.parseJsonUint(json, ".proof.pB[0][1]");
        proof.pB[1][0] = vm.parseJsonUint(json, ".proof.pB[1][0]");
        proof.pB[1][1] = vm.parseJsonUint(json, ".proof.pB[1][1]");
        proof.pC[0] = vm.parseJsonUint(json, ".proof.pC[0]");
        proof.pC[1] = vm.parseJsonUint(json, ".proof.pC[1]");
    }

    function _parseDepositArgs(string memory json) internal pure returns (FixtureArgs memory args) {
        args.root = bytes32(vm.parseJsonUint(json, ".args.root"));
        args.publicAmount = int256(vm.parseJsonUint(json, ".args.publicAmount"));
        args.extDataHash = bytes32(vm.parseJsonUint(json, ".args.extDataHash"));
        args.protocolFee = vm.parseJsonUint(json, ".args.protocolFee");

        // Single nullifier for 1x2
        args.nullifiers = new bytes32[](1);
        args.nullifiers[0] = bytes32(vm.parseJsonUint(json, ".args.nullifiers[0]"));

        // Two commitments for 1x2
        args.commitments = new bytes32[](2);
        args.commitments[0] = bytes32(vm.parseJsonUint(json, ".args.commitments[0]"));
        args.commitments[1] = bytes32(vm.parseJsonUint(json, ".args.commitments[1]"));

        args.viewTags = new uint8[](2);
        args.viewTags[0] = 0;
        args.viewTags[1] = 0;
    }

    function _parseWithdrawArgs(string memory json) internal pure returns (FixtureArgs memory args) {
        args.root = bytes32(vm.parseJsonUint(json, ".args.root"));
        // Withdraw uses field-wrapped negative publicAmount
        args.publicAmount = -int256(vm.parseJsonUint(json, string.concat(".args.publicAmount")));
        args.extDataHash = bytes32(vm.parseJsonUint(json, ".args.extDataHash"));
        args.protocolFee = vm.parseJsonUint(json, ".args.protocolFee");

        args.nullifiers = new bytes32[](1);
        args.nullifiers[0] = bytes32(vm.parseJsonUint(json, ".args.nullifiers[0]"));

        args.commitments = new bytes32[](2);
        args.commitments[0] = bytes32(vm.parseJsonUint(json, ".args.commitments[0]"));
        args.commitments[1] = bytes32(vm.parseJsonUint(json, ".args.commitments[1]"));

        args.viewTags = new uint8[](2);
        args.viewTags[0] = 0;
        args.viewTags[1] = 0;
    }

    function _parseExtData(string memory json) internal pure returns (
        ShieldedPoolV4.ExtData memory ext
    ) {
        ext.recipient = vm.parseJsonAddress(json, ".extData.recipient");
        ext.relayer = vm.parseJsonAddress(json, ".extData.relayer");
        ext.fee = vm.parseJsonUint(json, ".extData.fee");
        ext.encryptedOutput1 = vm.parseJsonBytes(json, ".extData.encryptedOutput1");
        ext.encryptedOutput2 = vm.parseJsonBytes(json, ".extData.encryptedOutput2");
    }

    function _buildTransactArgs(
        FixtureProof memory proof,
        FixtureArgs memory args
    ) internal pure returns (ShieldedPoolV4.TransactArgs memory txArgs) {
        txArgs.pA = proof.pA;
        txArgs.pB = proof.pB;
        txArgs.pC = proof.pC;
        txArgs.root = args.root;
        txArgs.publicAmount = args.publicAmount;
        txArgs.extDataHash = args.extDataHash;
        txArgs.protocolFee = args.protocolFee;
        txArgs.inputNullifiers = args.nullifiers;
        txArgs.outputCommitments = args.commitments;
        txArgs.viewTags = args.viewTags;
    }

    // ============================================================================
    // Integration Tests
    // ============================================================================

    function test_realVerifier_deposit() public {
        string memory json = _loadFixture("deposit_1x2");
        FixtureProof memory proof = _parseProof(json);
        FixtureArgs memory args = _parseDepositArgs(json);
        ShieldedPoolV4.ExtData memory ext = _parseExtData(json);

        ShieldedPoolV4.TransactArgs memory txArgs = _buildTransactArgs(proof, args);

        // Approve and deposit
        uint256 amount = uint256(args.publicAmount);
        vm.startPrank(depositor);
        usdc.approve(address(pool), amount);
        pool.transact(txArgs, ext);
        vm.stopPrank();

        // Verify: commitments inserted
        assertTrue(pool.nullifiers(args.nullifiers[0]));
        assertEq(pool.nextLeafIndex(), 2); // 2 commitments inserted
    }

    function test_realVerifier_deposit_thenWithdraw() public {
        // Step 1: Deposit
        {
            string memory dJson = _loadFixture("deposit_1x2");
            FixtureProof memory dProof = _parseProof(dJson);
            FixtureArgs memory dArgs = _parseDepositArgs(dJson);
            ShieldedPoolV4.ExtData memory dExt = _parseExtData(dJson);
            ShieldedPoolV4.TransactArgs memory dTxArgs = _buildTransactArgs(dProof, dArgs);

            vm.startPrank(depositor);
            usdc.approve(address(pool), uint256(dArgs.publicAmount));
            pool.transact(dTxArgs, dExt);
            vm.stopPrank();
        }

        // Step 2: Withdraw
        {
            string memory wJson = _loadFixture("withdraw_1x2");
            FixtureProof memory wProof = _parseProof(wJson);
            FixtureArgs memory wArgs = _parseWithdrawArgs(wJson);
            ShieldedPoolV4.ExtData memory wExt = _parseExtData(wJson);
            ShieldedPoolV4.TransactArgs memory wTxArgs = _buildTransactArgs(wProof, wArgs);

            address recipient = wExt.recipient;
            uint256 recipientBefore = usdc.balanceOf(recipient);

            pool.transact(wTxArgs, wExt);

            // Verify: recipient received USDC
            uint256 recipientAfter = usdc.balanceOf(recipient);
            assertTrue(recipientAfter > recipientBefore);

            // Verify: nullifier recorded
            assertTrue(pool.nullifiers(wArgs.nullifiers[0]));

            // Verify: 4 total commitments (2 deposit + 2 withdraw)
            assertEq(pool.nextLeafIndex(), 4);
        }
    }

    function test_realVerifier_invalidProof_reverts() public {
        string memory json = _loadFixture("invalid_proof");
        FixtureProof memory proof = _parseProof(json);
        FixtureArgs memory args = _parseDepositArgs(json);
        ShieldedPoolV4.ExtData memory ext = _parseExtData(json);

        ShieldedPoolV4.TransactArgs memory txArgs = _buildTransactArgs(proof, args);

        uint256 amount = uint256(args.publicAmount);
        vm.startPrank(depositor);
        usdc.approve(address(pool), amount);

        vm.expectRevert(ShieldedPoolV4.InvalidProof.selector);
        pool.transact(txArgs, ext);
        vm.stopPrank();
    }

    function test_realVerifier_doubleSpend_reverts() public {
        // First: deposit to get commitments in tree
        {
            string memory dJson = _loadFixture("deposit_1x2");
            FixtureProof memory dProof = _parseProof(dJson);
            FixtureArgs memory dArgs = _parseDepositArgs(dJson);
            ShieldedPoolV4.ExtData memory dExt = _parseExtData(dJson);
            ShieldedPoolV4.TransactArgs memory dTxArgs = _buildTransactArgs(dProof, dArgs);

            vm.startPrank(depositor);
            usdc.approve(address(pool), uint256(dArgs.publicAmount));
            pool.transact(dTxArgs, dExt);
            vm.stopPrank();
        }

        // Second: first spend — should succeed
        {
            string memory ds1Json = _loadFixture("double_spend_first");
            FixtureProof memory ds1Proof = _parseProof(ds1Json);
            FixtureArgs memory ds1Args = _parseWithdrawArgs(ds1Json);
            ShieldedPoolV4.ExtData memory ds1Ext = _parseExtData(ds1Json);
            ShieldedPoolV4.TransactArgs memory ds1TxArgs = _buildTransactArgs(ds1Proof, ds1Args);

            pool.transact(ds1TxArgs, ds1Ext); // Should succeed
        }

        // Third: second spend with same nullifier — should REVERT
        {
            string memory ds2Json = _loadFixture("double_spend_second");
            FixtureProof memory ds2Proof = _parseProof(ds2Json);
            FixtureArgs memory ds2Args = _parseWithdrawArgs(ds2Json);
            ShieldedPoolV4.ExtData memory ds2Ext = _parseExtData(ds2Json);
            ShieldedPoolV4.TransactArgs memory ds2TxArgs = _buildTransactArgs(ds2Proof, ds2Args);

            vm.expectRevert(ShieldedPoolV4.NullifierAlreadyUsed.selector);
            pool.transact(ds2TxArgs, ds2Ext);
        }
    }

    function test_realVerifier_protocolFeeCollected() public {
        string memory json = _loadFixture("deposit_1x2");
        FixtureProof memory proof = _parseProof(json);
        FixtureArgs memory args = _parseDepositArgs(json);
        ShieldedPoolV4.ExtData memory ext = _parseExtData(json);

        ShieldedPoolV4.TransactArgs memory txArgs = _buildTransactArgs(proof, args);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.startPrank(depositor);
        usdc.approve(address(pool), uint256(args.publicAmount));
        pool.transact(txArgs, ext);
        vm.stopPrank();

        // Verify: treasury received protocol fee
        uint256 treasuryAfter = usdc.balanceOf(treasury);
        assertEq(treasuryAfter - treasuryBefore, args.protocolFee);
    }

    function test_realVerifier_merkleRootUpdated() public {
        bytes32 rootBefore = pool.getLastRoot();

        string memory json = _loadFixture("deposit_1x2");
        FixtureProof memory proof = _parseProof(json);
        FixtureArgs memory args = _parseDepositArgs(json);
        ShieldedPoolV4.ExtData memory ext = _parseExtData(json);

        ShieldedPoolV4.TransactArgs memory txArgs = _buildTransactArgs(proof, args);

        vm.startPrank(depositor);
        usdc.approve(address(pool), uint256(args.publicAmount));
        pool.transact(txArgs, ext);
        vm.stopPrank();

        bytes32 rootAfter = pool.getLastRoot();
        assertTrue(rootAfter != rootBefore);
        assertTrue(pool.isKnownRoot(rootAfter));
    }
}
