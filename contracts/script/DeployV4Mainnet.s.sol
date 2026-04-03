// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PoseidonHasher.sol";
import "../src/verifiers/Groth16Verifier_1x2.sol";
import "../src/verifiers/Groth16Verifier_2x2.sol";
import "../src/ShieldedPoolV4.sol";

contract DeployV4Mainnet is Script {
    // Base Mainnet USDC (Circle)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PoseidonHasher
        PoseidonHasher hasher = new PoseidonHasher();
        console.log("PoseidonHasher:", address(hasher));

        // 2. Deploy Groth16Verifier_1x2
        Groth16Verifier_1x2 verifier1x2 = new Groth16Verifier_1x2();
        console.log("Groth16Verifier_1x2:", address(verifier1x2));

        // 3. Deploy Groth16Verifier_2x2
        Groth16Verifier_2x2 verifier2x2 = new Groth16Verifier_2x2();
        console.log("Groth16Verifier_2x2:", address(verifier2x2));

        // 4. Deploy ShieldedPoolV4
        ShieldedPoolV4 pool = new ShieldedPoolV4(
            address(hasher),
            USDC,
            address(verifier1x2),
            address(verifier2x2)
        );
        console.log("ShieldedPoolV4:", address(pool));

        // 5. Set treasury to deployer
        pool.setTreasury(vm.addr(deployerPrivateKey));
        console.log("Treasury set to deployer:", vm.addr(deployerPrivateKey));

        vm.stopBroadcast();
    }
}
