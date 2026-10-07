// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "../src/interfaces/IAuthorizedToken.sol";
import {KeeperRegistry} from "../src/KeeperRegistry.sol";
import {MirrorAccountFactory} from "../src/MirrorAccountFactory.sol";

/// Deploys KeeperRegistry and MirrorAccountFactory (which deploys the MirrorAccount implementation) and
/// registers the keeper set. For local forks and tests only.
///
/// Do not broadcast this with forge on Monad: forge sizes gas limits from its own Ethereum-priced simulation, and
/// Monad charges the full gas limit. Deploy to Monad testnet or mainnet with scripts/deploy-contracts.mjs, which
/// takes every limit from Monad's own eth_estimateGas plus headroom. On a local anvil fork:
///
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key <anvil test key> \
///     --broadcast --disable-code-size-limit
///
/// Env: PERPL_EXCHANGE, COLLATERAL_TOKEN, DEPOSIT_CAP (6-decimal units), KEEPERS (comma-separated),
///      WRITE_DEPLOYMENT=true to record deployments/<chainId>.json.
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
