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
                assertLe(lotsAfter, account.targetLots(perp, want), "above leader target");
                (,,, uint64 cap) = account.markets(perp);
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
        (uint8 lotDec, uint8 priceDec, uint256 mark, bool valid, string memory sym) = ex.perps(perp);
        return (0, lotDec, priceDec, mark, valid, sym);
    }

    function _notionalOf(uint256 perp, uint256 lots, uint256 mark) internal view returns (uint256) {
        (, uint8 lotDec, uint8 priceDec,,,) = _perp(perp);
        return lots * mark * 1e6 / 10 ** (uint256(lotDec) + priceDec);
    }
}
