// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ShieldedPoolV4.sol";
import "../src/PoseidonHasher.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/MockVerifier1x2.sol";
import "./mocks/MockVerifier2x2.sol";

contract ProtocolFeeTest is Test {
    ShieldedPoolV4 public pool;
    PoseidonHasher public hasher;
    MockVerifier1x2 public verifier1x2;
    MockVerifier2x2 public verifier2x2;
    MockUSDC public usdc;

    address public alice = makeAddr("alice");
    address public treasuryAddr = makeAddr("treasury");
    address public relayerAddr = makeAddr("relayer");
    address public owner;

    uint256 constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function setUp() public {
        owner = address(this);
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

        // Fund alice
        usdc.mint(alice, 1_000_000_000); // 1000 USDC
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ============ Helpers ============

    function _defaultViewTags() internal pure returns (uint8[] memory) {
        uint8[] memory vt = new uint8[](2);
        return vt;
    }

    function _makeExtData(
        address recipient,
        address relayer,
        uint256 fee
    ) internal pure returns (ShieldedPoolV4.ExtData memory) {
        return ShieldedPoolV4.ExtData({
            recipient: recipient,
            relayer: relayer,
            fee: fee,
            encryptedOutput1: hex"aabbcc",
            encryptedOutput2: hex"ddeeff"
        });
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

    function _makeDepositArgs(
        uint256 amount,
        ShieldedPoolV4.ExtData memory extData,
        uint256 salt,
        uint256 protocolFee
    ) internal view returns (ShieldedPoolV4.TransactArgs memory) {
        bytes32 root = pool.getLastRoot();
        bytes32 extDataHash = _computeExtDataHash(extData);

        bytes32[] memory nullifiers_ = new bytes32[](1);
        nullifiers_[0] = bytes32(uint256(keccak256(abi.encode("nullifier", amount, salt))));

        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(keccak256(abi.encode("commit0", amount, salt))));
        commitments[1] = bytes32(uint256(keccak256(abi.encode("commit1", amount, salt))));

        return ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: root,
            publicAmount: int256(amount),
            extDataHash: extDataHash,
            protocolFee: protocolFee,
            inputNullifiers: nullifiers_,
            outputCommitments: commitments,
            viewTags: _defaultViewTags()
        });
    }

    function _makeWithdrawArgs(
        uint256 amount,
        bytes32 nullifier,
        ShieldedPoolV4.ExtData memory extData,
        uint256 protocolFee
    ) internal view returns (ShieldedPoolV4.TransactArgs memory) {
        bytes32 root = pool.getLastRoot();
        bytes32 extDataHash = _computeExtDataHash(extData);

        bytes32[] memory nullifiers_ = new bytes32[](1);
        nullifiers_[0] = nullifier;

        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(keccak256(abi.encode("wcommit0", amount, nullifier))));
        commitments[1] = bytes32(uint256(keccak256(abi.encode("wcommit1", amount, nullifier))));

        return ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: root,
            publicAmount: -int256(amount),
            extDataHash: extDataHash,
            protocolFee: protocolFee,
            inputNullifiers: nullifiers_,
            outputCommitments: commitments,
            viewTags: _defaultViewTags()
        });
    }

    function _doDeposit(uint256 amount, uint256 salt) internal {
        ShieldedPoolV4.ExtData memory extData = _makeExtData(address(0), address(0), 0);
        // Calculate protocol fee if treasury is set
        uint256 pFee = 0;
        if (pool.treasury() != address(0)) {
            uint256 percentFee = (amount * pool.protocolFeeBps()) / 10000;
            uint256 minFee = pool.minProtocolFee();
            pFee = percentFee > minFee ? percentFee : minFee;
        }
        ShieldedPoolV4.TransactArgs memory args = _makeDepositArgs(amount, extData, salt, pFee);
        vm.prank(alice);
        pool.transact(args, extData);
    }

    // ============ Protocol Fee Tests ============

    /// @notice 10 USDC deposit with treasury → pool gets 9.99, treasury gets 0.01
    function test_protocolFee_onDeposit() public {
        pool.setTreasury(treasuryAddr);

        uint256 depositAmount = 10_000_000; // 10 USDC
        // fee = max(10M * 10 / 10000, 10000) = max(10000, 10000) = 10000 = 0.01 USDC
        uint256 expectedFee = 10_000; // 0.01 USDC

        uint256 aliceBefore = usdc.balanceOf(alice);

        _doDeposit(depositAmount, 100);

        uint256 poolBalance = usdc.balanceOf(address(pool));
        uint256 treasuryBalance = usdc.balanceOf(treasuryAddr);

        assertEq(poolBalance, depositAmount - expectedFee);
        assertEq(treasuryBalance, expectedFee);
        assertEq(usdc.balanceOf(alice), aliceBefore - depositAmount);
    }

    /// @notice 100 USDC deposit → pool gets 99.9, treasury gets 0.1 (0.1%)
    function test_protocolFee_onLargeDeposit() public {
        pool.setTreasury(treasuryAddr);

        uint256 depositAmount = 100_000_000; // 100 USDC
        // fee = max(100M * 10 / 10000, 10000) = max(100_000, 10000) = 100_000
        uint256 expectedFee = 100_000; // 0.1 USDC

        _doDeposit(depositAmount, 200);

        assertEq(usdc.balanceOf(address(pool)), depositAmount - expectedFee);
        assertEq(usdc.balanceOf(treasuryAddr), expectedFee);
    }

    /// @notice 10 USDC withdraw with relayer fee → protocolFee from pool surplus (not recipient's share)
    function test_protocolFee_onWithdraw() public {
        // Deposit first (treasury is address(0) by default → no fee)
        // Deposit extra to cover the protocol fee that will be taken from pool surplus
        uint256 depositAmount = 10_010_000; // 10.01 USDC (covers 10M withdraw + 10K fee)
        _doDeposit(depositAmount, 250);
        assertEq(usdc.balanceOf(address(pool)), depositAmount);

        // Now set treasury and withdraw
        pool.setTreasury(treasuryAddr);
        uint256 withdrawAmount = 10_000_000; // 10 USDC (publicAmount = -10M)
        uint256 relayerFee = 30_000; // 0.03 USDC
        // protocolFee = max(10M * 10 / 10000, 10000) = max(10_000, 10000) = 10_000
        uint256 expectedProtocolFee = 10_000;
        // Recipient gets withdrawAmount - relayerFee (protocolFee NOT deducted from recipient)
        uint256 expectedRecipient = withdrawAmount - relayerFee;

        address bob = makeAddr("bob");
        ShieldedPoolV4.ExtData memory wExtData = _makeExtData(bob, relayerAddr, relayerFee);
        ShieldedPoolV4.TransactArgs memory wArgs = _makeWithdrawArgs(
            withdrawAmount, bytes32(uint256(0x4444)), wExtData, expectedProtocolFee
        );
        pool.transact(wArgs, wExtData);

        assertEq(usdc.balanceOf(bob), expectedRecipient);
        assertEq(usdc.balanceOf(relayerAddr), relayerFee);
        assertEq(usdc.balanceOf(treasuryAddr), expectedProtocolFee);
        // Pool had 10.01M, released 10M + 10K = 10.01M → 0
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    /// @notice No treasury set → no fee deducted, full amount transfers
    function test_protocolFee_noTreasury() public {
        // treasury is address(0) by default → no fee
        uint256 depositAmount = 10_000_000;

        _doDeposit(depositAmount, 300);

        assertEq(usdc.balanceOf(address(pool)), depositAmount); // full amount in pool
        assertEq(usdc.balanceOf(treasuryAddr), 0); // no fee
    }

    /// @notice Private transfer (publicAmount == 0) → collects circuit-enforced fee
    function test_protocolFee_privateTransfer_collectsFee() public {
        pool.setTreasury(treasuryAddr);

        // First deposit (treasury is now set, fee will be collected)
        _doDeposit(10_000_000, 400);
        uint256 treasuryBefore = usdc.balanceOf(treasuryAddr);

        // Private transfer (publicAmount = 0) — now collects circuit-enforced fee
        ShieldedPoolV4.ExtData memory extData = _makeExtData(address(0), address(0), 0);
        bytes32 root = pool.getLastRoot();
        bytes32 extDataHash = _computeExtDataHash(extData);

        bytes32[] memory nullifiers_ = new bytes32[](1);
        nullifiers_[0] = bytes32(uint256(0x7777));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x8888));
        commitments[1] = bytes32(uint256(0x9999));

        uint256 minFee = pool.minProtocolFee(); // 10000

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: root,
            publicAmount: int256(0),
            extDataHash: extDataHash,
            protocolFee: minFee,
            inputNullifiers: nullifiers_,
            outputCommitments: commitments,
            viewTags: _defaultViewTags()
        });

        pool.transact(args, extData);

        // Treasury receives the protocol fee from private transfer
        assertEq(usdc.balanceOf(treasuryAddr), treasuryBefore + minFee);
    }

    /// @notice setProtocolFee only callable by owner
    function test_setProtocolFee_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.setProtocolFee(20, 10000); // minProtocolFee = 10000
    }

    /// @notice Fee > 1% (100 bps) → revert FeeTooHigh
    function test_setProtocolFee_maxCap() public {
        vm.expectRevert(ShieldedPoolV4.FeeTooHigh.selector);
        pool.setProtocolFee(101, 10000); // 1.01% → revert

        // 1% exactly should work
        pool.setProtocolFee(100, 10000);
        assertEq(pool.protocolFeeBps(), 100);
    }

    /// @notice setTreasury with address(0) → revert InvalidTreasury
    function test_setTreasury_zeroAddress() public {
        vm.expectRevert(ShieldedPoolV4.InvalidTreasury.selector);
        pool.setTreasury(address(0));
    }

    /// @notice 1 USDC deposit → minFee applied (percent = 1000, minFee = 10000 → 10000 wins)
    function test_protocolFee_minFeeApplied() public {
        pool.setTreasury(treasuryAddr);

        uint256 depositAmount = 1_000_000; // 1 USDC
        // fee = max(1M * 10 / 10000, 10000) = max(1000, 10000) = 10000
        uint256 expectedFee = 10000; // 0.01 USDC

        _doDeposit(depositAmount, 500);

        assertEq(usdc.balanceOf(treasuryAddr), expectedFee);
        assertEq(usdc.balanceOf(address(pool)), depositAmount - expectedFee);
    }

    /// @notice 50 USDC deposit → percentFee applied (50000 > 10000)
    function test_protocolFee_percentApplied() public {
        pool.setTreasury(treasuryAddr);

        uint256 depositAmount = 50_000_000; // 50 USDC
        // fee = max(50M * 10 / 10000, 10000) = max(50_000, 10000) = 50_000
        uint256 expectedFee = 50_000; // 0.05 USDC

        _doDeposit(depositAmount, 600);

        assertEq(usdc.balanceOf(treasuryAddr), expectedFee);
        assertEq(usdc.balanceOf(address(pool)), depositAmount - expectedFee);
    }

    /// @notice Fuzz test: protocol fee is always max(percentFee, minFee) when treasury is set
    function test_fuzz_protocolFee(uint256 amount) public {
        // Bound to realistic USDC range: 0.01 USDC to 999 USDC (alice has 1000)
        amount = bound(amount, 10_000, 999_000_000);

        pool.setTreasury(treasuryAddr);

        uint256 percentFee = (amount * 10) / 10000;
        uint256 expectedFee = percentFee > 10000 ? percentFee : 10000;

        _doDeposit(amount, amount); // use amount as salt for uniqueness

        assertEq(usdc.balanceOf(treasuryAddr), expectedFee);
        assertEq(usdc.balanceOf(address(pool)), amount - expectedFee);
    }

    /// @notice ProtocolFeeCollected event emitted on deposit with treasury
    function test_protocolFee_emitsEvent() public {
        pool.setTreasury(treasuryAddr);

        uint256 depositAmount = 10_000_000;
        uint256 expectedFee = 10_000;

        ShieldedPoolV4.ExtData memory extData = _makeExtData(address(0), address(0), 0);
        ShieldedPoolV4.TransactArgs memory args = _makeDepositArgs(depositAmount, extData, 700, expectedFee);

        vm.expectEmit(true, false, false, false);
        emit ShieldedPoolV4.ProtocolFeeCollected(expectedFee);
        vm.prank(alice);
        pool.transact(args, extData);
    }
}
