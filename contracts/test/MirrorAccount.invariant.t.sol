// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {MockPerplExchange} from "./mocks/MockPerplExchange.sol";

/// Drives a funded MirrorAccount through random sequences of keeper copies, leader trades, price moves,
/// owner deposits/withdrawals/pauses, and hostile calls from keepers and strangers.
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
    uint32 internal constant LEADER = 6;

    // Ghost state checked by the invariants.
    uint256 public policyViolations;
    uint256 public hostileSuccesses;
    uint256 public increasesWhilePaused;
    uint256 public mirrorsExecuted;
    uint256 public mirrorsBlocked;
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

    function _keeperMirror(uint256 perpSeed, uint8 orderType, uint64 lots, int16 offsetBps, uint16 lev, uint8 chaos)
        internal
    {
        uint256 perp = perps[perpSeed % 2];
        (, , uint256 mark, ,) = ex.perps(perp);
        (uint8 curSide, uint256 curLots) = _pos(perp);
        (IPerplExchange.PositionInfoV2 memory lp,,) = IPerplExchange(address(ex)).getPositionV2(perp, LEADER);

        if (chaos % 4 == 0) {
            // Fully random order: mostly blocked or reverted, must never violate policy.
            orderType = uint8(bound(orderType, 0, 3));
            lots = uint64(bound(lots, 1, 40));
            offsetBps = int16(bound(offsetBps, -120, 120));
            lev = uint16(bound(lev, 0, 1500));
        } else if (curLots != 0 && chaos % 3 == 0) {
            // Plausible close of part of the current position.
            orderType = curSide == 0 ? 2 : 3;
            lots = uint64(bound(lots, 1, curLots));
            offsetBps = int16(curSide == 0 ? -int256(bound(uint16(offsetBps), 0, 50)) : int256(bound(uint16(offsetBps), 0, 50)));
            lev = 0;
        } else {
            // Plausible copy of the leader's side, sized around the target, priced inside slippage.
            uint8 side = lp.lotLNS == 0 ? (chaos % 2 == 0 ? 0 : 1) : lp.positionType;
            orderType = side;
            uint256 target = account.targetLots(perp, side);
            lots = uint64(bound(lots, 1, target + 3));
            offsetBps = int16(side == 0 ? int256(bound(uint16(offsetBps), 0, 60)) : -int256(bound(uint16(offsetBps), 0, 60)));
            lev = uint16(bound(lev, 100, 600));
        }
        uint64 price = uint64(uint256(int256(mark) + int256(mark) * offsetBps / 10_000));
        bool useRef = chaos % 5 == 0;

        (uint8 sideBefore, uint256 lotsBefore) = _pos(perp);
        bool pausedBefore = account.paused();

        MirrorAccount.MirrorOrder memory o = MirrorAccount.MirrorOrder({
            leaderAccountId: LEADER,
            perpId: uint32(perp),
            orderType: orderType,
            lotLNS: lots,
            pricePNS: price,
            leverageHdths: lev,
            maxMatches: 0,
            leaderRef: useRef ? keccak256(abi.encode(perp, lots)) : bytes32(0)
        });

        vm.prank(keeper);
        try account.mirror(o) returns (bool executed) {
            (uint8 sideAfter, uint256 lotsAfter) = _pos(perp);
            if (!executed) {
                ++mirrorsBlocked;
                if (lotsAfter != lotsBefore) ++policyViolations;
                return;
            }
            ++mirrorsExecuted;
            bool opening = orderType <= 1;
            if (opening) {
                uint8 want = orderType == 0 ? 0 : 1;
                if (pausedBefore && lotsAfter > lotsBefore) ++increasesWhilePaused;
                if (lev < 100 || lev > account.maxLeverageHdths()) ++policyViolations;
                if (lotsAfter != 0 && sideAfter != want) ++policyViolations;
                if (lotsAfter > account.targetLots(perp, want)) ++policyViolations;
                (,,, uint64 cap) = account.markets(perp);
                (uint8 lotDec, uint8 priceDec,,,) = ex.perps(perp);
                if (lotsAfter * mark * 1e6 / 10 ** (uint256(lotDec) + priceDec) > cap) ++policyViolations;
            } else {
                if (lotsAfter > lotsBefore) ++policyViolations;
                if (lotsAfter != 0 && sideAfter != sideBefore) ++policyViolations;
            }
        } catch {
            (, uint256 lotsAfter) = _pos(perp);
            if (lotsAfter != lotsBefore) ++policyViolations;
        }
    }

    /// The owner's match-now goes through the same checks; its outcome must satisfy the same invariant.
    function ownerMatchesNow(uint256 perpSeed, uint64 lots, int16 offsetBps, uint16 lev) external {
        uint256 perp = perps[perpSeed % 2];
        (IPerplExchange.PositionInfoV2 memory lp,,) = IPerplExchange(address(ex)).getPositionV2(perp, LEADER);
        uint8 side = lp.lotLNS == 0 ? 0 : lp.positionType;
        (, , uint256 mark, ,) = ex.perps(perp);
        offsetBps = int16(bound(offsetBps, -100, 100));
        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](1);
        m[0] = MirrorAccount.MirrorOrder({
            leaderAccountId: LEADER,
            perpId: uint32(perp),
            orderType: side,
            lotLNS: uint64(bound(lots, 1, 30)),
            pricePNS: uint64(uint256(int256(mark) + int256(mark) * offsetBps / 10_000)),
            leverageHdths: uint16(bound(lev, 50, 800)),
            maxMatches: 0,
            leaderRef: bytes32(0)
        });
        (uint8 sideBefore, uint256 lotsBefore) = _pos(perp);
        vm.prank(owner);
        try account.matchNow(m) returns (bool[] memory ok) {
            (uint8 sideAfter, uint256 lotsAfter) = _pos(perp);
            if (!ok[0]) {
                ++mirrorsBlocked;
                if (lotsAfter != lotsBefore) ++policyViolations;
                return;
            }
            ++mirrorsExecuted;
            if (account.paused() && lotsAfter > lotsBefore) ++increasesWhilePaused;
            if (lotsAfter != 0 && sideAfter != side) ++policyViolations;
            if (lotsAfter > account.targetLots(perp, side)) ++policyViolations;
            sideBefore;
        } catch {
            (, uint256 lotsAfter) = _pos(perp);
            if (lotsAfter != lotsBefore) ++policyViolations;
        }
    }

    function leaderTrades(uint256 perpSeed, bool short, uint32 lots) external {
        uint256 perp = perps[perpSeed % 2];
        ex.setPosition(perp, LEADER, short ? 1 : 0, bound(lots, 0, 4000));
    }

    function markMoves(uint256 perpSeed, int16 moveBps) external {
        uint256 perp = perps[perpSeed % 2];
        moveBps = int16(bound(moveBps, -800, 800));
        (, , uint256 mark, ,) = ex.perps(perp);
        uint256 next = uint256(int256(mark) + int256(mark) * moveBps / 10_000);
        if (next == 0) next = 1;
        ex.setMark(perp, next);
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

    function ownerPauses(bool p) external {
        vm.prank(owner);
        account.setPaused(p);
        expectedPaused = p;
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    // ---- hostile actors -------------------------------------------------------------------------

    function keeperTriesToExtract(uint256 amount, bytes calldata data) external {
        _hostile(keeper, amount, data);
    }

    function strangerTriesToExtract(uint256 amount, bytes calldata data) external {
        _hostile(stranger, amount, data);
    }

    function strangerForgesAction(uint8 kind, uint256 amount) external {
        kind = uint8(bound(kind, 1, 6));
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
        try account.withdraw(amount) { ++hostileSuccesses; } catch {}
        try account.exchangeCall(data) { ++hostileSuccesses; } catch {}
        try account.sweep(address(ausd)) { ++hostileSuccesses; } catch {}
        try account.closeAll(100) { ++hostileSuccesses; } catch {}
        try account.setPaused(false) { ++hostileSuccesses; } catch {}
        // Direct calls into the Exchange as the attacker only touch the attacker's own (non-existent) account.
        try ex.withdrawCollateral(amount) { ++hostileSuccesses; } catch {}
        vm.stopPrank();
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

        MirrorAccount.Policy memory p = _defaultPolicy();
        p.dailyLossBps = 300;
        p.drawdownBps = 800;
        p.expiry = uint40(block.timestamp + 365 days);
        policyExpiry = p.expiry;
        vm.prank(owner);
        account.setPolicy(p);

        handler = new MirrorHandler(account, ex, ausd, owner, ownerKey, keeper);
        targetContract(address(handler));
        excludeSender(owner);
        excludeSender(keeper);
    }

    /// The core safety property: neither a keeper nor any other non-owner ever receives collateral.
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

    /// Every executed copy satisfied the policy at the moment it executed; blocked copies changed nothing.
    function invariant_noPolicyViolation() public view {
        assertEq(handler.policyViolations(), 0);
    }

    function invariant_noExposureIncreaseWhilePaused() public view {
        assertEq(handler.increasesWhilePaused(), 0);
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

    /// Only the owner changes the policy or the pause state: every rule and the pause flag are exactly
    /// what the owner last set, whatever keepers, strangers and forged signatures attempted.
    function invariant_onlyOwnerChangesPolicy() public view {
        assertEq(account.paused(), handler.expectedPaused(), "pause state changed by a non-owner");
        assertEq(account.maxLeverageHdths(), 500);
        assertEq(account.maxSlippageBps(), 50);
        assertEq(account.dailyLossBps(), 300);
        assertEq(account.drawdownBps(), 800);
        assertEq(account.expiry(), policyExpiry);
        MirrorAccount.LeaderRule[] memory ls = account.leaders();
        assertEq(ls.length, 1);
        assertEq(ls[0].accountId, LEADER);
        assertEq(ls[0].ratioBps, 100);
        assertEq(account.marketIds().length, 2);
        (,,, uint64 btcCap) = account.markets(BTC);
        assertEq(btcCap, 15e6);
    }

    /// Logged so a run shows the copy path was exercised (executed and blocked copies, owner withdrawals).
    function invariant_callSummary() public view {
        console.log("mirrors executed", handler.mirrorsExecuted());
        console.log("mirrors blocked ", handler.mirrorsBlocked());
        console.log("owner withdrawn ", handler.ownerWithdrawn());
    }
}
