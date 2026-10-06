// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";

contract MirrorFuzzTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _setUpFunded();
    }

    /// Any copied order, whatever the keeper sends, leaves the account within the follower's policy.
    function testFuzz_mirrorOutcomeAlwaysWithinPolicy(
        uint8 orderType,
        uint64 lots,
        int16 priceOffsetBps,
        uint16 lev,
        uint32 leaderLots,
        bool leaderShort,
        uint16 fillBps,
        bool useEth
    ) public {
        uint256 perp = useEth ? ETH : BTC;
        orderType = uint8(bound(orderType, 0, 3));
        lots = uint64(bound(lots, 1, 50));
        priceOffsetBps = int16(bound(priceOffsetBps, -200, 200));
        lev = uint16(bound(lev, 0, 3000));
        leaderLots = uint32(bound(leaderLots, 0, 5000));
        ex.setFillBps(bound(fillBps, 0, 10_000));
        ex.setPosition(perp, LEADER, leaderShort ? SHORT : LONG, leaderLots);

        // Seed an existing follower position half the time so closes have something to act on.
        if (lots % 2 == 0) {
            ex.setFillBps(10_000);
            uint8 seedType = leaderShort ? OPEN_SHORT : OPEN_LONG;
            (, uint256 mk0,) = _markOf(perp);
            uint64 seedPrice = uint64(leaderShort ? mk0 * 9_960 / 10_000 : mk0 * 10_040 / 10_000);
            vm.prank(keeper);
            try account.mirror(_order(seedType, perp, 1, seedPrice, 300)) {} catch {}
            ex.setFillBps(bound(fillBps, 0, 10_000));
        }

        (, uint256 mark,) = _markOf(perp);
        uint64 price = uint64(uint256(int256(mark) + int256(mark) * priceOffsetBps / 10_000));
        (uint8 sideBefore, uint256 lotsBefore) = _lots(perp);

        vm.prank(keeper);
        try account.mirror(_order(orderType, perp, lots, price, lev)) returns (bool executed) {
            (uint8 sideAfter, uint256 lotsAfter) = _lots(perp);
            if (!executed) {
                assertEq(lotsAfter, lotsBefore, "blocked order changed the position");
                return;
            }
            bool opening = orderType == OPEN_LONG || orderType == OPEN_SHORT;
            if (opening) {
                uint8 want = orderType == OPEN_LONG ? LONG : SHORT;
                assertLe(lev, account.maxLeverageHdths(), "leverage above max");
                assertGe(lev, 100);
                if (lotsAfter != 0) assertEq(sideAfter, want, "flipped side");
                assertLe(lotsAfter, account.targetLots(perp, LEADER, want), "above leader target");
                (,,,, uint64 cap) = account.markets(perp);
                assertLe(_notionalOf(perp, lotsAfter, mark), cap, "above notional cap");
                // The order price respected the slippage bound.
                if (want == LONG) assertLe(uint256(price), mark * 10_050 / 10_000);
                else assertGe(uint256(price) * 10_000, mark * 9_950);
            } else {
                assertLe(lotsAfter, lotsBefore, "close increased the position");
                if (lotsAfter != 0) assertEq(sideAfter, sideBefore, "close flipped side");
            }
        } catch {
            (, uint256 lotsAfter) = _lots(perp);
            assertEq(lotsAfter, lotsBefore, "reverted order changed the position");
        }
    }

    /// Policy setter accepts exactly the documented ranges.
    function testFuzz_setPolicyBounds(uint16 lev, uint16 slip, uint16 dl, uint16 dd, uint32 ratio, uint64 cap, uint40 ttl)
        public
    {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxLeverageHdths = lev;
        p.maxSlippageBps = slip;
        p.dailyLossBps = dl;
        p.drawdownBps = dd;
        p.leaders[0].ratioBps = ratio;
        p.markets[0].maxNotionalCNS = cap;
        p.expiry = uint40(block.timestamp) + (ttl % 400 days);

        bool valid = lev >= 100 && lev <= 10_000 && slip >= 1 && slip <= 1_000 && dl < 10_000 && dd < 10_000
            && ratio >= 1 && ratio <= 10_000 && cap > 0 && p.expiry > block.timestamp;

        vm.prank(owner);
        try account.setPolicy(p) {
            assertTrue(valid, "accepted an invalid policy");
            assertEq(account.maxLeverageHdths(), lev);
            assertEq(account.maxSlippageBps(), slip);
        } catch {
            assertFalse(valid, "rejected a valid policy");
        }
    }

    /// No signer other than the owner can authorise an action.
    function testFuzz_executeRequiresOwnerSignature(uint256 key, uint8 kind, uint256 amount) public {
        key = bound(key, 1, SECP256K1_ORDER - 1);
        vm.assume(key != ownerKey);
        kind = uint8(bound(kind, 1, 6));
        MirrorAccount.Action memory a = _action(kind, abi.encode(amount));
        bytes memory sig = _signAction(a, key);
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.execute(a, sig);
    }

    /// Keepers (and anyone else who is not the owner) cannot reach any owner-only entry point.
    function testFuzz_nonOwnerCannotCallOwnerFunctions(address caller, uint256 amount, bytes calldata data) public {
        vm.assume(caller != owner);
        uint256 ownerBal = ausd.balanceOf(owner);
        uint256 eq = account.equity();

        vm.startPrank(caller);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.withdraw(amount);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.exchangeCall(data);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.sweep(address(ausd));
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.closeAll(100);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.setPaused(true);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.setPolicy(_defaultPolicy());
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.deposit(amount);
        vm.stopPrank();

        assertEq(ausd.balanceOf(owner), ownerBal);
        assertEq(account.equity(), eq);
    }

    /// Arbitrary calldata from a keeper never moves collateral to anyone but the owner.
    function testFuzz_keeperArbitraryCalldataNeverExtracts(bytes calldata data) public {
        uint256 keeperBefore = ausd.receivedTotal(keeper);
        vm.prank(keeper);
        (bool ok,) = address(account).call(data);
        ok; // success only possible through mirror or deposit-from-owner paths
        assertEq(ausd.receivedTotal(keeper), keeperBefore, "keeper received collateral");
        assertEq(ausd.balanceOf(keeper), 0);
    }

    function _markOf(uint256 perp) internal view returns (uint8, uint256, bool) {
        (, , , uint256 mark, bool valid, ) = _perp(perp);
        return (0, mark, valid);
    }

    function _perp(uint256 perp) internal view returns (uint8, uint8, uint8, uint256, bool, string memory) {
        (uint8 lotDec, uint8 priceDec, uint256 mark, bool valid, string memory sym,,,) = ex.perps(perp);
        return (0, lotDec, priceDec, mark, valid, sym);
    }

    function _notionalOf(uint256 perp, uint256 lots, uint256 mark) internal view returns (uint256) {
        (, uint8 lotDec, uint8 priceDec,,,) = _perp(perp);
        return lots * mark * 1e6 / 10 ** (uint256(lotDec) + priceDec);
    }
}

contract NewRulesFuzzTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _fund(20e6);
        ausd.mint(address(ex), 50e6);
    }

    /// Entry guard: any executed opening copy had both its limit and the mark within the bound of the leader's
    /// onchain entry; nothing changes when it blocks.
    function testFuzz_entryGuardBoundsEveryOpen(bool short, uint16 dev, int16 entryOffBps, int16 priceOffBps, uint64 lots)
        public
    {
        dev = uint16(bound(dev, 1, 5000));
        entryOffBps = int16(bound(entryOffBps, -1500, 1500));
        priceOffBps = int16(bound(priceOffBps, -400, 400));
        lots = uint64(bound(lots, 1, 10));
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxEntryDeviationBps = dev;
        p.maxSlippageBps = 1000;
        vm.prank(owner);
        account.setPolicy(p);
        uint256 mark = 855_000;
        uint256 entry = uint256(int256(mark) + int256(mark) * entryOffBps / 10_000);
        ex.setPositionAt(BTC, LEADER, short ? SHORT : LONG, 1000, entry);
        uint64 price = uint64(uint256(int256(mark) + int256(mark) * priceOffBps / 10_000));

        bool ok = _mirror(_order(short ? OPEN_SHORT : OPEN_LONG, BTC, lots, price, 500));
        (, uint256 after_) = _lots(BTC);
        if (!ok) {
            assertEq(after_, 0);
            return;
        }
        if (!short) {
            assertLe(uint256(price) * 10_000, entry * (10_000 + dev) + 10_000);
            assertLe(mark * 10_000, entry * (10_000 + dev) + 10_000);
        } else {
            assertGe(uint256(price) * 10_000 + 10_000, entry * (10_000 - dev));
            assertGe(mark * 10_000 + 10_000, entry * (10_000 - dev));
        }
    }

    /// A level fires only when its condition is true onchain, only reduces, and pays the caller nothing.
    function testFuzz_levelFiresOnlyWhenReached(
        bool profit,
        uint16 levelOffBps,
        int16 markMoveBps,
        int16 oracleGapBps,
        bool oracleFresh,
        address caller
    ) public {
        vm.assume(caller != owner && caller != address(account) && caller != address(ex));
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        levelOffBps = uint16(bound(levelOffBps, 1, 2000));
        uint64 lvl = uint64(profit ? 855_000 * (10_000 + uint256(levelOffBps)) / 10_000 : 855_000 * (10_000 - uint256(levelOffBps)) / 10_000);
        MirrorAccount.Level[] memory ls = new MirrorAccount.Level[](1);
        ls[0] = MirrorAccount.Level({
            perpId: uint32(BTC), side: LONG, stopLossPNS: profit ? 0 : lvl, takeProfitPNS: profit ? lvl : 0, slippageBps: 500
        });
        vm.prank(owner);
        account.setLevels(ls);

        markMoveBps = int16(bound(markMoveBps, -2500, 2500));
        uint256 mark = uint256(int256(855_000) + int256(855_000) * markMoveBps / 10_000);
        ex.setMark(BTC, mark);
        oracleGapBps = int16(bound(oracleGapBps, -400, 400));
        uint256 oracle = uint256(int256(mark) + int256(mark) * oracleGapBps / 10_000);
        ex.setOracle(BTC, oracle, oracleFresh ? block.timestamp : block.timestamp - 120);

        uint256 bal = ausd.balanceOf(caller);
        vm.prank(caller);
        try account.triggerLevel(BTC) returns (uint256 closed) {
            bool markReached = profit ? mark >= lvl : mark <= lvl;
            assertTrue(markReached, "fired before the mark reached the level");
            if (oracleFresh) {
                assertTrue(profit ? oracle >= lvl : oracle <= lvl, "fired before the oracle reached the level");
                uint256 gap = mark > oracle ? mark - oracle : oracle - mark;
                assertLe(gap * 10_000, oracle * 200, "fired on an untrusted mark");
            }
            assertLe(closed, 10);
        } catch {}
        (, uint256 after_) = _lots(BTC);
        assertLe(after_, 10, "trigger increased the position");
        assertEq(ausd.balanceOf(caller), bal, "caller received collateral");
    }

    /// Leader budget: margin held for a leader never exceeds its budget after an executed open.
    function testFuzz_budgetNeverExceeded(uint64 budget, uint16 lev, uint64 lots, uint8 rounds) public {
        budget = uint64(bound(budget, 1e6, 20e6));
        lev = uint16(bound(lev, 100, 500));
        rounds = uint8(bound(rounds, 1, 6));
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.leaders[0].budgetCNS = budget;
        p.markets[1].maxNotionalCNS = 1_000e6;
        vm.prank(owner);
        account.setPolicy(p);
        ex.setPosition(ETH, LEADER, LONG, 100_000);
        for (uint256 i; i < rounds; ++i) {
            _mirror(_order(OPEN_LONG, ETH, uint64(bound(lots, 1, 20)), 271_000, lev));
            (uint256 margin,,,) = account.leaderBook(LEADER);
            assertLe(margin, budget);
        }
    }
}
