// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {MockPerplExchange} from "./mocks/MockPerplExchange.sol";

/// Drives a funded two-leader MirrorAccount through random sequences of keeper copies, match-now orders,
/// leader trades, mark and oracle moves, liquidations, owner deposits/withdrawals/pauses/levels, stop triggers
/// called by strangers, and hostile calls from keepers and strangers.
contract MirrorHandler is Test {
    MirrorAccount public account;
    MockPerplExchange public ex;
    MockAUSD public ausd;
    address public owner;
    uint256 internal ownerKey;
    address public keeper;
    address public stranger;
    uint256 internal strangerKey;

    uint256[2] internal perps = [uint256(1), uint256(20)];
    uint32[2] internal leaderIds = [uint32(6), uint32(88)];
    uint256 public constant BUDGET = 8e6;
    uint256 public constant ENTRY_DEV_BPS = 300;

    // Ghost state checked by the invariants.
    uint256 public policyViolations;
    uint256 public hostileSuccesses;
    uint256 public increasesWhilePaused;
    uint256 public triggerIncreases;
    uint256 public mirrorsExecuted;
    uint256 public mirrorsBlocked;
    uint256 public triggersExecuted;
    uint256 public opensExecuted;
    uint256 public closesExecuted;
    uint256[32] public blockedBy;
    uint256 public ownerWithdrawn;
    bool public expectedPaused;

    constructor(
        MirrorAccount account_,
        MockPerplExchange ex_,
        MockAUSD ausd_,
        address owner_,
        uint256 ownerKey_,
        address keeper_
    ) {
        account = account_;
        ex = ex_;
        ausd = ausd_;
        owner = owner_;
        ownerKey = ownerKey_;
        keeper = keeper_;
        (stranger, strangerKey) = makeAddrAndKey("invariant-stranger");
    }

    // ---- honest actors --------------------------------------------------------------------------

    // Copies are the path under test, so the fuzzer gets three entry points into it.
    function keeperMirror(uint256 a, uint8 b, uint64 c, int16 d, uint16 e, uint8 f) external {
        _keeperMirror(a, b, c, d, e, f);
    }

    function keeperMirrorAgain(uint256 a, uint8 b, uint64 c, int16 d, uint16 e, uint8 f) external {
        _keeperMirror(a, b, c, d, e, f);
    }

    function keeperMirrorOnceMore(uint256 a, uint8 b, uint64 c, int16 d, uint16 e, uint8 f) external {
        _keeperMirror(a, b, c, d, e, f);
    }

    function _keeperMirror(uint256 seed, uint8 orderType, uint64 lots, int16 offsetBps, uint16 lev, uint8 chaos)
        internal
    {
        uint256 perp = perps[seed % 2];
        uint32 leader = leaderIds[(seed / 2) % 2];
        uint256 mark = _mark(perp);
        (uint8 curSide, uint256 curLots) = _pos(perp);
        (IPerplExchange.PositionInfoV2 memory lp,,) = IPerplExchange(address(ex)).getPositionV2(perp, leader);

        if (chaos % 4 == 0) {
            // Fully random order: mostly blocked or reverted, must never violate policy.
            orderType = uint8(bound(orderType, 0, 3));
            lots = uint64(bound(lots, 1, 40));
            offsetBps = int16(bound(offsetBps, -120, 120));
            lev = uint16(bound(lev, 0, 1500));
        } else if (curLots != 0 && chaos % 3 == 0) {
            // Plausible close of part of the current position, for the leader holding it.
            leader = account.marketLeader(perp) == 0 ? leader : account.marketLeader(perp);
            orderType = curSide == 0 ? 2 : 3;
            // Engine-style: close down to the leader's target, sometimes a random size.
            uint256 t = account.targetLots(perp, leader, curSide);
            lots = chaos % 2 == 0 && curLots > t ? uint64(curLots - t) : uint64(bound(lots, 1, curLots));
            offsetBps =
                int16(curSide == 0 ? -int256(bound(uint16(offsetBps), 0, 50)) : int256(bound(uint16(offsetBps), 0, 50)));
            lev = 0;
        } else {
            // Plausible copy of the leader's side, sized around the target, priced inside slippage.
            uint8 side = lp.lotLNS == 0 ? (chaos % 2 == 0 ? 0 : 1) : lp.positionType;
            orderType = side;
            uint256 target = account.targetLots(perp, leader, side);
            // Engine-style: top up to the leader's target, sometimes overshoot.
            lots = chaos % 3 == 1 && target > curLots
                ? uint64(bound(lots, 1, target - curLots))
                : uint64(bound(lots, 1, target + 3));
            offsetBps =
                int16(side == 0 ? int256(bound(uint16(offsetBps), 0, 60)) : -int256(bound(uint16(offsetBps), 0, 60)));
            lev = uint16(bound(lev, 100, 600));
        }
        uint64 price = uint64(uint256(int256(mark) + int256(mark) * offsetBps / 10_000));
        MirrorAccount.MirrorOrder memory o = MirrorAccount.MirrorOrder({
            leaderAccountId: leader,
            perpId: uint32(perp),
            orderType: orderType,
            lotLNS: lots,
            pricePNS: price,
            leverageHdths: lev,
            maxMatches: 0,
            leaderRef: chaos % 5 == 0 ? keccak256(abi.encode(perp, lots)) : bytes32(0),
            leaderFillPNS: uint64(lp.pricePNS)
        });
        _checkedCopy(o, keeper, mark);
    }

    /// The owner's match-now goes through the same checks; its outcome must satisfy the same invariant.
    function ownerMatchesNow(uint256 seed, uint64 lots, int16 offsetBps, uint16 lev) external {
        uint256 perp = perps[seed % 2];
        uint32 leader = leaderIds[(seed / 2) % 2];
        (IPerplExchange.PositionInfoV2 memory lp,,) = IPerplExchange(address(ex)).getPositionV2(perp, leader);
        uint8 side = lp.lotLNS == 0 ? 0 : lp.positionType;
        uint256 mark = _mark(perp);
        offsetBps = int16(bound(offsetBps, -100, 100));
        MirrorAccount.MirrorOrder memory o = MirrorAccount.MirrorOrder({
            leaderAccountId: leader,
            perpId: uint32(perp),
            orderType: side,
            lotLNS: uint64(bound(lots, 1, 30)),
            pricePNS: uint64(uint256(int256(mark) + int256(mark) * offsetBps / 10_000)),
            leverageHdths: uint16(bound(lev, 50, 800)),
            maxMatches: 0,
            leaderRef: bytes32(0),
            leaderFillPNS: 0
        });
        _checkedCopy(o, owner, mark);
    }

    /// Sends a copy (keeper) or a match-now (owner) and counts any outcome that breaks the policy.
    function _checkedCopy(MirrorAccount.MirrorOrder memory o, address who, uint256 mark) internal {
        uint256 perp = o.perpId;
        (uint8 sideBefore, uint256 lotsBefore) = _pos(perp);
        bool pausedBefore = account.paused();
        bool opening = o.orderType <= 1;
        uint32 holderBefore = account.marketLeader(perp);
        (IPerplExchange.PositionInfoV2 memory lp,,) = IPerplExchange(address(ex)).getPositionV2(perp, o.leaderAccountId);

        bool executed;
        bool reverted;
        vm.recordLogs();
        vm.prank(who);
        if (who == owner) {
            MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](1);
            m[0] = o;
            try account.matchNow(m) returns (bool[] memory ok) {
                executed = ok[0];
            } catch {
                reverted = true;
            }
        } else {
            try account.mirror(o) returns (bool ok) {
                executed = ok;
            } catch {
                reverted = true;
            }
        }

        (uint8 sideAfter, uint256 lotsAfter) = _pos(perp);
        if (reverted || !executed) {
            if (!reverted) {
                ++mirrorsBlocked;
                (MirrorAccount.BlockReason r,) = _reason(vm.getRecordedLogs());
                ++blockedBy[uint8(r)];
            }
            if (lotsAfter != lotsBefore) ++policyViolations;
            return;
        }
        ++mirrorsExecuted;
        if (opening) ++opensExecuted;
        else ++closesExecuted;
        if (opening) {
            uint8 want = o.orderType == 0 ? 0 : 1;
            if (pausedBefore && lotsAfter > lotsBefore) ++increasesWhilePaused;
            if (o.leverageHdths < 100 || o.leverageHdths > account.maxLeverageHdths()) ++policyViolations;
            if (lotsAfter != 0 && sideAfter != want) ++policyViolations;
            if (lotsAfter > account.targetLots(perp, o.leaderAccountId, want)) ++policyViolations;
            (,,,, uint64 cap) = account.markets(perp);
            (uint8 lotDec, uint8 priceDec,,,,,,) = ex.perps(perp);
            if (lotsAfter * mark * 1e6 / 10 ** (uint256(lotDec) + priceDec) > cap) ++policyViolations;
            // Another leader's market is never added to.
            if (lotsBefore != 0 && holderBefore != o.leaderAccountId) ++policyViolations;
            if (lotsAfter > lotsBefore) {
                if (account.marketLeader(perp) != o.leaderAccountId) ++policyViolations;
                // Leader budget respected.
                (uint256 margin,,,) = account.leaderBook(o.leaderAccountId);
                if (margin > BUDGET) ++policyViolations;
                // Entry guard: the mock fills at mark, which must sit within the bound of the leader's entry.
                if (want == 0 && mark * 10_000 > lp.pricePNS * (10_000 + ENTRY_DEV_BPS)) ++policyViolations;
                if (want == 1 && mark * 10_000 < lp.pricePNS * (10_000 - ENTRY_DEV_BPS)) ++policyViolations;
            }
        } else {
            if (lotsAfter > lotsBefore) ++policyViolations;
            if (lotsAfter != 0 && sideAfter != sideBefore) ++policyViolations;
            // A keeper close never takes the follower below ratio x the leader's position.
            if (lotsAfter < account.targetLots(perp, o.leaderAccountId, sideBefore)) ++policyViolations;
        }
    }

    function _reason(Vm.Log[] memory logs) internal pure returns (MirrorAccount.BlockReason r, bool found) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MirrorAccount.Blocked.selector) {
                (r,,,,,,,) = abi.decode(
                    logs[i].data, (MirrorAccount.BlockReason, uint8, uint64, uint256, uint256, bytes32, uint64, uint64)
                );
                return (r, true);
            }
        }
    }

    function leaderTrades(uint256 seed, bool short, uint32 lots, int16 entryOffsetBps) external {
        uint256 perp = perps[seed % 2];
        uint32 leader = leaderIds[(seed / 2) % 2];
        uint256 mark = _mark(perp);
        entryOffsetBps = int16(bound(entryOffsetBps, -450, 450));
        uint256 entry = uint256(int256(mark) + int256(mark) * entryOffsetBps / 10_000);
        ex.setPositionAt(perp, leader, short ? 1 : 0, bound(lots, 0, 4000), entry);
    }

    function markMoves(uint256 perpSeed, int16 moveBps, int16 oracleGapBps, bool oracleFresh) external {
        uint256 perp = perps[perpSeed % 2];
        // Mostly small moves so copies keep flowing; occasionally a large one that trips stops and levels.
        moveBps = perpSeed % 8 == 0 ? int16(bound(moveBps, -800, 800)) : int16(bound(moveBps, -150, 150));
        uint256 mark = _mark(perp);
        uint256 next = uint256(int256(mark) + int256(mark) * moveBps / 10_000);
        if (next == 0) next = 1;
        ex.setMark(perp, next);
        oracleGapBps = int16(bound(oracleGapBps, -400, 400));
        uint256 oracle = uint256(int256(next) + int256(next) * oracleGapBps / 10_000);
        ex.setOracle(perp, oracle == 0 ? 1 : oracle, oracleFresh ? block.timestamp : block.timestamp - 1 hours);
    }

    function liquidation(uint256 perpSeed) external {
        // Perpl may liquidate a position without any order from the account.
        uint256 perp = perps[perpSeed % 2];
        if (perpSeed % 7 != 0) return;
        ex.wipePosition(perp, account.perplAccountId());
    }

    function ownerDeposits(uint256 amount) external {
        uint256 room = account.DEPOSIT_CAP() - account.netDeposits();
        if (room == 0) return;
        amount = bound(amount, 1, room);
        ausd.mint(owner, amount);
        vm.startPrank(owner);
        ausd.approve(address(account), amount);
        account.deposit(amount);
        vm.stopPrank();
    }

    function ownerWithdraws(uint256 amount) external {
        uint256 free = ex.balanceOf(account.perplAccountId()) + ausd.balanceOf(address(account));
        if (free == 0) return;
        amount = bound(amount, 1, free);
        vm.prank(owner);
        account.withdraw(amount);
        ownerWithdrawn += amount;
    }

    function ownerPauses(uint8 seed) external {
        // Resuming is more common than pausing, so stop-triggered pauses do not freeze the run.
        bool p = seed % 4 == 0;
        vm.prank(owner);
        account.setPaused(p);
        expectedPaused = p;
    }

    function ownerSetsLevel(uint256 perpSeed, uint16 slBps, uint16 tpBps) external {
        uint256 perp = perps[perpSeed % 2];
        (uint8 side, uint256 lots) = _pos(perp);
        if (lots == 0) return;
        uint256 mark = _mark(perp);
        slBps = uint16(bound(slBps, 1, 900));
        tpBps = uint16(bound(tpBps, 1, 900));
        MirrorAccount.Level[] memory ls = new MirrorAccount.Level[](1);
        ls[0] = MirrorAccount.Level({
            perpId: uint32(perp),
            side: side,
            stopLossPNS: uint64(side == 0 ? mark * (10_000 - slBps) / 10_000 : mark * (10_000 + slBps) / 10_000),
            takeProfitPNS: uint64(side == 0 ? mark * (10_000 + tpBps) / 10_000 : mark * (10_000 - tpBps) / 10_000),
            slippageBps: 300
        });
        vm.prank(owner);
        try account.setLevels(ls) {} catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    // ---- permissionless stop triggers, called by a stranger --------------------------------------

    function strangerTriggersLevel(uint256 perpSeed) external {
        uint256 perp = perps[perpSeed % 2];
        _trigger(abi.encodeCall(MirrorAccount.triggerLevel, (perp)), false);
    }

    function strangerTriggersAccountStop() external {
        _trigger(abi.encodeCall(MirrorAccount.triggerAccountStop, ()), true);
    }

    function strangerTriggersLeaderStop(uint256 seed) external {
        _trigger(abi.encodeCall(MirrorAccount.triggerLeaderStop, (leaderIds[seed % 2])), false);
    }

    function _trigger(bytes memory call, bool pauses) internal {
        (, uint256 btcBefore) = _pos(perps[0]);
        (, uint256 ethBefore) = _pos(perps[1]);
        vm.prank(stranger);
        (bool ok,) = address(account).call(call);
        (, uint256 btcAfter) = _pos(perps[0]);
        (, uint256 ethAfter) = _pos(perps[1]);
        if (btcAfter > btcBefore || ethAfter > ethBefore) ++triggerIncreases;
        if (ok) {
            ++triggersExecuted;
            if (pauses) expectedPaused = true;
        }
    }

    // ---- hostile actors -------------------------------------------------------------------------

    function keeperTriesToExtract(uint256 amount, bytes calldata data) external {
        _hostile(keeper, amount, data);
    }

    function strangerTriesToExtract(uint256 amount, bytes calldata data) external {
        _hostile(stranger, amount, data);
    }

    function strangerForgesAction(uint8 kind, uint256 amount) external {
        kind = uint8(bound(kind, 1, 10));
        MirrorAccount.Action memory a = MirrorAccount.Action({
            kind: kind,
            data: kind == 4 ? abi.encode(amount) : abi.encode(stranger),
            nonce: account.actionNonce(),
            deadline: block.timestamp + 1 hours
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(strangerKey, account.actionDigest(a));
        vm.prank(keeper);
        try account.execute(a, abi.encodePacked(r, s, v)) {
            ++hostileSuccesses;
        } catch {}
    }

    function _hostile(address who, uint256 amount, bytes calldata data) internal {
        vm.startPrank(who);
        try account.withdraw(amount) {
            ++hostileSuccesses;
        } catch {}
        try account.exchangeCall(data) {
            ++hostileSuccesses;
        } catch {}
        try account.sweep(address(ausd)) {
            ++hostileSuccesses;
        } catch {}
        try account.closeAll(100) {
            ++hostileSuccesses;
        } catch {}
        try account.closeMarket(uint32(perps[amount % 2]), 100) {
            ++hostileSuccesses;
        } catch {}
        try account.setPaused(false) {
            ++hostileSuccesses;
        } catch {}
        try account.setLevels(new MirrorAccount.Level[](0)) {
            ++hostileSuccesses;
        } catch {}
        // Direct calls into the Exchange as the attacker only touch the attacker's own (non-existent) account.
        try ex.withdrawCollateral(amount) {
            ++hostileSuccesses;
        } catch {}
        vm.stopPrank();
    }

    function _mark(uint256 perp) internal view returns (uint256 mark) {
        (,, mark,,,,,) = ex.perps(perp);
    }

    function _pos(uint256 perp) internal view returns (uint8, uint256) {
        (IPerplExchange.PositionInfoV2 memory p,,) =
            IPerplExchange(address(ex)).getPositionV2(perp, account.perplAccountId());
        return (p.positionType, p.lotLNS);
    }
}

contract MirrorInvariantTest is MirrorBase {
    MirrorHandler internal handler;
    uint40 internal policyExpiry;

    function setUp() public override {
        super.setUp();
        _setUpFunded();
        ausd.mint(address(ex), 1_000e6); // counterparty liquidity for profitable closes in the mock
        ex.setFeeBps(5);
        ex.setPosition(BTC, LEADER2, SHORT, 2000);

        MirrorAccount.Policy memory p = _defaultPolicy();
        p.dailyLossBps = 300;
        p.drawdownBps = 800;
        p.expiry = uint40(block.timestamp + 365 days);
        p.maxEntryDeviationBps = 300;
        p.stopSlippageBps = 300;
        p.flattenOnStop = true;
        p.leaders = new MirrorAccount.LeaderRule[](2);
        p.leaders[0] = MirrorAccount.LeaderRule({accountId: LEADER, ratioBps: 100, budgetCNS: 8e6, lossStopBps: 3000});
        p.leaders[1] = MirrorAccount.LeaderRule({accountId: LEADER2, ratioBps: 150, budgetCNS: 8e6, lossStopBps: 3000});
        policyExpiry = p.expiry;
        vm.prank(owner);
        account.setPolicy(p);

        handler = new MirrorHandler(account, ex, ausd, owner, ownerKey, keeper);
        targetContract(address(handler));
        excludeSender(owner);
        excludeSender(keeper);
    }

    /// The core safety property: neither a keeper nor any other non-owner ever receives collateral, whatever
    /// copies, triggers and hostile calls they make.
    function invariant_keeperNeverReceivesCollateral() public view {
        assertEq(ausd.receivedTotal(keeper), 0, "keeper received collateral");
        assertEq(ausd.receivedTotal(handler.stranger()), 0, "stranger received collateral");
        assertEq(ausd.receivedTotal(relayer), 0, "relayer received collateral");
        assertEq(ausd.receivedTotal(address(handler)), 0, "handler received collateral");
    }

    /// Every hostile attempt (owner-only calls, forged signatures) failed.
    function invariant_hostileCallsAlwaysFail() public view {
        assertEq(handler.hostileSuccesses(), 0);
    }

    /// Every executed copy satisfied the policy at the moment it executed (leverage, side, per-leader target,
    /// notional cap, market ownership, leader budget, entry guard, close floor); blocked copies changed nothing.
    function invariant_noPolicyViolation() public view {
        assertEq(handler.policyViolations(), 0);
    }

    function invariant_noExposureIncreaseWhilePaused() public view {
        assertEq(handler.increasesWhilePaused(), 0);
    }

    /// Stop triggers called by a stranger only ever reduce positions.
    function invariant_triggersOnlyReduce() public view {
        assertEq(handler.triggerIncreases(), 0);
    }

    function invariant_depositsWithinCap() public view {
        assertLe(account.netDeposits(), account.DEPOSIT_CAP());
    }

    function invariant_ownerIsFixed() public view {
        assertEq(account.owner(), owner);
    }

    /// Collateral is conserved: everything minted sits with the owner, the account, or the exchange.
    function invariant_collateralConserved() public view {
        uint256 accounted = ausd.balanceOf(owner) + ausd.balanceOf(address(account)) + ausd.balanceOf(address(ex));
        assertEq(accounted, ausd.totalSupply());
    }

    /// Only the owner changes the policy. The pause flag changes only by the owner or by a triggered account
    /// stop (which can only set it); every rule is exactly what the owner last set.
    function invariant_onlyOwnerChangesPolicy() public view {
        assertEq(account.paused(), handler.expectedPaused(), "pause state changed outside owner or stop");
        assertEq(account.maxLeverageHdths(), 500);
        assertEq(account.maxSlippageBps(), 50);
        assertEq(account.dailyLossBps(), 300);
        assertEq(account.drawdownBps(), 800);
        assertEq(account.expiry(), policyExpiry);
        assertEq(account.maxEntryDeviationBps(), 300);
        assertTrue(account.flattenOnStop());
        assertEq(account.maxBuilderFeePer100K(), 20);
        MirrorAccount.LeaderRule[] memory ls = account.leaders();
        assertEq(ls.length, 2);
        assertEq(ls[0].accountId, LEADER);
        assertEq(ls[1].accountId, LEADER2);
        assertEq(ls[1].budgetCNS, 8e6);
        assertEq(account.marketIds().length, 2);
        (bool allowed,,,, uint64 btcCap) = account.markets(BTC);
        assertTrue(allowed);
        assertEq(btcCap, 15e6);
    }

    /// Every open position is held for one followed leader (or flagged as such by the last copy into it).
    function invariant_openPositionsHaveAHolder() public view {
        uint256[2] memory ps = [BTC, ETH];
        for (uint256 i; i < 2; ++i) {
            (IPerplExchange.PositionInfoV2 memory p,,) =
                IPerplExchange(address(ex)).getPositionV2(ps[i], account.perplAccountId());
            if (p.lotLNS == 0) continue;
            uint32 h = account.marketLeader(ps[i]);
            assertTrue(h == LEADER || h == LEADER2, "open position without a holder");
        }
    }

    /// Builder attribution: no reducing order (keeper close, stop, close-all, close-market) was ever attributed,
    /// and every attributed order named builder 26 at the fixed fee, never above the owner's signed maximum.
    function invariant_builderFeeOnlyOnOpensAtTheFixedRate() public view {
        assertEq(ex.attributedCloses(), 0, "a reducing order carried builder attribution");
        uint256 id = ex.lastBuilderId();
        assertTrue(id == 0 || id == 26, "attributed to another builder");
        if (id != 0) {
            assertEq(ex.lastBuilderFeePer100K(), 20);
            assertLe(ex.lastBuilderFeePer100K(), account.maxBuilderFeePer100K());
        }
    }

    /// Logged so a run shows the copy and trigger paths were exercised.
    function invariant_callSummary() public view {
        console.log("mirrors executed  ", handler.mirrorsExecuted());
        console.log("mirrors blocked   ", handler.mirrorsBlocked());
        console.log("triggers executed ", handler.triggersExecuted());
        console.log("owner withdrawn   ", handler.ownerWithdrawn());
        console.log("opens executed    ", handler.opensExecuted());
        console.log("closes executed   ", handler.closesExecuted());
        for (uint256 i; i < 21; ++i) {
            if (handler.blockedBy(i) != 0) console.log("blocked by reason", i, handler.blockedBy(i));
        }
    }
}
