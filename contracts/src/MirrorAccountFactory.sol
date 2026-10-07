// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {IPerplExchange} from "./interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "./interfaces/IAuthorizedToken.sol";
import {KeeperRegistry} from "./KeeperRegistry.sol";
import {MirrorAccount} from "./MirrorAccount.sol";

/// @title MirrorAccountFactory
/// @notice Deploys one MirrorAccount per (owner, salt) as a non-upgradeable EIP-1167 clone. Anyone may deploy
///         an account for an owner: the owner is fixed at creation and only the owner controls it.
contract MirrorAccountFactory {
    address public immutable implementation;
    IPerplExchange public immutable exchange;
    IAuthorizedToken public immutable collateral;
    KeeperRegistry public immutable keepers;
    uint256 public immutable depositCap;
    uint8 public immutable builderId;
    uint16 public immutable builderFeePer100K;

    mapping(address account => bool) public isAccount;

    event AccountCreated(address indexed owner, address indexed account, bytes32 salt);

    constructor(
        IPerplExchange exchange_,
        IAuthorizedToken collateral_,
        KeeperRegistry keepers_,
        uint256 depositCap_,
        uint8 builderId_,
        uint16 builderFeePer100K_
    ) {
        exchange = exchange_;
        collateral = collateral_;
        keepers = keepers_;
        depositCap = depositCap_;
        builderId = builderId_;
        builderFeePer100K = builderFeePer100K_;
        implementation = address(
            new MirrorAccount(exchange_, collateral_, keepers_, address(this), depositCap_, builderId_, builderFeePer100K_)
        );
    }

    function createAccount(address owner, bytes32 salt) external returns (MirrorAccount account) {
        account = MirrorAccount(Clones.cloneDeterministic(implementation, _salt(owner, salt)));
        account.initialize(owner);
        isAccount[address(account)] = true;
        emit AccountCreated(owner, address(account), salt);
    }

    function predictAccount(address owner, bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(owner, salt), address(this));
    }

    function _salt(address owner, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
