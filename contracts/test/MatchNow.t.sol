// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";

/// Match now: on follow, the owner's own signed action brings the account to the leader's current
/// position at the sizing ratio, through exactly the same onchain checks as a keeper copy.
contract MatchNowTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _fund(20e6);
    }

    function _match(uint8 orderType, uint256 perpId, uint64 lots, uint64 price, uint16 lev)
        internal
        pure
        returns (MirrorAccount.MirrorOrder[] memory m)
    {
        m = new MirrorAccount.MirrorOrder[](1);
        m[0] = _order(orderType, perpId, lots, price, lev);
    }

    function _blockedReasons() internal returns (uint8[] memory reasons) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MirrorAccount.Blocked.selector) ++n;
        }
        reasons = new uint8[](n);
        n = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MirrorAccount.Blocked.selector) {
                (MirrorAccount.BlockReason r,,,,,,,) = abi.decode(
                    logs[i].data, (MirrorAccount.BlockReason, uint8, uint64, uint256, uint256, bytes32, uint64, uint64)
                );
                reasons[n++] = uint8(r);
            }
        }
    }

    function test_follow_setsPolicyAndMatchesLeaderImmediately() public {
        vm.prank(owner);
        bool[] memory ok = account.follow(_defaultPolicy(), _match(OPEN_LONG, BTC, 10, 859_000, 500));
        assertTrue(ok[0]);
        (uint8 side, uint256 lots) = _lots(BTC);
        assertEq(side, LONG);
        assertEq(lots, 10); // 1% of the leader's 1000 lots
        assertEq(account.maxLeverageHdths(), 500);
    }

    function test_follow_emitsMirroredWithOwnerAsActorAndMatchNowRef() public {
        bytes32 ref = account.MATCH_NOW_REF();
        vm.expectEmit(true, true, true, true, address(account));
        MirrorAccount.CopyProof memory proof = MirrorAccount.CopyProof({
            leaderFillPNS: 0,
            leaderEntryPNS: 855_000,
            markPNS: 855_000,
            fillPNS: 855_000,
            entryDeviationBps: 0
        });
        emit MirrorAccount.Mirrored(owner, LEADER, uint32(BTC), OPEN_LONG, 10, 859_000, 500, 0, 10, ref, proof);
        vm.prank(owner);
        account.follow(_defaultPolicy(), _match(OPEN_LONG, BTC, 10, 859_000, 500));
    }

    function test_follow_viaSignedAction_relayedByAnyone() public {
        MirrorAccount.Action memory a =
            _action(account.ACTION_FOLLOW(), abi.encode(_defaultPolicy(), _match(OPEN_LONG, BTC, 10, 859_000, 500)));
        bytes memory sig = _signAction(a, ownerKey);
        vm.prank(relayer);
        bytes memory result = account.execute(a, sig);
        bool[] memory ok = abi.decode(result, (bool[]));
        assertTrue(ok[0]);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 10);
    }

    function test_follow_unpausesAPausedAccount() public {
        vm.startPrank(owner);
        account.setPolicy(_defaultPolicy());
        account.setPaused(true);
        account.follow(_defaultPolicy(), _match(OPEN_LONG, BTC, 10, 859_000, 500));
        vm.stopPrank();
        assertFalse(account.paused());
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 10);
    }

    function test_follow_withoutMatchOrdersOnlySetsPolicy() public {
        vm.prank(owner);
        bool[] memory ok = account.follow(_defaultPolicy(), new MirrorAccount.MirrorOrder[](0));
        assertEq(ok.length, 0);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 0);
    }

    function test_matchNow_cannotExceedLeaderTarget() public {
        vm.recordLogs();
        vm.prank(owner);
        bool[] memory ok = account.follow(_defaultPolicy(), _match(OPEN_LONG, BTC, 11, 859_000, 500));
        assertFalse(ok[0]);
        uint8[] memory r = _blockedReasons();
        assertEq(r.length, 1);
        assertEq(r[0], uint8(MirrorAccount.BlockReason.ExceedsLeaderTarget));
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 0);
    }

    function test_matchNow_blockedByEachRuleWithEvent() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());

        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](4);
        m[0] = _order(OPEN_LONG, BTC, 10, 859_000, 2000); // leverage above 5x
        m[1] = _order(OPEN_LONG, BTC, 10, 860_000, 500); // above slippage bound 859,275
        m[2] = _order(OPEN_LONG, ETH, 6, 271_000, 500); // 6 lots = 16.2 AUSD > 15 cap
        m[3] = _order(OPEN_SHORT, BTC, 5, 851_000, 500); // leader is long
        vm.recordLogs();
        vm.prank(owner);
        bool[] memory ok = account.matchNow(m);
        for (uint256 i; i < 4; ++i) assertFalse(ok[i]);
        uint8[] memory r = _blockedReasons();
        assertEq(r[0], uint8(MirrorAccount.BlockReason.LeverageTooHigh));
        assertEq(r[1], uint8(MirrorAccount.BlockReason.SlippageTooHigh));
        assertEq(r[2], uint8(MirrorAccount.BlockReason.ExceedsMaxNotional));
        assertEq(r[3], uint8(MirrorAccount.BlockReason.LeaderSideMismatch));
    }

    function test_matchNow_mixedOutcomesPerMarket() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](2);
        m[0] = _order(OPEN_LONG, BTC, 10, 859_000, 500);
        m[1] = _order(OPEN_LONG, ETH, 9, 271_000, 500); // over the ETH notional cap
        vm.prank(owner);
        bool[] memory ok = account.matchNow(m);
        assertTrue(ok[0]);
        assertFalse(ok[1]);
    }

    function test_matchNow_topsUpToTargetAfterKeeperCopies() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        vm.prank(keeper);
        account.mirror(_order(OPEN_LONG, BTC, 4, 859_000, 500));
        vm.prank(owner);
        bool[] memory ok = account.matchNow(_match(OPEN_LONG, BTC, 6, 859_000, 500));
        assertTrue(ok[0]);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 10);
    }

    function test_matchNow_opensOnly() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        vm.expectRevert(MirrorAccount.MatchNowOpensOnly.selector);
        vm.prank(owner);
        account.matchNow(_match(CLOSE_LONG, BTC, 1, 851_000, 0));
    }

    function test_matchNow_tooManyOrders() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        vm.expectRevert(MirrorAccount.TooManyMatchOrders.selector);
        vm.prank(owner);
        account.matchNow(new MirrorAccount.MirrorOrder[](17));
    }

    function test_matchNow_onlyOwner() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        MirrorAccount.MirrorOrder[] memory m = _match(OPEN_LONG, BTC, 10, 859_000, 500);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.matchNow(m);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.follow(_defaultPolicy(), m);
    }

    function test_matchNow_signedByStrangerRejected() public {
        MirrorAccount.Action memory a =
            _action(account.ACTION_MATCH_NOW(), abi.encode(_match(OPEN_LONG, BTC, 10, 859_000, 500)));
        (, uint256 strangerKey) = makeAddrAndKey("not-owner");
        bytes memory sig = _signAction(a, strangerKey);
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.execute(a, sig);
    }

    function test_matchNow_ignoresCallerSuppliedLeaderRef() public {
        vm.prank(owner);
        account.setPolicy(_defaultPolicy());
        MirrorAccount.MirrorOrder[] memory m = _match(OPEN_LONG, BTC, 10, 859_000, 500);
        m[0].leaderRef = bytes32("spoofed");
        vm.recordLogs();
        vm.prank(owner);
        account.matchNow(m);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MirrorAccount.Mirrored.selector) {
                (,,,,,, bytes32 ref,) = abi.decode(
                    logs[i].data,
                    (uint8, uint64, uint64, uint16, uint256, uint256, bytes32, MirrorAccount.CopyProof)
                );
                assertEq(ref, account.MATCH_NOW_REF());
            }
        }
    }

    /// Whatever the owner signs, match now never breaks the policy (same invariant as keeper copies).
    function testFuzz_matchNowOutcomeWithinPolicy(
        bool short,
        uint64 lots,
        int16 offsetBps,
        uint16 lev,
        uint32 leaderLots,
        uint16 fillBps,
        bool useEth
    ) public {
        uint256 perp = useEth ? ETH : BTC;
        lots = uint64(bound(lots, 1, 60));
        offsetBps = int16(bound(offsetBps, -150, 150));
        lev = uint16(bound(lev, 0, 2000));
        leaderLots = uint32(bound(leaderLots, 0, 6000));
        ex.setFillBps(bound(fillBps, 0, 10_000));
        ex.setPosition(perp, LEADER, short ? SHORT : LONG, leaderLots);
        (,, uint256 mark,,,,,) = ex.perps(perp);
        uint64 price = uint64(uint256(int256(mark) + int256(mark) * offsetBps / 10_000));

        uint8 t = short ? OPEN_SHORT : OPEN_LONG;
        vm.prank(owner);
        bool[] memory ok = account.follow(_defaultPolicy(), _match(t, perp, lots, price, lev));
        (uint8 side, uint256 after_) = _lots(perp);
        if (!ok[0] || after_ == 0) {
            if (!ok[0]) assertEq(after_, 0);
            return; // blocked, or an IOC that found nothing to fill
        }
        assertEq(side, short ? SHORT : LONG);
        assertLe(after_, account.targetLots(perp, LEADER, side));
        assertGe(lev, 100);
        assertLe(lev, account.maxLeverageHdths());
        (,,,, uint64 cap) = account.markets(perp);
        (uint8 lotDec, uint8 priceDec,,,,,,) = ex.perps(perp);
        assertLe(after_ * mark * 1e6 / 10 ** (uint256(lotDec) + priceDec), cap);
        if (!short) assertLe(uint256(price), mark * 10_050 / 10_000);
        else assertGe(uint256(price) * 10_000, mark * 9_950);
    }

    function test_gas_followWithMatchNow() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        MirrorAccount.MirrorOrder[] memory m = _match(OPEN_LONG, BTC, 10, 859_000, 500);
        vm.prank(owner);
        uint256 g = gasleft();
        account.follow(p, m);
        emit log_named_uint("gas: follow + match now (mock exchange)", g - gasleft());
    }
}
