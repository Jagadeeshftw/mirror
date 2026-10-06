// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "../src/interfaces/IAuthorizedToken.sol";

/// Opens the team-run demo leader's Perpl account: approves AUSD and calls Exchange.createAccount from
/// the broadcasting EOA. Run by the wallet owner (it deposits real funds):
///
///   forge script script/DemoLeaderSetup.s.sol --rpc-url https://rpc.monad.xyz \
///     --private-key $OPS_PRIVATE_KEY --broadcast --gas-estimate-multiplier 120
///
/// Env: DEMO_LEADER_DEPOSIT (6-decimal units, default 10_000_000 = 10.00 AUSD, Perpl's minimum).
contract DemoLeaderSetup is Script {
    IPerplExchange constant EXCHANGE = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IAuthorizedToken constant AUSD = IAuthorizedToken(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);

    function run() external {
        uint256 amount = vm.envOr("DEMO_LEADER_DEPOSIT", uint256(10_000_000));
        uint256 minOpen = EXCHANGE.getMinAccountOpenCNS();
        require(amount >= minOpen, "below Perpl minimum account open");

        vm.startBroadcast();
        address leader = msg.sender;
        require(EXCHANGE.getAccountByAddr(leader).accountId == 0, "leader already has a Perpl account");
        require(AUSD.balanceOf(leader) >= amount, "not enough AUSD in the leader wallet");
        AUSD.approve(address(EXCHANGE), amount);
        uint256 id = EXCHANGE.createAccount(amount);
        vm.stopBroadcast();

        console.log("demo leader address   ", leader);
        console.log("demo leader account id", id);
    }
}
