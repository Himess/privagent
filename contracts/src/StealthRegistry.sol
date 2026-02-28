// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title StealthRegistry
 * @notice Registry for stealth meta-addresses (ERC-5564 compatible)
 */
contract StealthRegistry {
    struct StealthMetaAddress {
        uint256 spendingPubKeyX;
        uint256 spendingPubKeyY;
        uint256 viewingPubKeyX;
        uint256 viewingPubKeyY;
        uint256 registeredAt;
    }

    struct Announcement {
        uint256 schemeId;
        address stealthAddress;
        address caller;
        bytes ephemeralPubKey;
        bytes metadata;
        uint256 timestamp;
    }

    uint256 public constant MAX_ANNOUNCEMENTS_PER_CALLER = 1000; // [SC-H5]
    mapping(address => StealthMetaAddress) public stealthAddresses;
    mapping(address => bool) public isRegistered;
    Announcement[] public announcements;
    mapping(uint256 => uint256[]) public announcementsByViewTag;
    mapping(address => uint256) public announcementCount; // [SC-H5]

    event StealthMetaAddressRegistered(
        address indexed registrant,
        uint256 spendingPubKeyX,
        uint256 spendingPubKeyY,
        uint256 viewingPubKeyX,
        uint256 viewingPubKeyY
    );

    event AnnouncementCreated(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function registerStealthMetaAddress(
        uint256 spendingPubKeyX,
        uint256 spendingPubKeyY,
        uint256 viewingPubKeyX,
        uint256 viewingPubKeyY
    ) external {
        require(!isRegistered[msg.sender], "Already registered");
        require(spendingPubKeyX != 0 || spendingPubKeyY != 0, "Invalid spending key");
        require(viewingPubKeyX != 0 || viewingPubKeyY != 0, "Invalid viewing key");

        stealthAddresses[msg.sender] = StealthMetaAddress({
            spendingPubKeyX: spendingPubKeyX,
            spendingPubKeyY: spendingPubKeyY,
            viewingPubKeyX: viewingPubKeyX,
            viewingPubKeyY: viewingPubKeyY,
            registeredAt: block.timestamp
        });

        isRegistered[msg.sender] = true;

        emit StealthMetaAddressRegistered(
            msg.sender,
            spendingPubKeyX,
            spendingPubKeyY,
            viewingPubKeyX,
            viewingPubKeyY
        );
    }

    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        uint256 viewTag,
        bytes calldata metadata
    ) external {
        require(announcementCount[msg.sender] < MAX_ANNOUNCEMENTS_PER_CALLER, "Rate limit exceeded"); // [SC-H5]
        announcementCount[msg.sender]++;
        uint256 index = announcements.length;

        announcements.push(Announcement({
            schemeId: schemeId,
            stealthAddress: stealthAddress,
            caller: msg.sender,
            ephemeralPubKey: ephemeralPubKey,
            metadata: metadata,
            timestamp: block.timestamp
        }));

        announcementsByViewTag[viewTag].push(index);

        emit AnnouncementCreated(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }

    function getStealthMetaAddress(address user) external view returns (StealthMetaAddress memory) {
        require(isRegistered[user], "Not registered");
        return stealthAddresses[user];
    }

    function isUserRegistered(address user) external view returns (bool) {
        return isRegistered[user];
    }

    function getAnnouncement(uint256 index) external view returns (Announcement memory) {
        require(index < announcements.length, "Invalid index");
        return announcements[index];
    }

    function getAnnouncementsByViewTag(uint256 viewTag) external view returns (uint256[] memory) {
        return announcementsByViewTag[viewTag];
    }

    function getAnnouncementCount() external view returns (uint256) {
        return announcements.length;
    }
}
