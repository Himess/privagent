// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PoseidonHasher.sol";
import "../src/Groth16Verifier.sol";
import "../src/ShieldedPool.sol";
import "../src/StealthRegistry.sol";

contract Deploy is Script {
    // Base Sepolia USDC
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PoseidonHasher
        PoseidonHasher hasher = new PoseidonHasher();
        console.log("PoseidonHasher:", address(hasher));

        // 2. Deploy Groth16Verifier
        Groth16Verifier verifier = new Groth16Verifier();
        console.log("Groth16Verifier:", address(verifier));

        // 3. Deploy ShieldedPool
        ShieldedPool pool = new ShieldedPool(
            address(verifier),
            address(hasher),
            USDC
        );
        console.log("ShieldedPool:", address(pool));

        // 4. Deploy StealthRegistry
        StealthRegistry registry = new StealthRegistry();
        console.log("StealthRegistry:", address(registry));

        vm.stopBroadcast();
    }
}
