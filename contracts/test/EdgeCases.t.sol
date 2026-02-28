// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ShieldedPoolV4.sol";
import "../src/PoseidonHasher.sol";
import "./mocks/MockUSDC.sol";
import "./mocks/MockVerifier1x2.sol";
import "./mocks/MockVerifier2x2.sol";

/// @notice Reentrant ERC20 that calls back into pool on transfer
contract ReentrantUSDC {
    string public name = "Reentrant USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public target;
    bytes public attackData;
    bool public attacking;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setAttack(address _target, bytes calldata _data) external {
        target = _target;
        attackData = _data;
        attacking = true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        if (attacking) {
            attacking = false;
            (bool ok,) = target.call(attackData);
            // If reentrancy guard works, ok will be false
            require(!ok, "Reentrancy should have failed");
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract EdgeCasesTest is Test {
    ShieldedPoolV4 public pool;
    PoseidonHasher public hasher;
    MockVerifier1x2 public verifier1x2;
    MockVerifier2x2 public verifier2x2;
    MockUSDC public usdc;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public relayerAddr = makeAddr("relayer");

    uint256 constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

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

        usdc.mint(alice, 10_000_000_000_000); // 10M USDC
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
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

    function _doDeposit(uint256 amount, uint256 salt) internal {
        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: address(0),
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"aabbcc",
            encryptedOutput2: hex"ddeeff"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(keccak256(abi.encode("edge_null", salt))));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(keccak256(abi.encode("edge_c0", salt))));
        commitments[1] = bytes32(uint256(keccak256(abi.encode("edge_c1", salt))));

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

        vm.prank(alice);
        pool.transact(args, extData);
    }

    // ============ Root Eviction ============

    function test_rootEviction_101stDeposit() public {
        bytes32 firstRoot;

        // Do 101 deposits → first root should be evicted from history (size=100)
        // Each deposit inserts 2 leaves → 2 root updates per deposit
        // Actually, each transact() call inserts N output commitments, each updating root.
        // But ROOT_HISTORY_SIZE=100 stores last 100 roots.
        // After 51 deposits (51 transact calls, each inserting 2 leaves = 102 root updates),
        // the first root should be evicted.
        for (uint256 i = 0; i < 52; i++) {
            _doDeposit(1_000_000, i);
            if (i == 0) firstRoot = pool.getLastRoot();
        }

        // First root should now be evicted (52 * 2 = 104 root updates > 100)
        assertFalse(pool.isKnownRoot(firstRoot));

        // Latest root should still be valid
        assertTrue(pool.isKnownRoot(pool.getLastRoot()));
    }

    // ============ Zero Amount Transfer (Pure Private Transfer) ============

    function test_zeroAmount_pureTransfer() public {
        _doDeposit(5_000_000, 100);

        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: address(0),
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"aa",
            encryptedOutput2: hex"bb"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(0xfafa));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0xfb00));
        commitments[1] = bytes32(uint256(0xfb01));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: int256(0), // pure transfer
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        uint256 poolBefore = usdc.balanceOf(address(pool));
        pool.transact(args, extData);
        uint256 poolAfter = usdc.balanceOf(address(pool));

        // No USDC movement
        assertEq(poolBefore, poolAfter);
        assertTrue(pool.nullifiers(nullifiers[0]));
    }

    // ============ Multiple Withdrawals Same Block ============

    function test_multipleWithdrawals_sameBlock() public {
        _doDeposit(50_000_000, 200); // 50 USDC

        // 5 withdrawals in same block
        for (uint256 i = 0; i < 5; i++) {
            ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
                recipient: bob,
                relayer: address(0),
                fee: 0,
                encryptedOutput1: hex"cc",
                encryptedOutput2: hex"dd"
            });

            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = bytes32(uint256(keccak256(abi.encode("multi_w", i))));
            bytes32[] memory commitments = new bytes32[](2);
            commitments[0] = bytes32(uint256(keccak256(abi.encode("multi_wc0", i))));
            commitments[1] = bytes32(uint256(keccak256(abi.encode("multi_wc1", i))));

            ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
                pA: [uint256(0), uint256(0)],
                pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
                pC: [uint256(0), uint256(0)],
                root: pool.getLastRoot(),
                publicAmount: -int256(1_000_000), // 1 USDC each
                extDataHash: _computeExtDataHash(extData),
                inputNullifiers: nullifiers,
                outputCommitments: commitments
            });

            pool.transact(args, extData);
        }

        // 50 - 5 = 45 USDC remaining
        assertEq(usdc.balanceOf(address(pool)), 45_000_000);
        assertEq(usdc.balanceOf(bob), 5_000_000);
    }

    // ============ Self Transfer (Consolidation) ============

    function test_selfTransfer_consolidation() public {
        _doDeposit(10_000_000, 300);

        // Self-transfer with 2x2 (consolidate 2 UTXOs into 1)
        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: address(0),
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"ee",
            encryptedOutput2: hex"ff"
        });

        bytes32 null1 = bytes32(uint256(0xc0c0));
        bytes32 null2 = bytes32(uint256(0xc1c1));

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = null1;
        nullifiers[1] = null2;
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0xd0d0));
        commitments[1] = bytes32(uint256(0xd1d1));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: int256(0), // self transfer
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        uint256 poolBefore = usdc.balanceOf(address(pool));
        pool.transact(args, extData);

        // Pool balance unchanged
        assertEq(usdc.balanceOf(address(pool)), poolBefore);
        assertTrue(pool.nullifiers(null1));
        assertTrue(pool.nullifiers(null2));
    }

    // ============ Dust Amount ============

    function test_dustAmount_1wei() public {
        usdc.mint(alice, 1);
        _doDeposit(1, 400); // 1 wei USDC

        assertEq(usdc.balanceOf(address(pool)), 1);

        // Withdraw 1 wei
        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: bob,
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"01",
            encryptedOutput2: hex"02"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(0xddd1));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0xddd2));
        commitments[1] = bytes32(uint256(0xddd3));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: -int256(1),
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        pool.transact(args, extData);

        assertEq(usdc.balanceOf(address(pool)), 0);
        assertEq(usdc.balanceOf(bob), 1);
    }

    // ============ Max Deposit Amount ============

    function test_maxDeposit_exactLimit() public {
        uint256 maxDeposit = pool.MAX_DEPOSIT();
        usdc.mint(alice, maxDeposit);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);

        _doDeposit(maxDeposit, 500);
        assertEq(usdc.balanceOf(address(pool)), maxDeposit);
    }

    // ============ Reentrancy with Malicious Token ============

    function test_reentrancy_withMaliciousToken() public {
        ReentrantUSDC malToken = new ReentrantUSDC();
        ShieldedPoolV4 malPool = new ShieldedPoolV4(
            address(hasher),
            address(malToken),
            address(verifier1x2),
            address(verifier2x2)
        );

        // Fund pool with tokens directly
        malToken.mint(address(malPool), 10_000_000);

        // Prepare withdraw args
        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: address(this),
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"aa",
            encryptedOutput2: hex"bb"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(0xeeee));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0xffff));
        commitments[1] = bytes32(uint256(0x1010));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: malPool.getLastRoot(),
            publicAmount: -int256(1_000_000),
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        // Set up the attack: on transfer, try to call transact() again
        bytes32[] memory nullifiers2 = new bytes32[](1);
        nullifiers2[0] = bytes32(uint256(0xeeef));
        bytes32[] memory commitments2 = new bytes32[](2);
        commitments2[0] = bytes32(uint256(0xfff0));
        commitments2[1] = bytes32(uint256(0x1011));

        ShieldedPoolV4.TransactArgs memory args2 = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: malPool.getLastRoot(),
            publicAmount: -int256(1_000_000),
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers2,
            outputCommitments: commitments2
        });

        bytes memory attackPayload = abi.encodeCall(ShieldedPoolV4.transact, (args2, extData));
        malToken.setAttack(address(malPool), attackPayload);

        // The reentrancy attack via malicious token should fail
        // because ReentrancyGuard on transact() blocks re-entry.
        // The ReentrantUSDC.transfer reverts with "Reentrancy should have failed"
        // if the reentrant call succeeds. If nonReentrant blocks it, ok=false,
        // and the require(!ok) passes, so the outer transfer completes.
        malPool.transact(args, extData);

        // If we got here, reentrancy was blocked
        assertTrue(true);
    }

    // ============ Leaf Index Monotonic ============

    function test_leafIndex_monotonic() public {
        uint256 prev = pool.nextLeafIndex();
        for (uint256 i = 0; i < 10; i++) {
            _doDeposit(1_000_000, 600 + i);
            uint256 curr = pool.nextLeafIndex();
            assertTrue(curr > prev);
            prev = curr;
        }
    }

    // ============ publicAmount int256.min Boundary ============

    function test_publicAmount_intMinReverts() public {
        ShieldedPoolV4.ExtData memory extData = ShieldedPoolV4.ExtData({
            recipient: bob,
            relayer: address(0),
            fee: 0,
            encryptedOutput1: hex"aa",
            encryptedOutput2: hex"bb"
        });

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = bytes32(uint256(0x9999));
        bytes32[] memory commitments = new bytes32[](2);
        commitments[0] = bytes32(uint256(0x9a9a));
        commitments[1] = bytes32(uint256(0x9b9b));

        ShieldedPoolV4.TransactArgs memory args = ShieldedPoolV4.TransactArgs({
            pA: [uint256(0), uint256(0)],
            pB: [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            pC: [uint256(0), uint256(0)],
            root: pool.getLastRoot(),
            publicAmount: type(int256).min,
            extDataHash: _computeExtDataHash(extData),
            inputNullifiers: nullifiers,
            outputCommitments: commitments
        });

        vm.expectRevert(ShieldedPoolV4.InvalidPublicAmountRange.selector);
        pool.transact(args, extData);
    }

    // ============ Tree Full Check (Simulated) ============

    function test_treeInfo_returnsCorrectValues() public {
        (uint256 nextLeaf, uint256 maxLeaves, bytes32 root) = pool.getTreeInfo();
        assertEq(nextLeaf, 0);
        assertEq(maxLeaves, 65536);
        assertTrue(root != bytes32(0));

        _doDeposit(1_000_000, 700);

        (nextLeaf, maxLeaves, root) = pool.getTreeInfo();
        assertEq(nextLeaf, 2);
        assertEq(maxLeaves, 65536);
    }
}
