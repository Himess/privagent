// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/StealthRegistry.sol";

contract StealthRegistryTest is Test {
    StealthRegistry public registry;
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        registry = new StealthRegistry();
    }

    // ============ Registration ============

    function test_register() public {
        vm.prank(alice);
        registry.registerStealthMetaAddress(1, 2, 3, 4);

        assertTrue(registry.isUserRegistered(alice));

        StealthRegistry.StealthMetaAddress memory meta = registry.getStealthMetaAddress(alice);
        assertEq(meta.spendingPubKeyX, 1);
        assertEq(meta.spendingPubKeyY, 2);
        assertEq(meta.viewingPubKeyX, 3);
        assertEq(meta.viewingPubKeyY, 4);
    }

    function test_register_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit StealthRegistry.StealthMetaAddressRegistered(alice, 10, 20, 30, 40);
        registry.registerStealthMetaAddress(10, 20, 30, 40);
    }

    function test_register_twice_reverts() public {
        vm.prank(alice);
        registry.registerStealthMetaAddress(1, 2, 3, 4);

        vm.prank(alice);
        vm.expectRevert("Already registered");
        registry.registerStealthMetaAddress(5, 6, 7, 8);
    }

    function test_register_zeroSpendingKey_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Invalid spending key");
        registry.registerStealthMetaAddress(0, 0, 3, 4);
    }

    function test_register_zeroViewingKey_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Invalid viewing key");
        registry.registerStealthMetaAddress(1, 2, 0, 0);
    }

    function test_getStealthMetaAddress_notRegistered_reverts() public {
        vm.expectRevert("Not registered");
        registry.getStealthMetaAddress(alice);
    }

    function test_isUserRegistered_false() public view {
        assertFalse(registry.isUserRegistered(alice));
    }

    // ============ Announcements ============

    function test_announce() public {
        vm.prank(alice);
        registry.announce(1, bob, hex"1234", 42, hex"abcd");

        assertEq(registry.getAnnouncementCount(), 1);

        StealthRegistry.Announcement memory ann = registry.getAnnouncement(0);
        assertEq(ann.schemeId, 1);
        assertEq(ann.stealthAddress, bob);
        assertEq(ann.caller, alice);
        assertEq(ann.ephemeralPubKey, hex"1234");
        assertEq(ann.metadata, hex"abcd");
    }

    function test_announce_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit StealthRegistry.AnnouncementCreated(1, bob, alice, hex"1234", hex"abcd");
        registry.announce(1, bob, hex"1234", 42, hex"abcd");
    }

    function test_announce_viewTagIndex() public {
        vm.prank(alice);
        registry.announce(1, bob, hex"aa", 99, hex"");

        uint256[] memory indices = registry.getAnnouncementsByViewTag(99);
        assertEq(indices.length, 1);
        assertEq(indices[0], 0);
    }

    function test_announce_multiple() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(alice);
            registry.announce(1, bob, abi.encodePacked(i), i, hex"");
        }
        assertEq(registry.getAnnouncementCount(), 5);
    }

    function test_getAnnouncement_invalidIndex_reverts() public {
        vm.expectRevert("Invalid index");
        registry.getAnnouncement(0);
    }

    // ============ Rate Limiting [SC-H5] ============

    function test_announce_rateLimit() public {
        // Should be able to announce up to MAX_ANNOUNCEMENTS_PER_CALLER
        uint256 maxAnn = registry.MAX_ANNOUNCEMENTS_PER_CALLER();
        assertTrue(maxAnn == 1000);
    }

    function test_announce_exceedsRateLimit_reverts() public {
        uint256 maxAnn = registry.MAX_ANNOUNCEMENTS_PER_CALLER();

        // Fast-forward: make MAX announcements
        for (uint256 i = 0; i < maxAnn; i++) {
            vm.prank(alice);
            registry.announce(1, bob, abi.encodePacked(i), 0, hex"");
        }

        // One more should revert
        vm.prank(alice);
        vm.expectRevert("Rate limit exceeded");
        registry.announce(1, bob, hex"ff", 0, hex"");
    }

    // ============ Additional Tests ============

    function test_stealth_differentSchemeIds() public {
        // ERC-5564 allows multiple scheme IDs
        vm.prank(alice);
        registry.announce(1, bob, hex"aa", 0, hex""); // scheme 1 (secp256k1)

        vm.prank(alice);
        registry.announce(2, bob, hex"bb", 0, hex""); // scheme 2 (ed25519)

        assertEq(registry.getAnnouncementCount(), 2);

        StealthRegistry.Announcement memory ann0 = registry.getAnnouncement(0);
        StealthRegistry.Announcement memory ann1 = registry.getAnnouncement(1);
        assertEq(ann0.schemeId, 1);
        assertEq(ann1.schemeId, 2);
    }

    function test_stealth_getAnnouncementsPagination() public {
        // Create 20 announcements with different view tags
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(alice);
            registry.announce(1, bob, abi.encodePacked(i), i % 5, hex"");
        }

        assertEq(registry.getAnnouncementCount(), 20);

        // View tag 0 should have 4 entries (indices 0, 5, 10, 15)
        uint256[] memory tag0 = registry.getAnnouncementsByViewTag(0);
        assertEq(tag0.length, 4);

        // View tag 3 should have 4 entries (indices 3, 8, 13, 18)
        uint256[] memory tag3 = registry.getAnnouncementsByViewTag(3);
        assertEq(tag3.length, 4);
    }

    function testFuzz_register_values(uint256 sx, uint256 sy, uint256 vx, uint256 vy) public {
        vm.assume(sx != 0 || sy != 0); // valid spending key
        vm.assume(vx != 0 || vy != 0); // valid viewing key

        vm.prank(alice);
        registry.registerStealthMetaAddress(sx, sy, vx, vy);

        StealthRegistry.StealthMetaAddress memory meta = registry.getStealthMetaAddress(alice);
        assertEq(meta.spendingPubKeyX, sx);
        assertEq(meta.spendingPubKeyY, sy);
        assertEq(meta.viewingPubKeyX, vx);
        assertEq(meta.viewingPubKeyY, vy);
    }

    function test_announce_rateLimitPerCaller() public {
        // Alice reaches limit
        uint256 maxAnn = registry.MAX_ANNOUNCEMENTS_PER_CALLER();
        for (uint256 i = 0; i < maxAnn; i++) {
            vm.prank(alice);
            registry.announce(1, bob, abi.encodePacked(i), 0, hex"");
        }

        // Bob can still announce
        vm.prank(bob);
        registry.announce(1, alice, hex"aa", 0, hex"");
        assertEq(registry.announcementCount(bob), 1);
    }
}
