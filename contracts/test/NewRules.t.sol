// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";

/// Entry guard (contract change 1): the leader's onchain average entry bounds the follower's entry.
contract EntryGuardTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _fund(20e6);
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxEntryDeviationBps = 100; // 1%
        p.maxSlippageBps = 500;
        vm.prank(owner);
        account.setPolicy(p);
    }

    function test_long_blockedWhenLimitAboveBound() public {
        ex.setPositionAt(BTC, LEADER, LONG, 1000, 850_000); // bound = 858,500
        _expectBlocked(_order(OPEN_LONG, BTC, 5, 858_501, 500), MirrorAccount.BlockReason.EntryTooFar);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 858_500, 500)));
    }

    function test_long_blockedWhenMarkAlreadyBeyondBound() public {
        ex.setPositionAt(BTC, LEADER, LONG, 1000, 840_000); // bound 848,400, mark 855,000
        vm.recordLogs();
        assertFalse(_mirror(_order(OPEN_LONG, BTC, 5, 848_000, 500)));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != MirrorAccount.Blocked.selector) continue;
            (MirrorAccount.BlockReason r,,, uint256 limit, uint256 actual,,, uint64 markPNS) = abi.decode(
                logs[i].data, (MirrorAccount.BlockReason, uint8, uint64, uint256, uint256, bytes32, uint64, uint64)
            );
            assertEq(uint8(r), uint8(MirrorAccount.BlockReason.EntryTooFar));
            assertEq(limit, 848_400);
            assertEq(actual, 855_000);
            assertEq(markPNS, 855_000);
        }
    }

    function test_short_boundIsBelowEntry() public {
        ex.setPositionAt(BTC, LEADER, SHORT, 1000, 860_000); // bound = ceil(851,400)
        _expectBlocked(_order(OPEN_SHORT, BTC, 5, 851_399, 500), MirrorAccount.BlockReason.EntryTooFar);
        assertTrue(_mirror(_order(OPEN_SHORT, BTC, 5, 851_400, 500)));
    }

    function test_offWhenZero() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxSlippageBps = 500;
        vm.prank(owner);
        account.setPolicy(p);
        ex.setPositionAt(BTC, LEADER, LONG, 1000, 800_000);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
    }

    function test_appliesToMatchNow() public {
        ex.setPositionAt(BTC, LEADER, LONG, 1000, 840_000);
        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](1);
        m[0] = _order(OPEN_LONG, BTC, 10, 859_000, 500);
        vm.prank(owner);
        bool[] memory ok = account.matchNow(m);
        assertFalse(ok[0]);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 0);
    }

    function test_closesAreNeverEntryGuarded() public {
        ex.setPositionAt(BTC, LEADER, LONG, 1000, 855_000);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        ex.setPositionAt(BTC, LEADER, LONG, 0, 0);
        ex.setMark(BTC, 700_000);
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 10, 699_000, 0)));
    }
}

/// Proof in the events (contract change 4).
contract CopyProofTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _setUpFunded();
    }

    function _lastProof(Vm.Log[] memory logs) internal pure returns (MirrorAccount.CopyProof memory p) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MirrorAccount.Mirrored.selector) {
                (,,,,,,, p) = abi.decode(
                    logs[i].data, (uint8, uint64, uint64, uint16, uint256, uint256, bytes32, MirrorAccount.CopyProof)
                );
            }
        }
    }

    function test_addToPosition_fillDerivedFromAverageEntry() public {
        ex.setPositionAt(BTC, LEADER, LONG, 1000, 850_000);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 4, 859_000, 500))); // fills at 855,000
        ex.setMark(BTC, 857_000);
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, BTC, 6, 859_000, 500);
        o.leaderFillPNS = 856_900;
        vm.recordLogs();
        assertTrue(_mirror(o));
        MirrorAccount.CopyProof memory p = _lastProof(vm.getRecordedLogs());
        assertEq(p.fillPNS, 857_000, "second fill");
        assertEq(p.leaderEntryPNS, 850_000);
        assertEq(p.leaderFillPNS, 856_900);
        assertEq(p.markPNS, 857_000);
        // (857,000 - 850,000) / 850,000 = 82.35 bps worse for a long.
        assertEq(p.entryDeviationBps, 82);
    }

    function test_short_deviationSignIsWorseWhenLower() public {
        ex.setPositionAt(BTC, LEADER, SHORT, 1000, 860_000);
        vm.recordLogs();
        assertTrue(_mirror(_order(OPEN_SHORT, BTC, 5, 851_000, 500))); // fills at 855,000, below the entry
        MirrorAccount.CopyProof memory p = _lastProof(vm.getRecordedLogs());
        assertEq(p.fillPNS, 855_000);
        assertEq(p.entryDeviationBps, 58); // sold 58 bps lower than the leader: worse
    }

    function test_noFill_noFillPrice() public {
        ex.setFillBps(0);
        vm.recordLogs();
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
        MirrorAccount.CopyProof memory p = _lastProof(vm.getRecordedLogs());
        assertEq(p.fillPNS, 0);
        assertEq(p.entryDeviationBps, 0);
    }

    function test_blocked_carriesLeaderFillAndMark() public {
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, BTC, 5, 859_000, 2000);
        o.leaderFillPNS = 854_321;
        vm.recordLogs();
        _mirror(o);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != MirrorAccount.Blocked.selector) continue;
            (,,,,, bytes32 ref, uint64 lf, uint64 mk) = abi.decode(
                logs[i].data, (MirrorAccount.BlockReason, uint8, uint64, uint256, uint256, bytes32, uint64, uint64)
            );
            assertEq(ref, o.leaderRef);
            assertEq(lf, 854_321);
            assertEq(mk, 855_000);
            seen = true;
        }
        assertTrue(seen);
    }
}

/// Several leaders in one account, each with its own budget and loss stop (contract change 3).
contract MultiLeaderTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _fund(20e6);
        ex.setPosition(BTC, LEADER2, LONG, 2000);
        ex.setPosition(ETH, LEADER2, LONG, 2000);
        vm.prank(owner);
        account.setPolicy(_twoLeaders(5e6, 0, 5e6, 0));
    }

    function _twoLeaders(uint64 b1, uint16 s1, uint64 b2, uint16 s2) internal view returns (MirrorAccount.Policy memory p) {
        p = _defaultPolicy();
        p.leaders = new MirrorAccount.LeaderRule[](2);
        p.leaders[0] = MirrorAccount.LeaderRule({accountId: LEADER, ratioBps: 100, budgetCNS: b1, lossStopBps: s1});
        p.leaders[1] = MirrorAccount.LeaderRule({accountId: LEADER2, ratioBps: 100, budgetCNS: b2, lossStopBps: s2});
    }

    function _o2(uint8 t, uint256 perp, uint64 lots, uint64 price, uint16 lev)
        internal
        pure
        returns (MirrorAccount.MirrorOrder memory o)
    {
        o = _order(t, perp, lots, price, lev);
        o.leaderAccountId = LEADER2;
    }

    function test_marketBelongsToTheLeaderWhoOpenedIt() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
        assertEq(account.marketLeader(BTC), LEADER);
        _expectBlocked(_o2(OPEN_LONG, BTC, 5, 859_000, 500), MirrorAccount.BlockReason.MarketHeldByOtherLeader);
        // LEADER2 trades ETH freely.
        assertTrue(_mirror(_o2(OPEN_LONG, ETH, 5, 271_000, 500)));
        assertEq(account.marketLeader(ETH), LEADER2);
    }

    function test_targetsAreIndependentPerLeader() public {
        assertEq(account.targetLots(BTC, LEADER, LONG), 10);
        assertEq(account.targetLots(BTC, LEADER2, LONG), 20);
        ex.setPosition(BTC, LEADER2, SHORT, 2000);
        assertEq(account.targetLots(BTC, LEADER, LONG), 10, "opposite leader no longer nets the target");
        assertEq(account.targetLots(BTC, 999, LONG), 0, "not followed");
    }

    function test_marketFreedOnceFlat() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
        ex.setPosition(BTC, LEADER, LONG, 0);
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 5, 851_000, 0)));
        assertEq(account.marketLeader(BTC), 0);
        assertTrue(_mirror(_o2(OPEN_LONG, BTC, 5, 859_000, 500)));
        assertEq(account.marketLeader(BTC), LEADER2);
    }

    function test_marketFreedAfterLiquidation() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
        ex.wipePosition(BTC, account.perplAccountId());
        assertTrue(_mirror(_o2(OPEN_LONG, BTC, 5, 859_000, 500)));
        assertEq(account.marketLeader(BTC), LEADER2);
    }

    function test_budgetCapsMarginPerLeader() public {
        // BTC: 1 lot = 8.55 AUSD at mark. At 5x, 5 lots = 42.75 notional... use ETH: 1 lot = 2.70 AUSD.
        // Budget 5 AUSD: at 1x, one ETH lot needs ceil(2.71) margin; two need 5.42 > 5.
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 1, 271_000, 100)));
        (uint256 margin,,,) = account.leaderBook(LEADER);
        assertEq(margin, 2.7e6);
        _expectBlocked(_order(OPEN_LONG, ETH, 1, 271_000, 100), MirrorAccount.BlockReason.LeaderBudgetExceeded);
        // Higher leverage needs less margin and fits.
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 1, 271_000, 200)));
        // The other leader's budget is separate.
        assertTrue(_mirror(_o2(OPEN_LONG, BTC, 2, 859_000, 500)));
    }

    function test_realizedTracksFeesAndPnlPerLeader() public {
        ex.setFeeBps(10);
        ausd.mint(address(ex), 10e6);
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 4, 271_000, 500))); // fills at 2,700: notional 10.8, fee 0.0108
        (,, int256 r1,) = account.leaderBook(LEADER);
        assertEq(r1, -10_800);
        ex.setMark(ETH, 280_000);
        ex.setPosition(ETH, LEADER, LONG, 0);
        assertTrue(_mirror(_order(CLOSE_LONG, ETH, 4, 279_000, 0))); // pnl +0.40, fee 0.0112
        (,, int256 r2,) = account.leaderBook(LEADER);
        assertEq(r2, -10_800 + 400_000 - 11_200);
        (,, int256 other,) = account.leaderBook(LEADER2);
        assertEq(other, 0);
    }

    function test_leaderLossStopLatchesAndOnlyStopsThatLeader() public {
        vm.prank(owner);
        account.setPolicy(_twoLeaders(5e6, 1000, 5e6, 1000)); // stop at -0.5 AUSD each
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 5, 271_000, 500))); // 13.5 notional
        ex.setMark(ETH, 240_000); // -1.5 unrealised
        _expectBlocked(_order(OPEN_LONG, ETH, 1, 241_000, 500), MirrorAccount.BlockReason.LeaderLossStop);
        assertTrue(account.leaderStopped(LEADER));
        // Latched: even after a recovery, LEADER stays stopped until the owner re-arms.
        ex.setMark(ETH, 271_000);
        _expectBlocked(_order(OPEN_LONG, ETH, 1, 271_000, 500), MirrorAccount.BlockReason.LeaderLossStop);
        // LEADER2 is unaffected.
        assertTrue(_mirror(_o2(OPEN_LONG, BTC, 2, 859_000, 500)));
        // Re-arming with a new policy clears the stop and the loss record.
        vm.prank(owner);
        account.setPolicy(_twoLeaders(5e6, 1000, 5e6, 1000));
        assertFalse(account.leaderStopped(LEADER));
        (,, int256 realized,) = account.leaderBook(LEADER);
        assertEq(realized, 0);
    }

    function test_keptLeaderKeepsItsRecordAcrossPolicyUpdates() public {
        ex.setFeeBps(10);
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 4, 271_000, 500)));
        vm.prank(owner);
        account.setPolicy(_twoLeaders(6e6, 0, 5e6, 0));
        (,, int256 r,) = account.leaderBook(LEADER);
        assertEq(r, -10_800);
    }
}

/// Stops anyone can trigger (contract change 2).
contract StopTriggerTest is MirrorBase {
    address internal anyone = makeAddr("anyone");

    function setUp() public override {
        super.setUp();
        _fund(20e6);
        ausd.mint(address(ex), 10e6);
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.flattenOnStop = true;
        p.stopSlippageBps = 300;
        vm.prank(owner);
        account.setPolicy(p);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 5, 271_000, 500)));
    }

    function _level(uint256 perp, uint8 side, uint64 sl, uint64 tp) internal {
        MirrorAccount.Level[] memory ls = new MirrorAccount.Level[](1);
        ls[0] = MirrorAccount.Level({perpId: uint32(perp), side: side, stopLossPNS: sl, takeProfitPNS: tp, slippageBps: 300});
        vm.prank(owner);
        account.setLevels(ls);
    }

    function test_level_stopLossByAnyoneWhenMarkCrosses() public {
        _level(BTC, LONG, 830_000, 0);
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        vm.prank(anyone);
        account.triggerLevel(BTC);

        ex.setMark(BTC, 829_000); // oracle not set: only the mark is read
        uint256 bal = ausd.balanceOf(anyone);
        vm.prank(anyone);
        uint256 closed = account.triggerLevel(BTC);
        assertEq(closed, 10);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 0);
        assertEq(ausd.balanceOf(anyone), bal, "caller paid nothing out");
        (, bool halted,,,) = account.markets(BTC);
        assertTrue(halted);
        assertEq(account.level(BTC).stopLossPNS, 0, "level cleared after a full close");
        (, uint256 eth) = _lots(ETH);
        assertEq(eth, 5, "other markets untouched");
    }

    function test_level_haltedMarketBlocksCopiesUntilNewPolicy() public {
        _level(BTC, LONG, 830_000, 0);
        ex.setMark(BTC, 829_000);
        account.triggerLevel(BTC);
        _expectBlocked(_order(OPEN_LONG, BTC, 1, 830_000, 500), MirrorAccount.BlockReason.MarketHalted);
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.flattenOnStop = true;
        vm.prank(owner);
        account.setPolicy(p);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 1, 830_000, 500)));
    }

    function test_level_freshOracleMustAgree() public {
        _level(BTC, LONG, 830_000, 0);
        ex.setMark(BTC, 829_000);
        // A fresh Chainlink price that has not reached the level: not triggered.
        ex.setOracle(BTC, 835_000, block.timestamp);
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLevel(BTC);
        // A fresh price more than 2% from the mark: untrusted, refused.
        ex.setOracle(BTC, 850_000, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.UntrustedPrice.selector, BTC, 829_000, 850_000));
        account.triggerLevel(BTC);
        // Fresh and also through the level: fires.
        ex.setOracle(BTC, 829_500, block.timestamp);
        assertEq(account.triggerLevel(BTC), 10);
    }

    function test_level_staleOracleIgnoredInvalidMarkRefused() public {
        _level(BTC, LONG, 830_000, 0);
        ex.setMark(BTC, 829_000);
        ex.setOracle(BTC, 900_000, block.timestamp - 61); // stale: ignored
        ex.setMarkValid(BTC, false);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.UntrustedPrice.selector, BTC, 829_000, 900_000));
        account.triggerLevel(BTC);
        ex.setMarkValid(BTC, true);
        assertEq(account.triggerLevel(BTC), 10);
    }

    function test_level_takeProfitAndShortSide() public {
        _level(BTC, LONG, 0, 880_000);
        ex.setMark(BTC, 879_999);
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLevel(BTC);
        ex.setMark(BTC, 880_000);
        assertEq(account.triggerLevel(BTC), 10);

        // Short: stop above, take-profit below.
        MirrorAccount.Policy memory p = _defaultPolicy();
        vm.prank(owner);
        account.setPolicy(p);
        ex.setPosition(ETH, LEADER, LONG, 0);
        assertTrue(_mirror(_order(CLOSE_LONG, ETH, 5, 269_000, 0)));
        ex.setPosition(ETH, LEADER, SHORT, 1000);
        assertTrue(_mirror(_order(OPEN_SHORT, ETH, 5, 269_000, 500)));
        _level(ETH, SHORT, 290_000, 250_000);
        ex.setMark(ETH, 255_000);
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLevel(ETH);
        ex.setMark(ETH, 290_000);
        assertEq(account.triggerLevel(ETH), 5);
    }

    function test_level_wrongSideOrNoPositionRefused() public {
        _level(BTC, SHORT, 900_000, 0); // the account is long
        ex.setMark(BTC, 950_000);
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLevel(BTC);
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLevel(SOL);
    }

    function test_level_partialFillKeepsLevelForRetry() public {
        _level(BTC, LONG, 830_000, 0);
        ex.setMark(BTC, 829_000);
        ex.setFillBps(4_000);
        assertEq(account.triggerLevel(BTC), 4);
        assertEq(account.level(BTC).stopLossPNS, 830_000);
        ex.setFillBps(10_000);
        assertEq(account.triggerLevel(BTC), 6);
    }

    function test_setLevels_validationOwnerAndSigned() public {
        MirrorAccount.Level[] memory ls = new MirrorAccount.Level[](1);
        ls[0] = MirrorAccount.Level({perpId: uint32(BTC), side: 2, stopLossPNS: 1, takeProfitPNS: 0, slippageBps: 100});
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidLevel.selector, "side"));
        account.setLevels(ls);
        ls[0].side = LONG;
        ls[0].slippageBps = 0;
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidLevel.selector, "slippageBps"));
        account.setLevels(ls);
        ls[0].slippageBps = 100;
        ls[0].stopLossPNS = 900_000;
        ls[0].takeProfitPNS = 880_000;
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidLevel.selector, "order"));
        account.setLevels(ls);
        vm.stopPrank();

        ls[0].stopLossPNS = 800_000;
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.setLevels(ls);

        // A friend's suggested level becomes real only with the owner's signature.
        MirrorAccount.Action memory a = _action(account.ACTION_SET_LEVELS(), abi.encode(ls));
        vm.prank(relayer);
        account.execute(a, _signAction(a, ownerKey));
        assertEq(account.level(BTC).stopLossPNS, 800_000);
        assertEq(account.level(BTC).takeProfitPNS, 880_000);

        // Clearing.
        ls[0].stopLossPNS = 0;
        ls[0].takeProfitPNS = 0;
        vm.prank(owner);
        account.setLevels(ls);
        assertEq(account.level(BTC).slippageBps, 0);
    }

    function test_accountStop_flattensAndPausesOnlyWhenHit() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.flattenOnStop = true;
        p.dailyLossBps = 500;
        vm.prank(owner);
        account.setPolicy(p);
        ex.setPosition(BTC, LEADER, LONG, 1100);
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 1, 859_000, 500))); // records today's baseline
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        vm.prank(anyone);
        account.triggerAccountStop();

        ex.setMark(BTC, 700_000); // -1.71 AUSD on 11 lots: below 95% of 20
        vm.prank(anyone);
        uint256 closed = account.triggerAccountStop();
        assertEq(closed, 2);
        assertTrue(account.paused());
        (, uint256 btc) = _lots(BTC);
        (, uint256 eth) = _lots(ETH);
        assertEq(btc + eth, 0);
        assertEq(ausd.balanceOf(anyone), 0);
    }

    function test_accountStop_refusedWhenFlattenOffOrMarkUntrusted() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.dailyLossBps = 500;
        vm.prank(owner);
        account.setPolicy(p);
        ex.setMark(BTC, 700_000);
        vm.expectRevert(MirrorAccount.FlattenOff.selector);
        account.triggerAccountStop();

        p.flattenOnStop = true;
        vm.prank(owner);
        account.setPolicy(p);
        ex.setOracle(BTC, 800_000, block.timestamp); // 14% from the mark
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.UntrustedPrice.selector, BTC, 700_000, 800_000));
        account.triggerAccountStop();
    }

    function test_leaderStop_closesOnlyThatLeadersMarkets() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.flattenOnStop = true;
        p.leaders = new MirrorAccount.LeaderRule[](2);
        p.leaders[0] = MirrorAccount.LeaderRule({accountId: LEADER, ratioBps: 100, budgetCNS: 20e6, lossStopBps: 500});
        p.leaders[1] = MirrorAccount.LeaderRule({accountId: LEADER2, ratioBps: 100, budgetCNS: 20e6, lossStopBps: 500});
        vm.prank(owner);
        account.setPolicy(p);
        // Hand ETH to LEADER2: close it for LEADER, reopen for LEADER2.
        ex.setPosition(ETH, LEADER, LONG, 0);
        assertTrue(_mirror(_order(CLOSE_LONG, ETH, 5, 269_000, 0)));
        ex.setPosition(ETH, LEADER2, LONG, 1000);
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, ETH, 5, 271_000, 500);
        o.leaderAccountId = LEADER2;
        assertTrue(_mirror(o));

        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLeaderStop(LEADER);
        ex.setMark(BTC, 700_000); // LEADER's BTC: -1.55 AUSD < -1.0 (5% of 20)
        vm.prank(anyone);
        assertEq(account.triggerLeaderStop(LEADER), 1);
        assertTrue(account.leaderStopped(LEADER));
        (, uint256 btc) = _lots(BTC);
        (, uint256 eth) = _lots(ETH);
        assertEq(btc, 0);
        assertEq(eth, 5, "LEADER2's market untouched");
        assertFalse(account.paused());
        vm.expectRevert(MirrorAccount.StopNotTriggered.selector);
        account.triggerLeaderStop(LEADER2);
    }

    function test_closeMarket_ownerAndSigned() public {
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.closeMarket(uint32(BTC), 100);
        vm.prank(owner);
        account.closeMarket(uint32(BTC), 100);
        (, uint256 btc) = _lots(BTC);
        assertEq(btc, 0);
        MirrorAccount.Action memory a = _action(account.ACTION_CLOSE_MARKET(), abi.encode(uint32(ETH), uint16(100)));
        account.execute(a, _signAction(a, ownerKey));
        (, uint256 eth) = _lots(ETH);
        assertEq(eth, 0);
        vm.expectRevert(MirrorAccount.NothingToClose.selector);
        vm.prank(owner);
        account.closeMarket(uint32(ETH), 100);
    }
}
