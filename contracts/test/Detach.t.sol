// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";

/// "Stop following, keep my positions", enforced by the contract: once the owner detaches a leader, no copy from
/// that leader trades (opens, keeper reductions, match-now), while every owner stop and close keeps working.
contract DetachTest is MirrorBase {
    address internal anyone = makeAddr("anyone");

    function setUp() public override {
        super.setUp();
        _fund(20e6);
        ausd.mint(address(ex), 10e6);
        vm.prank(owner);
        account.setPolicy(_twoLeaders(0));
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 5, 271_000, 500)));
    }

    function _twoLeaders(uint16 lossStopBps) internal view returns (MirrorAccount.Policy memory p) {
        p = _defaultPolicy();
        p.flattenOnStop = true;
        p.stopSlippageBps = 300;
        p.leaders = new MirrorAccount.LeaderRule[](2);
        p.leaders[0] = MirrorAccount.LeaderRule({accountId: LEADER, ratioBps: 100, budgetCNS: 20e6, lossStopBps: lossStopBps});
        p.leaders[1] = MirrorAccount.LeaderRule({accountId: LEADER2, ratioBps: 100, budgetCNS: 20e6, lossStopBps: 0});
    }

    function _detach(uint32 leader, bool on) internal {
        vm.prank(owner);
        account.setLeaderDetached(leader, on);
    }

    function test_refusesOpensAndKeeperReductions() public {
        _detach(LEADER, true);
        assertTrue(account.leaderDetached(LEADER));
        _expectBlocked(_order(OPEN_LONG, BTC, 1, 859_000, 500), MirrorAccount.BlockReason.LeaderDetached);
        // The leader exits; the keeper's mirrored reduction is refused and the position is kept.
        ex.setPosition(BTC, LEADER, LONG, 0);
        _expectBlocked(_order(CLOSE_LONG, BTC, 10, 851_000, 0), MirrorAccount.BlockReason.LeaderDetached);
        (, uint256 btc) = _lots(BTC);
        assertEq(btc, 10);
        assertEq(account.marketLeader(BTC), LEADER, "position still attributed to the leader");
    }

    function test_refusedEvenWhenTheCloseWouldOtherwiseRevert() public {
        // A detached leader's copy is recorded as Blocked before any other check, so a malformed close is not a
        // way to tell detached leaders apart from attached ones by revert.
        _detach(LEADER, true);
        _expectBlocked(_order(CLOSE_SHORT, BTC, 1, 851_000, 0), MirrorAccount.BlockReason.LeaderDetached);
    }

    function test_onlyThatLeader() public {
        _detach(LEADER, true);
        ex.setPosition(SOL, LEADER2, LONG, 1000);
        MirrorAccount.Policy memory p = _twoLeaders(0);
        p.markets = new MirrorAccount.MarketRule[](3);
        p.markets[0] = MirrorAccount.MarketRule({perpId: uint32(BTC), maxNotionalCNS: 15e6});
        p.markets[1] = MirrorAccount.MarketRule({perpId: uint32(ETH), maxNotionalCNS: 15e6});
        p.markets[2] = MirrorAccount.MarketRule({perpId: uint32(SOL), maxNotionalCNS: 15e6});
        vm.prank(owner);
        account.setPolicy(p);
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, SOL, 5, 120_500, 500);
        o.leaderAccountId = LEADER2;
        assertTrue(_mirror(o));
    }

    function test_refusesMatchNow() public {
        _detach(LEADER, true);
        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](1);
        m[0] = _order(OPEN_LONG, BTC, 1, 859_000, 500);
        vm.prank(owner);
        bool[] memory ex_ = account.matchNow(m);
        assertFalse(ex_[0]);
    }

    function test_ownerStopsAndClosesStillWork() public {
        _detach(LEADER, true);
        // Take-profit by anyone.
        MirrorAccount.Level[] memory ls = new MirrorAccount.Level[](1);
        ls[0] = MirrorAccount.Level({perpId: uint32(ETH), side: LONG, stopLossPNS: 0, takeProfitPNS: 280_000, slippageBps: 300});
        vm.prank(owner);
        account.setLevels(ls);
        ex.setMark(ETH, 281_000);
        vm.prank(anyone);
        assertGt(account.triggerLevel(ETH), 0);
        (, uint256 eth) = _lots(ETH);
        assertEq(eth, 0);
        // closeMarket by the owner.
        vm.prank(owner);
        account.closeMarket(uint32(BTC), 300);
        (, uint256 btc) = _lots(BTC);
        assertEq(btc, 0);
        assertEq(ausd.balanceOf(anyone), 0);
    }

    function test_leaderLossStopStillWorks() public {
        vm.prank(owner);
        account.setPolicy(_twoLeaders(500)); // -1.0 AUSD on a 20 budget
        _detach(LEADER, true);
        ex.setMark(BTC, 700_000);
        vm.prank(anyone);
        assertEq(account.triggerLeaderStop(LEADER), 2);
        (, uint256 btc) = _lots(BTC);
        assertEq(btc, 0);
    }

    function test_accountStopAndCloseAllStillWork() public {
        // setUp's copies recorded today's baseline equity (20 AUSD).
        MirrorAccount.Policy memory p = _twoLeaders(0);
        p.dailyLossBps = 500;
        vm.prank(owner);
        account.setPolicy(p);
        _detach(LEADER, true);
        ex.setMark(BTC, 700_000); // -1.55 AUSD on 10 lots: below 95% of 20
        vm.prank(anyone);
        assertEq(account.triggerAccountStop(), 2);
        (, uint256 btc) = _lots(BTC);
        (, uint256 eth) = _lots(ETH);
        assertEq(btc + eth, 0);
        assertEq(ausd.balanceOf(anyone), 0);
    }

    function test_closeAllStillWorks() public {
        _detach(LEADER, true);
        vm.prank(owner);
        account.closeAll(300);
        (, uint256 btc) = _lots(BTC);
        (, uint256 eth) = _lots(ETH);
        assertEq(btc + eth, 0);
    }

    function test_setPolicyKeepsDetachFollowClearsIt() public {
        _detach(LEADER, true);
        MirrorAccount.Policy memory p = _twoLeaders(0);
        p.maxLeverageHdths = 300;
        vm.prank(owner);
        account.setPolicy(p);
        assertTrue(account.leaderDetached(LEADER), "editing the policy does not re-attach");
        vm.prank(owner);
        account.follow(_twoLeaders(0), new MirrorAccount.MirrorOrder[](0));
        assertFalse(account.leaderDetached(LEADER));
        ex.setPosition(BTC, LEADER, LONG, 500);
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 5, 851_000, 0)), "copies resume");
    }

    function test_removingTheLeaderClearsIt() public {
        _detach(LEADER2, true);
        vm.prank(owner);
        account.setPolicy(_defaultPolicy()); // LEADER only
        assertFalse(account.leaderDetached(LEADER2));
    }

    function test_onlyOwnerOrSignedAndOnlyFollowedLeaders() public {
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        vm.prank(keeper);
        account.setLeaderDetached(LEADER, true);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, "leader"));
        vm.prank(owner);
        account.setLeaderDetached(999, true);
        MirrorAccount.Action memory a = _action(account.ACTION_SET_LEADER_DETACHED(), abi.encode(LEADER, true));
        vm.prank(relayer);
        account.execute(a, _signAction(a, ownerKey));
        assertTrue(account.leaderDetached(LEADER));
        // A keeper's own signature is not the owner's.
        (, uint256 keeperKey) = makeAddrAndKey("keeper-key");
        a = _action(account.ACTION_SET_LEADER_DETACHED(), abi.encode(LEADER, false));
        bytes memory bad = _signAction(a, keeperKey);
        vm.expectRevert(MirrorAccount.BadSignature.selector);
        account.execute(a, bad);
        assertTrue(account.leaderDetached(LEADER));
    }
}
