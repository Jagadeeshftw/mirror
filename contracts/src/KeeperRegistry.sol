// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title KeeperRegistry
/// @notice The set of addresses allowed to submit copied orders through MirrorAccounts.
/// @dev Keepers can only call MirrorAccount.mirror, which is bounded by each follower's onchain policy and
///      can never move collateral out of an account. The registry owner can rotate keepers but has no
///      access to any account's funds.
contract KeeperRegistry is Ownable2Step {
    mapping(address keeper => bool) public isKeeper;

    event KeeperSet(address indexed keeper, bool allowed);

    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setKeepers(address[] calldata keepers, bool allowed) external onlyOwner {
        for (uint256 i; i < keepers.length; ++i) {
            if (keepers[i] == address(0)) revert ZeroAddress();
            isKeeper[keepers[i]] = allowed;
            emit KeeperSet(keepers[i], allowed);
        }
    }
}
