// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {IPerplExchange} from "../../src/interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "../../src/interfaces/IAuthorizedToken.sol";
import {KeeperRegistry} from "../../src/KeeperRegistry.sol";
import {MirrorAccount} from "../../src/MirrorAccount.sol";
import {MirrorAccountFactory} from "../../src/MirrorAccountFactory.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";
import {MockPerplExchange} from "../mocks/MockPerplExchange.sol";

abstract contract MirrorBase is Test {
    uint256 internal constant BTC = 1;
    uint256 internal constant ETH = 20;
    uint256 internal constant SOL = 31;
    uint32 internal constant LEADER = 6;
    uint32 internal constant LEADER2 = 88;
    uint256 internal constant CAP = 25e6;

    uint8 internal constant OPEN_LONG = 0;
    uint8 internal constant OPEN_SHORT = 1;
    uint8 internal constant CLOSE_LONG = 2;
    uint8 internal constant CLOSE_SHORT = 3;
    uint8 internal constant LONG = 0;
    uint8 internal constant SHORT = 1;

    MockAUSD internal ausd;
    MockPerplExchange internal ex;
    KeeperRegistry internal registry;
    MirrorAccountFactory internal factory;
    MirrorAccount internal account;

    address internal owner;
    uint256 internal ownerKey;
    address internal keeper = makeAddr("keeper");
    address internal relayer = makeAddr("relayer");
    address internal stranger = makeAddr("stranger");
    address internal admin = makeAddr("admin");

    function setUp() public virtual {
        (owner, ownerKey) = makeAddrAndKey("owner");
        vm.warp(1_760_000_000);

        ausd = new MockAUSD();
        ex = new MockPerplExchange(ausd);
        ex.addPerp(BTC, "BTC", 5, 1, 855_000); // 85,500.0
        ex.addPerp(ETH, "ETH", 3, 2, 270_000); // 2,700.00
        ex.addPerp(SOL, "SOL", 3, 3, 120_000); // 120.000

        registry = new KeeperRegistry(admin);
        vm.prank(admin);
        registry.setKeeper(keeper, true);

        factory = new MirrorAccountFactory(
            IPerplExchange(address(ex)), IAuthorizedToken(address(ausd)), registry, CAP
        );
        account = factory.createAccount(owner, bytes32("follow-1"));

        // Leader 6 is long 0.01 BTC (1000 lots) and long 1 ETH (1000 lots).
        ex.setPosition(BTC, LEADER, LONG, 1000);
        ex.setPosition(ETH, LEADER, LONG, 1000);

        ausd.mint(owner, 100e6);
    }

    // ---- policy helpers -------------------------------------------------------------------------

    function _defaultPolicy() internal view returns (MirrorAccount.Policy memory p) {
        p.maxLeverageHdths = 500;
        p.maxSlippageBps = 50;
        p.dailyLossBps = 0;
        p.drawdownBps = 0;
        p.expiry = uint40(block.timestamp + 30 days);
        p.leaders = new MirrorAccount.LeaderRule[](1);
        p.leaders[0] = MirrorAccount.LeaderRule({accountId: LEADER, ratioBps: 100});
        p.markets = new MirrorAccount.MarketRule[](2);
        p.markets[0] = MirrorAccount.MarketRule({perpId: uint32(BTC), maxNotionalCNS: 15e6});
        p.markets[1] = MirrorAccount.MarketRule({perpId: uint32(ETH), maxNotionalCNS: 15e6});
    }

    function _fund(uint256 amount) internal {
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(account), amount, block.timestamp + 1 hours);
        vm.prank(relayer);
        account.depositWithPermit(amount, block.timestamp + 1 hours, v, r, s);
    }

    function _setUpFunded() internal {
        _fund(20e6);
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
    }

    function _order(uint8 orderType, uint256 perpId, uint64 lots, uint64 price, uint16 lev)
        internal
        pure
        returns (MirrorAccount.MirrorOrder memory o)
    {
        o.leaderAccountId = LEADER;
        o.perpId = uint32(perpId);
        o.orderType = orderType;
        o.lotLNS = lots;
        o.pricePNS = price;
        o.leverageHdths = lev;
        o.maxMatches = 0;
        o.leaderRef = keccak256(abi.encode(orderType, perpId, lots));
    }

    function _mirror(MirrorAccount.MirrorOrder memory o) internal returns (bool) {
        vm.prank(keeper);
        return account.mirror(o);
    }

    function _lots(uint256 perpId) internal view returns (uint8 side, uint256 lots) {
        (IPerplExchange.PositionInfoV2 memory p,,) =
            IPerplExchange(address(ex)).getPositionV2(perpId, account.perplAccountId());
        return (p.positionType, p.lotLNS);
    }

    // ---- signatures -----------------------------------------------------------------------------

    function _signPermit(address spender, uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                spender,
                value,
                ausd.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ausd.domainSeparator(), structHash));
        return vm.sign(ownerKey, digest);
    }

    function _signReceive(address to, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(ausd.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), owner, to, value, 0, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ausd.domainSeparator(), structHash));
        return vm.sign(ownerKey, digest);
    }

    function _action(uint8 kind, bytes memory data) internal view returns (MirrorAccount.Action memory a) {
        a.kind = kind;
        a.data = data;
        a.nonce = account.actionNonce();
        a.deadline = block.timestamp + 10 minutes;
    }

    function _signAction(MirrorAccount.Action memory a, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = account.actionDigest(a);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
