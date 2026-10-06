// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "../src/interfaces/IAuthorizedToken.sol";
import {KeeperRegistry} from "../src/KeeperRegistry.sol";
import {MirrorAccountFactory} from "../src/MirrorAccountFactory.sol";

/// Deploys KeeperRegistry and MirrorAccountFactory (which deploys the MirrorAccount implementation) and
/// registers the keeper set.
///
///   forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --private-key $OPS_PRIVATE_KEY \
///     --broadcast --verify --verifier sourcify   (see docs/deploy.md)
///
/// Env: PERPL_EXCHANGE, COLLATERAL_TOKEN, DEPOSIT_CAP (6-decimal units), KEEPERS (comma-separated),
///      WRITE_DEPLOYMENT=true to record deployments/<chainId>.json (set it only for the real broadcast).
contract Deploy is Script {
    function run() external returns (KeeperRegistry registry, MirrorAccountFactory factory) {
        address exchange = vm.envOr("PERPL_EXCHANGE", address(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F));
        address collateral = vm.envOr("COLLATERAL_TOKEN", address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a));
        uint256 cap = vm.envOr("DEPOSIT_CAP", uint256(25e6));
        address[] memory keepers = vm.envOr("KEEPERS", ",", new address[](0));

        vm.startBroadcast();
        address admin = msg.sender;
        registry = new KeeperRegistry(admin);
        factory = new MirrorAccountFactory(IPerplExchange(exchange), IAuthorizedToken(collateral), registry, cap);
        if (keepers.length > 0) registry.setKeepers(keepers, true);
        vm.stopBroadcast();

        console.log("KeeperRegistry       ", address(registry));
        console.log("MirrorAccountFactory ", address(factory));
        console.log("MirrorAccount impl   ", factory.implementation());
        console.log("admin                ", admin);
        console.log("deposit cap          ", cap);

        string memory json = string.concat(
            '{"chainId":', vm.toString(block.chainid),
            ',"keeperRegistry":"', vm.toString(address(registry)),
            '","factory":"', vm.toString(address(factory)),
            '","implementation":"', vm.toString(factory.implementation()),
            '","exchange":"', vm.toString(exchange),
            '","collateral":"', vm.toString(collateral),
            '","depositCap":', vm.toString(cap),
            ',"block":', vm.toString(block.number), "}"
        );
        // Only real broadcasts record a deployment (fork dry runs use the same chain id).
        if (vm.envOr("WRITE_DEPLOYMENT", false)) {
            vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
        }
    }
}
