// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {IPerplExchange} from "../../src/interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "../../src/interfaces/IAuthorizedToken.sol";
import {KeeperRegistry} from "../../src/KeeperRegistry.sol";
import {MirrorAccount} from "../../src/MirrorAccount.sol";
import {MirrorAccountFactory} from "../../src/MirrorAccountFactory.sol";

interface IPerplPositions {
    function getPositionsV2(uint256 perpId, uint256 pageStartPositionId, uint256 positionsPerPage)
        external
        view
        returns (IPerplExchange.PositionInfoV2[] memory positions, uint256 numPositions, uint256 markPricePNS, bool markPriceValid);
}

interface IPermitDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address) external view returns (uint256);
}

/// Runs MirrorAccount against the live Perpl Exchange and AUSD on Monad mainnet (forked).
/// Skipped unless MONAD_RPC_URL is set:  MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc PerplMainnetFork -vv
contract PerplMainnetForkTest is Test {
    IPerplExchange constant EXCHANGE = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IAuthorizedToken constant AUSD = IAuthorizedToken(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant BTC = 1;

    KeeperRegistry registry;
    MirrorAccountFactory factory;
    MirrorAccount account;
    address owner;
    uint256 ownerKey;
    address keeper = makeAddr("keeper");
    uint32 leader;
    uint256 leaderLots;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;

        (owner, ownerKey) = makeAddrAndKey("fork-owner");
        registry = new KeeperRegistry(address(this));
        registry.setKeeper(keeper, true);
        factory = new MirrorAccountFactory(EXCHANGE, AUSD, registry, 25e6);
        account = factory.createAccount(owner, bytes32("fork"));
        // AUSD uses namespaced storage that forge's deal() cannot locate; fund from a large holder on the fork.
        vm.prank(address(EXCHANGE));
        AUSD.transfer(owner, 30e6);

        // Pick a live BTC long with enough size that 1% of it is at least one lot.
        (IPerplExchange.PositionInfoV2[] memory ps,,,) = IPerplPositions(address(EXCHANGE)).getPositionsV2(BTC, 0, 50);
        for (uint256 i; i < ps.length; ++i) {
            if (ps[i].positionType == 0 && ps[i].lotLNS >= 200) {
                leader = uint32(ps[i].accountId);
                leaderLots = ps[i].lotLNS;
                break;
            }
        }
    }

    function _policy() internal view returns (MirrorAccount.Policy memory p) {
        p.maxLeverageHdths = 300;
        p.maxSlippageBps = 80;
        p.dailyLossBps = 500;
        p.drawdownBps = 1500;
        p.expiry = uint40(block.timestamp + 7 days);
        p.leaders = new MirrorAccount.LeaderRule[](1);
        p.leaders[0] = MirrorAccount.LeaderRule({accountId: leader, ratioBps: 100});
        p.markets = new MirrorAccount.MarketRule[](1);
        p.markets[0] = MirrorAccount.MarketRule({perpId: uint32(BTC), maxNotionalCNS: 10e6});
    }

    function _depositWithRealPermit(uint256 amount) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(account),
                amount,
                IPermitDomain(address(AUSD)).nonces(owner),
                deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IPermitDomain(address(AUSD)).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        account.depositWithPermit(amount, deadline, v, r, s);
    }

    function test_fork_fullLifecycleAgainstLivePerpl() public {
        if (!forked) return;
        require(leader != 0, "no suitable live leader found");
        console.log("leader account", leader, "lots", leaderLots);

        // 1. Gasless deposit with a real AUSD permit creates a real Perpl account owned by the contract.
        _depositWithRealPermit(12e6);
        uint256 acct = account.perplAccountId();
        assertGt(acct, 0);
        IPerplExchange.AccountInfo memory info = EXCHANGE.getAccountById(acct);
        assertEq(info.accountAddr, address(account));
        assertEq(info.balanceCNS, 12e6);
        console.log("perpl account", acct);

        vm.prank(owner);
        account.setPolicy(_policy());

        (, uint256 mark, bool valid) = EXCHANGE.getPositionV2(BTC, acct);
        assertTrue(valid, "mark invalid on fork");

        // 2. A rule hit is recorded onchain and trades nothing.
        MirrorAccount.MirrorOrder memory o = MirrorAccount.MirrorOrder({
            leaderAccountId: leader,
            perpId: uint32(BTC),
            orderType: 0,
            lotLNS: 1,
            pricePNS: uint64(mark * 10_060 / 10_000),
            leverageHdths: 1000, // 10x > 3x max
            maxMatches: 50,
            leaderRef: bytes32("leader-fill")
        });
        vm.prank(keeper);
        assertFalse(account.mirror(o));
        (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(BTC, acct);
        assertEq(pos.lotLNS, 0);
        console.log("10x copy vs a 3x rule: BLOCKED onchain (LeverageTooHigh), position still", pos.lotLNS, "lots");

        // 3. A compliant copy fills against Perpl's live BTC book (IOC, bounded by slippage).
        o.leverageHdths = 200;
        vm.prank(keeper);
        assertTrue(account.mirror(o));
        (pos,,) = EXCHANGE.getPositionV2(BTC, acct);
        console.log("2x copy, 1 lot BTC: FILLED on Perpl's live order book, position now", pos.lotLNS, "lot");
        console.log("lots after open", pos.lotLNS, "deposit", pos.depositCNS);
        assertEq(pos.positionType, 0);
        assertLe(pos.lotLNS, 1);

        // 4. The keeper still cannot withdraw.
        vm.prank(keeper);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.withdraw(1e6);
        console.log("keeper tries to withdraw: REVERTED (NotOwner)");

        // 5. Owner closes everything with a signed action relayed by a third party, then withdraws.
        MirrorAccount.Action memory a = MirrorAccount.Action({
            kind: account.ACTION_CLOSE_ALL(),
            data: abi.encode(uint16(100)),
            nonce: account.actionNonce(),
            deadline: block.timestamp + 10 minutes
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, account.actionDigest(a));
        account.execute(a, abi.encodePacked(r, s, v));
        (pos,,) = EXCHANGE.getPositionV2(BTC, acct);
        assertEq(pos.lotLNS, 0, "position not closed");

        uint256 eq = account.equity();
        console.log("equity after round trip", eq);
        assertGt(eq, 11e6); // fees on a $0.85 round trip are cents
        uint256 before = AUSD.balanceOf(owner);
        vm.prank(owner);
        account.withdraw(eq);
        assertEq(AUSD.balanceOf(owner), before + eq);
    }

    function test_fork_keeperCopyGasProfile() public {
        if (!forked) return;
        require(leader != 0, "no suitable live leader found");
        _depositWithRealPermit(12e6);
        vm.prank(owner);
        account.setPolicy(_policy());
        (, uint256 mark,) = EXCHANGE.getPositionV2(BTC, account.perplAccountId());
        MirrorAccount.MirrorOrder memory o = MirrorAccount.MirrorOrder({
            leaderAccountId: leader,
            perpId: uint32(BTC),
            orderType: 0,
            lotLNS: 1,
            pricePNS: uint64(mark * 10_060 / 10_000),
            leverageHdths: 200,
            maxMatches: 50,
            leaderRef: bytes32("x")
        });
        vm.prank(keeper);
        uint256 g = gasleft();
        account.mirror(o);
        console.log("gas used by one copied open", g - gasleft());
    }

    function _leaderOrder(uint256 mark, uint8 t, uint256 lots, uint256 lev)
        internal
        pure
        returns (IPerplExchange.OrderDesc memory d)
    {
        bool bid = t == 0 || t == 3;
        d.orderDescId = uint256(keccak256(abi.encode(t, lots, lev)));
        d.perpId = BTC;
        d.orderType = t;
        d.pricePNS = bid ? mark * 10_050 / 10_000 : mark * 9_950 / 10_000;
        d.lotLNS = lots;
        d.immediateOrCancel = true;
        d.leverageHdths = lev;
        d.maxNegPnlCollatBPS = 1000;
    }

    /// Follow with match now against the live Perpl book, plus the gas of every transaction type the
    /// relayer, keeper and demo leader send (used to size the MON budget).
    function test_fork_followMatchNowAndGasProfile() public {
        if (!forked) return;
        require(leader != 0, "no suitable live leader found");
        uint256 g;

        g = gasleft();
        MirrorAccount acc2 = factory.createAccount(owner, bytes32("gas"));
        console.log("gas factory.createAccount        ", g - gasleft());

        // deposit with permit on the new account
        account = acc2;
        g = gasleft();
        _depositWithRealPermit(11e6);
        console.log("gas depositWithPermit (first)    ", g - gasleft());

        (, uint256 mark,) = EXCHANGE.getPositionV2(BTC, account.perplAccountId());
        uint256 target = leaderLots * 100 / 10_000; // ratio 1%
        if (target == 0) target = 1;
        uint256 lots = target > 3 ? 3 : target; // keep the notional tiny
        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](1);
        m[0] = MirrorAccount.MirrorOrder({
            leaderAccountId: leader,
            perpId: uint32(BTC),
            orderType: 0,
            lotLNS: uint64(lots),
            pricePNS: uint64(mark * 10_060 / 10_000),
            leverageHdths: 200,
            maxMatches: 50,
            leaderRef: bytes32(0)
        });
        MirrorAccount.Action memory a = MirrorAccount.Action({
            kind: account.ACTION_FOLLOW(),
            data: abi.encode(_policy(), m),
            nonce: account.actionNonce(),
            deadline: block.timestamp + 10 minutes
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, account.actionDigest(a));
        g = gasleft();
        bytes memory res = account.execute(a, abi.encodePacked(r, s, v));
        console.log("gas execute(follow + match now)  ", g - gasleft());
        bool[] memory ok = abi.decode(res, (bool[]));
        assertTrue(ok[0], "match now was blocked");
        (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(BTC, account.perplAccountId());
        console.log("lots after match now", pos.lotLNS, "of", lots);
        assertEq(pos.positionType, 0);
        assertGt(pos.lotLNS, 0, "match now did not fill on the live book");

        // keeper: blocked copy (leverage above policy)
        MirrorAccount.MirrorOrder memory o = m[0];
        o.lotLNS = 1;
        o.leverageHdths = 1000;
        vm.prank(keeper);
        g = gasleft();
        account.mirror(o);
        console.log("gas mirror (blocked)             ", g - gasleft());

        // keeper: close one lot
        o.orderType = 2;
        o.pricePNS = uint64(mark * 9_940 / 10_000);
        o.leverageHdths = 0;
        vm.prank(keeper);
        g = gasleft();
        account.mirror(o);
        console.log("gas mirror (close)               ", g - gasleft());

        // owner: close all, then withdraw (both relayed)
        a = MirrorAccount.Action({
            kind: account.ACTION_CLOSE_ALL(),
            data: abi.encode(uint16(100)),
            nonce: account.actionNonce(),
            deadline: block.timestamp + 10 minutes
        });
        (v, r, s) = vm.sign(ownerKey, account.actionDigest(a));
        g = gasleft();
        account.execute(a, abi.encodePacked(r, s, v));
        console.log("gas execute(closeAll)            ", g - gasleft());

        uint256 eq = account.equity();
        a = MirrorAccount.Action({
            kind: account.ACTION_WITHDRAW(),
            data: abi.encode(eq),
            nonce: account.actionNonce(),
            deadline: block.timestamp + 10 minutes
        });
        (v, r, s) = vm.sign(ownerKey, account.actionDigest(a));
        g = gasleft();
        account.execute(a, abi.encodePacked(r, s, v));
        console.log("gas execute(withdraw)            ", g - gasleft());
        console.log("equity returned (AUSD units)", eq);

        // demo leader: a plain EOA account on Perpl
        address demoLeader = makeAddr("demo-leader");
        vm.prank(address(EXCHANGE));
        AUSD.transfer(demoLeader, 11e6);
        vm.startPrank(demoLeader);
        g = gasleft();
        AUSD.approve(address(EXCHANGE), 11e6);
        console.log("gas leader approve               ", g - gasleft());
        g = gasleft();
        EXCHANGE.createAccount(11e6);
        console.log("gas leader createAccount         ", g - gasleft());
        g = gasleft();
        EXCHANGE.execOrder(_leaderOrder(mark, 0, 1, 200));
        console.log("gas leader open 1 lot            ", g - gasleft());
        g = gasleft();
        EXCHANGE.execOrder(_leaderOrder(mark, 2, 1, 0));
        console.log("gas leader close 1 lot           ", g - gasleft());
        vm.stopPrank();
    }
}
