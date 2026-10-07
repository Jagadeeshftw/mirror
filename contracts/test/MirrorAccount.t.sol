// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";

contract FactoryTest is MirrorBase {
    function test_createAccount_predictsAddressAndInitialises() public {
        address predicted = factory.predictAccount(stranger, bytes32("s"));
        MirrorAccount a = factory.createAccount(stranger, bytes32("s"));
        assertEq(address(a), predicted);
        assertEq(a.owner(), stranger);
        assertTrue(factory.isAccount(address(a)));
        assertEq(address(a.EXCHANGE()), address(ex));
        assertEq(a.DEPOSIT_CAP(), CAP);
    }

    function test_createAccount_sameOwnerAndSaltReverts() public {
        vm.expectRevert();
        factory.createAccount(owner, bytes32("follow-1"));
    }

    function test_differentSaltsGiveDifferentAccounts() public {
        MirrorAccount a = factory.createAccount(owner, bytes32("follow-2"));
        assertTrue(address(a) != address(account));
        assertEq(a.owner(), owner);
    }

    function test_initialize_onlyOnceAndOnlyFactory() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vm.prank(address(factory));
        account.initialize(stranger);

        MirrorAccount impl = MirrorAccount(factory.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vm.prank(address(factory));
        impl.initialize(stranger);
    }
}

contract DepositTest is MirrorBase {
    function test_depositWithPermit_createsPerplAccount() public {
        _fund(20e6);
        assertEq(account.perplAccountId(), 100);
        assertEq(ex.balanceOf(100), 20e6);
        assertEq(account.netDeposits(), 20e6);
        assertEq(ausd.balanceOf(owner), 80e6);
        assertEq(account.equity(), 20e6);
    }

    function test_depositWithPermit_secondDepositTopsUp() public {
        _fund(12e6);
        _fund(5e6);
        assertEq(ex.balanceOf(100), 17e6);
        assertEq(account.netDeposits(), 17e6);
    }

    function test_depositWithPermit_frontRunPermitStillDeposits() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(account), 15e6, deadline);
        ausd.permit(owner, address(account), 15e6, deadline, v, r, s); // griefer submits the permit first
        vm.prank(relayer);
        account.depositWithPermit(15e6, deadline, v, r, s);
        assertEq(account.netDeposits(), 15e6);
    }

    function test_depositWithPermit_junkSignatureCannotUseStandingAllowance() public {
        vm.prank(owner);
        ausd.approve(address(account), 20e6); // e.g. left over for a later direct deposit
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        vm.prank(stranger);
        account.depositWithPermit(15e6, block.timestamp + 1 hours, 27, bytes32(uint256(1)), bytes32(uint256(2)));
        assertEq(account.netDeposits(), 0);
    }

    function test_depositWithPermit_frontRunPermitHonouredOnlyOnce() public {
        vm.prank(owner);
        ausd.approve(address(account), 50e6);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(account), 12e6, deadline);
        ausd.permit(owner, address(account), 12e6, deadline, v, r, s); // front-run
        vm.prank(owner);
        ausd.approve(address(account), 50e6); // owner tops up the allowance afterwards
        account.depositWithPermit(12e6, deadline, v, r, s);
        assertEq(account.netDeposits(), 12e6);
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.depositWithPermit(12e6, deadline, v, r, s);
        assertEq(account.netDeposits(), 12e6);
    }

    function test_depositWithPermit_frontRunPermitForAnotherAmountRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(account), 12e6, deadline);
        ausd.permit(owner, address(account), 12e6, deadline, v, r, s);
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.depositWithPermit(11e6, deadline, v, r, s);
    }

    function test_depositWithAuthorization() public {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("n1");
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(address(account), 15e6, validBefore, nonce);
        vm.prank(relayer);
        account.depositWithAuthorization(15e6, 0, validBefore, nonce, v, r, s);
        assertEq(account.netDeposits(), 15e6);
        assertEq(ex.balanceOf(account.perplAccountId()), 15e6);
    }

    function test_depositWithAuthorization_cannotBeRedirected() public {
        // An authorisation signed for one account cannot fund another account.
        MirrorAccount other = factory.createAccount(stranger, bytes32("x"));
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("n1");
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(address(account), 15e6, validBefore, nonce);
        vm.expectRevert();
        other.depositWithAuthorization(15e6, 0, validBefore, nonce, v, r, s);
    }

    function test_deposit_direct() public {
        vm.startPrank(owner);
        ausd.approve(address(account), 11e6);
        account.deposit(11e6);
        vm.stopPrank();
        assertEq(account.netDeposits(), 11e6);
    }

    function test_deposit_direct_onlyOwner() public {
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(stranger);
        account.deposit(11e6);
    }

    function test_deposit_belowMinimumOpenReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(account), 5e6, deadline);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.BelowMinimumAccountOpen.selector, 10e6, 5e6));
        account.depositWithPermit(5e6, deadline, v, r, s);
    }

    function test_deposit_capEnforced() public {
        _fund(20e6);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(account), 6e6, deadline);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.DepositCapExceeded.selector, CAP, 26e6));
        account.depositWithPermit(6e6, deadline, v, r, s);
    }

    function test_deposit_liftsLossStopBaselines() public {
        _setUpFunded();
        uint128 hwmBefore = account.highWaterEquity();
        _fund(3e6);
        assertEq(account.highWaterEquity(), hwmBefore + 3e6);
    }
}

contract PolicyTest is MirrorBase {
    function test_setPolicy_storesEverything() public {
        _setUpFunded();
        assertEq(account.maxLeverageHdths(), 500);
        assertEq(account.maxSlippageBps(), 50);
        assertEq(account.expiry(), uint40(block.timestamp + 30 days));
        MirrorAccount.LeaderRule[] memory ls = account.leaders();
        assertEq(ls.length, 1);
        assertEq(ls[0].accountId, LEADER);
        assertEq(ls[0].ratioBps, 100);
        (bool allowed, bool halted, uint8 lotDec, uint8 priceDec, uint64 cap) = account.markets(BTC);
        assertTrue(allowed);
        assertFalse(halted);
        assertEq(ls[0].budgetCNS, 20e6);
        assertEq(account.stopSlippageBps(), 200);
        assertEq(lotDec, 5);
        assertEq(priceDec, 1);
        assertEq(cap, 15e6);
        assertEq(account.marketIds().length, 2);
    }

    function test_setPolicy_replacesMarkets() public {
        _setUpFunded();
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.markets = new MirrorAccount.MarketRule[](1);
        p.markets[0] = MirrorAccount.MarketRule({perpId: uint32(SOL), maxNotionalCNS: 5e6});
        vm.prank(owner);
        account.setPolicy(p);
        (bool btcAllowed,,,,) = account.markets(BTC);
        (bool solAllowed,,,,) = account.markets(SOL);
        assertFalse(btcAllowed);
        assertTrue(solAllowed);
        assertEq(account.marketIds().length, 1);
    }

    function test_setPolicy_onlyOwner() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.setPolicy(p);
    }

    function _expectInvalid(MirrorAccount.Policy memory p, string memory field) internal {
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, field));
        vm.prank(owner);
        account.setPolicy(p);
    }

    function test_setPolicy_validation() public {
        _fund(20e6);
        MirrorAccount.Policy memory p;

        p = _defaultPolicy();
        p.maxLeverageHdths = 99;
        _expectInvalid(p, "maxLeverageHdths");
        p.maxLeverageHdths = 10_001;
        _expectInvalid(p, "maxLeverageHdths");

        p = _defaultPolicy();
        p.maxSlippageBps = 0;
        _expectInvalid(p, "maxSlippageBps");
        p.maxSlippageBps = 1001;
        _expectInvalid(p, "maxSlippageBps");

        p = _defaultPolicy();
        p.dailyLossBps = 10_000;
        _expectInvalid(p, "dailyLossBps");

        p = _defaultPolicy();
        p.drawdownBps = 10_000;
        _expectInvalid(p, "drawdownBps");

        p = _defaultPolicy();
        p.expiry = uint40(block.timestamp);
        _expectInvalid(p, "expiry");

        p = _defaultPolicy();
        p.leaders = new MirrorAccount.LeaderRule[](0);
        _expectInvalid(p, "leaders");
        p.leaders = new MirrorAccount.LeaderRule[](5);
        _expectInvalid(p, "leaders");

        p = _defaultPolicy();
        p.leaders[0].ratioBps = 0;
        _expectInvalid(p, "leader.ratioBps");
        p.leaders[0].ratioBps = 10_001;
        _expectInvalid(p, "leader.ratioBps");

        p = _defaultPolicy();
        p.leaders[0].accountId = 0;
        _expectInvalid(p, "leader.accountId");
        p.leaders[0].accountId = account.perplAccountId(); // cannot follow itself
        _expectInvalid(p, "leader.accountId");

        p = _defaultPolicy();
        p.leaders = new MirrorAccount.LeaderRule[](2);
        p.leaders[0] = _leaderRule(LEADER, 100);
        p.leaders[1] = _leaderRule(LEADER, 200);
        _expectInvalid(p, "leader.duplicate");

        p = _defaultPolicy();
        p.leaders[0].budgetCNS = 0;
        _expectInvalid(p, "leader.budgetCNS");
        p = _defaultPolicy();
        p.leaders[0].lossStopBps = 10_001;
        _expectInvalid(p, "leader.lossStopBps");

        p = _defaultPolicy();
        p.maxEntryDeviationBps = 5_001;
        _expectInvalid(p, "maxEntryDeviationBps");

        p = _defaultPolicy();
        p.stopSlippageBps = 0;
        _expectInvalid(p, "stopSlippageBps");
        p.stopSlippageBps = 2_001;
        _expectInvalid(p, "stopSlippageBps");

        p = _defaultPolicy();
        p.markets = new MirrorAccount.MarketRule[](0);
        _expectInvalid(p, "markets");
        p.markets = new MirrorAccount.MarketRule[](17);
        _expectInvalid(p, "markets");

        p = _defaultPolicy();
        p.markets[0].maxNotionalCNS = 0;
        _expectInvalid(p, "market.maxNotionalCNS");

        p = _defaultPolicy();
        p.markets[1].perpId = uint32(BTC);
        _expectInvalid(p, "market.duplicate");

        p = _defaultPolicy();
        p.markets[0].perpId = 999; // unknown perpetual
        _expectInvalid(p, "market.perpId");
    }
}

contract MirrorTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _setUpFunded();
    }

    function test_openLong_copiesWithinPolicy() public {
        bool ok = _mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
        assertTrue(ok);
        (uint8 side, uint256 lots) = _lots(BTC);
        assertEq(side, LONG);
        assertEq(lots, 10);
        // 1.71 AUSD margin at 5x, plus the 0.02% builder fee on 8.55 AUSD of opening notional.
        assertEq(ex.balanceOf(account.perplAccountId()), 20e6 - 1.71e6 - 1710);
        (,,,,,,,,,,, uint256 lev,,,) = ex.lastOrder();
        assertEq(lev, 500);
    }

    function test_openLong_buildsIocOrderWithoutCollateralAmount() public {
        _mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
        (
            uint256 id,
            uint256 perpId,
            uint8 t,
            uint256 orderId,
            uint256 price,
            uint256 lots,
            uint256 expiryBlock,
            bool postOnly,
            bool fok,
            bool ioc,
            ,
            ,
            ,
            uint256 amount,
        ) = ex.lastOrder();
        assertEq(id, 1);
        assertEq(perpId, BTC);
        assertEq(t, OPEN_LONG);
        assertEq(orderId, 0);
        assertEq(price, 859_000);
        assertEq(lots, 10);
        assertEq(expiryBlock, 0);
        assertFalse(postOnly);
        assertFalse(fok);
        assertTrue(ioc);
        assertEq(amount, 0);
    }

    function test_mirror_emitsMirroredWithLotsBeforeAndAfter() public {
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, BTC, 6, 859_000, 500);
        vm.expectEmit(true, true, true, true, address(account));
        o.leaderFillPNS = 855_100;
        // The mock fills at mark (855,000) and the leader's entry is 855,000, so the follower paid 0 bps more.
        MirrorAccount.CopyProof memory proof = MirrorAccount.CopyProof({
            leaderFillPNS: 855_100,
            leaderEntryPNS: 855_000,
            markPNS: 855_000,
            fillPNS: 855_000,
            entryDeviationBps: 0,
            builderFeeCNS: 1026 // 6 lots x 85,500 = 5.13 AUSD x 0.02%
        });
        emit MirrorAccount.Mirrored(keeper, LEADER, uint32(BTC), OPEN_LONG, 6, 859_000, 500, 0, 6, o.leaderRef, proof);
        _mirror(o);
    }

    function test_onlyKeeper() public {
        vm.expectRevert(MirrorAccount.NotKeeper.selector);
        vm.prank(owner);
        account.mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
    }

    function test_noPerplAccountReverts() public {
        MirrorAccount fresh = factory.createAccount(stranger, bytes32("fresh"));
        vm.expectRevert(MirrorAccount.NoPerplAccount.selector);
        vm.prank(keeper);
        fresh.mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
    }

    function test_invalidOrderTypeAndZeroLotsRevert() public {
        vm.expectRevert(MirrorAccount.InvalidOrderType.selector);
        _mirror(_order(4, BTC, 10, 859_000, 500));
        vm.expectRevert(MirrorAccount.ZeroLots.selector);
        _mirror(_order(OPEN_LONG, BTC, 0, 859_000, 500));
    }

    function test_blocked_paused() public {
        vm.prank(owner);
        account.setPaused(true);
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_000, 500), MirrorAccount.BlockReason.Paused);
    }

    function test_blocked_expired() public {
        vm.warp(block.timestamp + 31 days);
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_000, 500), MirrorAccount.BlockReason.Expired);
    }

    function test_blocked_marketNotAllowed() public {
        ex.setPosition(SOL, LEADER, LONG, 1000);
        _expectBlocked(_order(OPEN_LONG, SOL, 1, 120_500, 500), MirrorAccount.BlockReason.MarketNotAllowed);
    }

    function test_blocked_leaderNotAllowed() public {
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, BTC, 10, 859_000, 500);
        o.leaderAccountId = LEADER2;
        _expectBlocked(o, MirrorAccount.BlockReason.LeaderNotAllowed);
    }

    function test_blocked_leverageTooHigh() public {
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_000, 2000), MirrorAccount.BlockReason.LeverageTooHigh);
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_000, 0), MirrorAccount.BlockReason.LeverageTooLow);
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_000, 99), MirrorAccount.BlockReason.LeverageTooLow);
    }

    function test_blocked_slippage_bidAboveBound() public {
        // bound = 855000 * 1.005 = 859275
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_276, 500), MirrorAccount.BlockReason.SlippageTooHigh);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_275, 500)));
    }

    function test_blocked_slippage_askBelowBound() public {
        ex.setPosition(BTC, LEADER, SHORT, 1000);
        // bound = ceil(855000 * 0.995) = 850725
        _expectBlocked(_order(OPEN_SHORT, BTC, 10, 850_724, 500), MirrorAccount.BlockReason.SlippageTooHigh);
        assertTrue(_mirror(_order(OPEN_SHORT, BTC, 10, 850_725, 500)));
    }

    function test_blocked_staleMark() public {
        ex.setMarkValid(BTC, false);
        _expectBlocked(_order(OPEN_LONG, BTC, 10, 859_000, 500), MirrorAccount.BlockReason.StaleMark);
    }

    function test_blocked_leaderSideMismatch() public {
        // Leader is long; a short copy is not backed by the leader.
        _expectBlocked(_order(OPEN_SHORT, BTC, 5, 851_000, 500), MirrorAccount.BlockReason.LeaderSideMismatch);
        ex.setPosition(BTC, LEADER, LONG, 0);
        _expectBlocked(_order(OPEN_LONG, BTC, 5, 859_000, 500), MirrorAccount.BlockReason.LeaderSideMismatch);
    }

    function test_blocked_flipNotAllowed() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        ex.setPosition(BTC, LEADER, SHORT, 1000);
        _expectBlocked(_order(OPEN_SHORT, BTC, 5, 851_000, 500), MirrorAccount.BlockReason.FlipNotAllowed);
    }

    function test_blocked_exceedsLeaderTarget() public {
        // target = ceil(1000 * 1%) = 10 lots
        _expectBlocked(_order(OPEN_LONG, BTC, 11, 859_000, 500), MirrorAccount.BlockReason.ExceedsLeaderTarget);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 7, 859_000, 500)));
        _expectBlocked(_order(OPEN_LONG, BTC, 4, 859_000, 500), MirrorAccount.BlockReason.ExceedsLeaderTarget);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 3, 859_000, 500)));
    }

    function test_targetRoundsUpSoTinyLeadersAreCopyable() public {
        ex.setPosition(BTC, LEADER, LONG, 1); // 1 lot x 1% = 0.01 lots -> rounds up to 1
        assertEq(account.targetLots(BTC, LEADER, LONG), 1);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 1, 859_000, 500)));
    }

    function test_blocked_exceedsMaxNotional() public {
        // ETH: 1 lot = 0.001 ETH = 2.70 AUSD; cap 15 AUSD -> 5 lots max although target is 10.
        _expectBlocked(_order(OPEN_LONG, ETH, 6, 271_000, 500), MirrorAccount.BlockReason.ExceedsMaxNotional);
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 5, 271_000, 500)));
    }

    function test_blocked_dailyLossStop() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.dailyLossBps = 500; // 5%
        vm.prank(owner);
        account.setPolicy(p);

        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500))); // records day start equity = 20
        // BTC falls 30%: loss = 5 lots * 25,650 = 1.2825 AUSD -> ~6.4% of 20
        ex.setMark(BTC, 598_500);
        _expectBlocked(_order(OPEN_LONG, BTC, 1, 601_000, 500), MirrorAccount.BlockReason.DailyLossStop);

        // A new day resets the baseline.
        vm.warp(block.timestamp + 1 days);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 1, 601_000, 500)));
    }

    function test_blocked_drawdownStop() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.drawdownBps = 500;
        vm.prank(owner);
        account.setPolicy(p);

        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
        ex.setMark(BTC, 598_500);
        vm.warp(block.timestamp + 2 days); // the daily stop would have reset, the drawdown stop does not
        _expectBlocked(_order(OPEN_LONG, BTC, 1, 601_000, 500), MirrorAccount.BlockReason.DrawdownStop);
    }

    function test_close_reducesAndAlwaysAllowedWhenPaused() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        vm.prank(owner);
        account.setPaused(true);
        ex.setPosition(BTC, LEADER, LONG, 600); // leader reduces: target 6 lots
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 4, 851_000, 0)));
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 6);
    }

    function test_close_allowedAfterMarketRemovedFromPolicy() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.markets = new MirrorAccount.MarketRule[](1);
        p.markets[0] = MirrorAccount.MarketRule(uint32(ETH), 15e6);
        vm.prank(owner);
        account.setPolicy(p);
        ex.setPosition(BTC, LEADER, LONG, 0); // leader exits
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 10, 851_000, 0)));
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 0);
    }

    function test_close_slippageBounded() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        ex.setPosition(BTC, LEADER, LONG, 0);
        _expectBlocked(_order(CLOSE_LONG, BTC, 10, 850_000, 0), MirrorAccount.BlockReason.SlippageTooHigh);
    }

    function test_close_nothingToCloseAndOversizeRevert() public {
        vm.expectRevert(MirrorAccount.NothingToClose.selector);
        _mirror(_order(CLOSE_LONG, BTC, 1, 851_000, 0));
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        vm.expectRevert(MirrorAccount.NothingToClose.selector);
        _mirror(_order(CLOSE_SHORT, BTC, 1, 859_000, 0));
        vm.expectRevert(MirrorAccount.CloseExceedsPosition.selector);
        _mirror(_order(CLOSE_LONG, BTC, 11, 851_000, 0));
    }

    function test_partialFillStillWithinPolicy() public {
        ex.setFillBps(5_000);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 5);
    }

    function test_close_cannotGoBelowLeaderTarget() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        // Leader still holds 1000 lots: target 10, so a keeper cannot close anything.
        _expectBlocked(_order(CLOSE_LONG, BTC, 1, 851_000, 0), MirrorAccount.BlockReason.CloseBelowTarget);
        ex.setPosition(BTC, LEADER, LONG, 300); // target 3
        _expectBlocked(_order(CLOSE_LONG, BTC, 8, 851_000, 0), MirrorAccount.BlockReason.CloseBelowTarget);
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 7, 851_000, 0)));
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 3);
    }

    function test_close_onlyByTheLeaderHoldingTheMarket() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.leaders = new MirrorAccount.LeaderRule[](2);
        p.leaders[0] = _leaderRule(LEADER, 100);
        p.leaders[1] = _leaderRule(LEADER2, 100);
        vm.prank(owner);
        account.setPolicy(p);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        ex.setPosition(BTC, LEADER, LONG, 0);
        MirrorAccount.MirrorOrder memory o = _order(CLOSE_LONG, BTC, 10, 851_000, 0);
        o.leaderAccountId = LEADER2;
        _expectBlocked(o, MirrorAccount.BlockReason.MarketHeldByOtherLeader);
    }

    function test_close_removedLeaderNoLongerManagesPosition() public {
        // "Stop following but keep my positions": once a leader is removed, its exits are not copied.
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.leaders[0] = _leaderRule(LEADER2, 100);
        vm.prank(owner);
        account.setPolicy(p);
        ex.setPosition(BTC, LEADER, LONG, 0);
        _expectBlocked(_order(CLOSE_LONG, BTC, 10, 851_000, 0), MirrorAccount.BlockReason.LeaderNotAllowed);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 10);
    }
}

contract OwnerActionsTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _setUpFunded();
    }

    function test_withdraw_onlyOwnerAndPaysOwner() public {
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.withdraw(1e6);

        vm.prank(owner);
        account.withdraw(5e6);
        assertEq(ausd.balanceOf(owner), 85e6);
        assertEq(account.netDeposits(), 15e6);
    }

    function test_withdrawViaSignature_relayedByAnyone() public {
        MirrorAccount.Action memory a = _action(account.ACTION_WITHDRAW(), abi.encode(uint256(7e6)));
        bytes memory sig = _signAction(a, ownerKey);
        vm.prank(relayer);
        account.execute(a, sig);
        assertEq(ausd.balanceOf(owner), 87e6);
        assertEq(ausd.balanceOf(relayer), 0);
        assertEq(account.actionNonce(), 1);
    }

    function test_execute_rejectsReplayWrongSignerAndExpiry() public {
        MirrorAccount.Action memory a = _action(account.ACTION_WITHDRAW(), abi.encode(uint256(1e6)));
        bytes memory sig = _signAction(a, ownerKey);
        account.execute(a, sig);

        vm.expectRevert(MirrorAccount.BadNonce.selector);
        account.execute(a, sig);

        a = _action(account.ACTION_WITHDRAW(), abi.encode(uint256(1e6)));
        (, uint256 strangerKey) = makeAddrAndKey("stranger-key");
        bytes memory bad = _signAction(a, strangerKey);
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.execute(a, bad);

        a.deadline = block.timestamp - 1;
        sig = _signAction(a, ownerKey);
        vm.expectRevert(MirrorAccount.ActionExpired.selector);
        account.execute(a, sig);
    }

    function test_execute_tamperedDataRejected() public {
        MirrorAccount.Action memory a = _action(account.ACTION_WITHDRAW(), abi.encode(uint256(1e6)));
        bytes memory sig = _signAction(a, ownerKey);
        a.data = abi.encode(uint256(20e6));
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.execute(a, sig);
    }

    function test_execute_unknownKindReverts() public {
        MirrorAccount.Action memory a = _action(99, "");
        bytes memory sig = _signAction(a, ownerKey);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.UnknownAction.selector, uint8(99)));
        account.execute(a, sig);
    }

    function test_execute_setPolicyPauseSweepExchangeCall() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxLeverageHdths = 300;
        MirrorAccount.Action memory a = _action(account.ACTION_SET_POLICY(), abi.encode(p));
        account.execute(a, _signAction(a, ownerKey));
        assertEq(account.maxLeverageHdths(), 300);

        a = _action(account.ACTION_SET_PAUSED(), abi.encode(true));
        account.execute(a, _signAction(a, ownerKey));
        assertTrue(account.paused());

        ausd.mint(address(account), 2e6);
        a = _action(account.ACTION_SWEEP(), abi.encode(address(ausd)));
        account.execute(a, _signAction(a, ownerKey));
        assertEq(ausd.balanceOf(owner), 82e6);

        bytes memory call = abi.encodeWithSignature("withdrawCollateral(uint256)", 3e6);
        a = _action(account.ACTION_EXCHANGE_CALL(), abi.encode(call));
        account.execute(a, _signAction(a, ownerKey));
        assertEq(ausd.balanceOf(address(account)), 3e6);
    }

    function test_exchangeCall_onlyOwner() public {
        bytes memory call = abi.encodeWithSignature("withdrawCollateral(uint256)", 3e6);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.exchangeCall(call);
    }

    function test_closeAll_closesEveryPositionAndPauses() public {
        vm.prank(keeper);
        account.mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
        vm.prank(keeper);
        account.mirror(_order(OPEN_LONG, ETH, 5, 271_000, 500));

        vm.prank(owner);
        account.closeAll(100);
        assertTrue(account.paused());
        (, uint256 btc) = _lots(BTC);
        (, uint256 eth) = _lots(ETH);
        assertEq(btc, 0);
        assertEq(eth, 0);
        // Only the two opens paid the builder fee (1,710 + 2,700); the closes paid none.
        assertEq(account.equity(), 20e6 - 4410);
        assertEq(ex.attributedCloses(), 0);
    }

    function test_closeAll_rejectsBadSlippage() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, "slippageBps"));
        account.closeAll(0);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, "slippageBps"));
        account.closeAll(2001);
        vm.stopPrank();
    }

    function test_withdrawAllAfterClosing() public {
        vm.prank(keeper);
        account.mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
        ausd.mint(address(ex), 10e6); // counterparty liquidity in the mock
        ex.setMark(BTC, 900_000); // +4,500.0 on 0.0001 BTC -> profit on 10 lots = 0.45 AUSD
        vm.prank(owner);
        account.closeAll(100);
        uint256 eq = account.equity();
        assertGt(eq, 20e6);
        vm.prank(owner);
        account.withdraw(eq);
        assertEq(ausd.balanceOf(owner), 80e6 + eq);
        assertEq(account.netDeposits(), 0);
    }
}

contract KeeperRegistryTest is MirrorBase {
    function test_onlyOwnerSetsKeepers() public {
        vm.expectRevert();
        vm.prank(stranger);
        registry.setKeeper(stranger, true);

        address[] memory ks = new address[](2);
        ks[0] = makeAddr("k1");
        ks[1] = makeAddr("k2");
        vm.prank(admin);
        registry.setKeepers(ks, true);
        assertTrue(registry.isKeeper(ks[0]));
        assertTrue(registry.isKeeper(ks[1]));
    }

    function test_revokedKeeperCannotMirror() public {
        _setUpFunded();
        vm.prank(admin);
        registry.setKeeper(keeper, false);
        vm.expectRevert(MirrorAccount.NotKeeper.selector);
        _mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500));
    }

    function test_ownershipTransferIsTwoStep() public {
        vm.prank(admin);
        registry.transferOwnership(stranger);
        assertEq(registry.owner(), admin);
        vm.prank(stranger);
        registry.acceptOwnership();
        assertEq(registry.owner(), stranger);
    }
}
