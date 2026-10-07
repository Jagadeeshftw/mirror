// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

import {MirrorBase} from "./utils/MirrorBase.sol";
import {MirrorAccount} from "../src/MirrorAccount.sol";
import {MirrorAccountFactory} from "../src/MirrorAccountFactory.sol";
import {IPerplExchange} from "../src/interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "../src/interfaces/IAuthorizedToken.sol";

/// Builder attribution (contract change 5): builder id and fee are fixed at deployment, only opening orders carry
/// them, the owner signs a maximum, and every reducing path is builder-blind.
contract BuilderFeeTest is MirrorBase {
    function setUp() public override {
        super.setUp();
        _setUpFunded();
        ausd.mint(address(ex), 10e6);
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

    function test_fixedAtDeployment() public view {
        assertEq(account.BUILDER_ID(), 26);
        assertEq(account.BUILDER_FEE_PER_100K(), 20);
        assertEq(account.maxBuilderFeePer100K(), 20);
    }

    function test_openingCopy_carriesBuilder26AtFixedFee_andProofRecordsIt() public {
        vm.recordLogs();
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        assertEq(ex.lastBuilderId(), 26);
        assertEq(ex.lastBuilderFeePer100K(), 20);
        MirrorAccount.CopyProof memory p = _lastProof(vm.getRecordedLogs());
        // 10 lots x 85,500.0 = 8.55 AUSD of opening notional x 0.02% = 0.00171 AUSD.
        assertEq(p.builderFeeCNS, 1710);
        assertEq(p.builderFeeCNS, ex.lastBuilderFeeCNS(), "proof equals what the exchange charged");
        assertEq(ex.builderFeesCNS(26), 1710);
    }

    function test_feeAboveSignedMaximum_isBlockedWithTheNumbers() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxBuilderFeePer100K = 10; // owner accepts at most 0.01%
        vm.prank(owner);
        account.setPolicy(p);
        vm.recordLogs();
        assertFalse(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != MirrorAccount.Blocked.selector) continue;
            (MirrorAccount.BlockReason r,,, uint256 limit, uint256 actual,,,) = abi.decode(
                logs[i].data, (MirrorAccount.BlockReason, uint8, uint64, uint256, uint256, bytes32, uint64, uint64)
            );
            assertEq(uint8(r), uint8(MirrorAccount.BlockReason.BuilderFeeTooHigh));
            assertEq(limit, 10);
            assertEq(actual, 20);
            seen = true;
        }
        assertTrue(seen);
        (, uint256 lots) = _lots(BTC);
        assertEq(lots, 0);
        assertEq(ex.builderFeesCNS(26), 0);
    }

    function test_matchNow_isRefusedTooWhenFeeAboveMaximum() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxBuilderFeePer100K = 0;
        MirrorAccount.MirrorOrder[] memory m = new MirrorAccount.MirrorOrder[](1);
        m[0] = _order(OPEN_LONG, BTC, 10, 859_000, 500);
        vm.prank(owner);
        bool[] memory ok = account.follow(p, m);
        assertFalse(ok[0]);
        assertEq(ex.builderFeesCNS(26), 0);
    }

    function test_reducingPaths_neverAttributed_andNeverBlockedByTheFeeRule() public {
        assertTrue(_mirror(_order(OPEN_LONG, BTC, 10, 859_000, 500)));
        assertTrue(_mirror(_order(OPEN_LONG, ETH, 5, 271_000, 500)));
        uint256 feesAfterOpens = ex.builderFeesCNS(26);
        // The owner now refuses all builder fees: every reducing path must still work, with no fee.
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxBuilderFeePer100K = 0;
        p.flattenOnStop = true;
        vm.prank(owner);
        account.setPolicy(p);

        // Keeper close down to the leader's target.
        ex.setPosition(BTC, LEADER, LONG, 500);
        assertTrue(_mirror(_order(CLOSE_LONG, BTC, 5, 851_000, 0)));
        // Take-profit executed by a stranger.
        MirrorAccount.Level[] memory ls = new MirrorAccount.Level[](1);
        ls[0] = MirrorAccount.Level({perpId: uint32(BTC), side: LONG, stopLossPNS: 0, takeProfitPNS: 850_000, slippageBps: 300});
        vm.prank(owner);
        account.setLevels(ls);
        vm.prank(stranger);
        account.triggerLevel(BTC);
        // Owner close-market and close-all.
        vm.prank(owner);
        account.closeMarket(uint32(ETH), 300);
        vm.prank(owner);
        account.closeAll(300);

        (, uint256 btc) = _lots(BTC);
        (, uint256 eth) = _lots(ETH);
        assertEq(btc + eth, 0);
        assertEq(ex.attributedCloses(), 0, "a reducing order carried builder attribution");
        assertEq(ex.builderFeesCNS(26), feesAfterOpens, "a reducing order paid a builder fee");
    }

    function test_keeperCannotChooseBuilderOrFee() public {
        // MirrorOrder has no builder field: whatever the keeper encodes, the exchange sees builder 26 at 20.
        MirrorAccount.MirrorOrder memory o = _order(OPEN_LONG, BTC, 3, 859_000, 500);
        o.leaderRef = bytes32(uint256(99));
        o.leaderFillPNS = type(uint64).max;
        o.maxMatches = type(uint16).max;
        assertTrue(_mirror(o));
        assertEq(ex.lastBuilderId(), 26);
        assertEq(ex.lastBuilderFeePer100K(), 20);
        // Raw calldata with extra trailing bytes changes nothing either.
        bytes memory call = abi.encodeCall(MirrorAccount.mirror, (_order(OPEN_LONG, BTC, 2, 859_000, 500)));
        vm.prank(keeper);
        (bool ok,) = address(account).call(abi.encodePacked(call, abi.encode(uint256(250), uint256(1000))));
        assertTrue(ok);
        assertEq(ex.lastBuilderId(), 26);
        assertEq(ex.lastBuilderFeePer100K(), 20);
    }

    function test_policyMaximumBounded() public {
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxBuilderFeePer100K = 1_001;
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, "maxBuilderFeePer100K"));
        vm.prank(owner);
        account.setPolicy(p);
    }

    function test_deploymentRejectsAFeeAbovePerplsCapOrAFeeWithoutABuilder() public {
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, "builderFee"));
        new MirrorAccountFactory(IPerplExchange(address(ex)), IAuthorizedToken(address(ausd)), registry, CAP, 26, 1_001);
        vm.expectRevert(abi.encodeWithSelector(MirrorAccount.InvalidPolicy.selector, "builderFee"));
        new MirrorAccountFactory(IPerplExchange(address(ex)), IAuthorizedToken(address(ausd)), registry, CAP, 0, 20);
    }

    function test_noBuilderDeployment_usesTheBuilderBlindPath() public {
        MirrorAccountFactory f0 =
            new MirrorAccountFactory(IPerplExchange(address(ex)), IAuthorizedToken(address(ausd)), registry, CAP, 0, 0);
        MirrorAccount a0 = f0.createAccount(owner, bytes32("nb"));
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(a0), 20e6, block.timestamp + 1 hours);
        a0.depositWithPermit(20e6, block.timestamp + 1 hours, v, r, s);
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxBuilderFeePer100K = 0;
        vm.prank(owner);
        a0.setPolicy(p);
        uint256 before = ex.v2Orders();
        vm.prank(keeper);
        assertTrue(a0.mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500)));
        assertEq(ex.v2Orders(), before, "builder-blind deployment used the V2 entrypoint");
    }

    /// Whatever the keeper sends and whatever maximum the owner signed: an executed opening copy was attributed to
    /// builder 26 at exactly 20 and only when 20 <= the maximum; a close was never attributed.
    function testFuzz_builderFeeOnlyOnOpens_andNeverAboveSignedMaximum(uint16 maxFee, uint8 t, uint64 lots, uint16 lev)
        public
    {
        maxFee = uint16(bound(maxFee, 0, 1_000));
        MirrorAccount.Policy memory p = _defaultPolicy();
        p.maxBuilderFeePer100K = maxFee;
        vm.prank(owner);
        account.setPolicy(p);
        if (t % 2 == 1) {
            // Seed a position so closes can execute.
            p.maxBuilderFeePer100K = 1_000;
            vm.prank(owner);
            account.setPolicy(p);
            _mirror(_order(OPEN_LONG, BTC, 5, 859_000, 500));
            p.maxBuilderFeePer100K = maxFee;
            vm.prank(owner);
            account.setPolicy(p);
            ex.setPosition(BTC, LEADER, LONG, 0);
        }
        uint256 feesBefore = ex.builderFeesCNS(26);
        uint8 orderType = t % 2 == 1 ? CLOSE_LONG : OPEN_LONG;
        lots = uint64(bound(lots, 1, 10));
        lev = uint16(bound(lev, 100, 500));
        (, uint256 have) = _lots(BTC);
        if (orderType == CLOSE_LONG && lots > have) lots = uint64(have);
        if (lots == 0) return;
        vm.prank(keeper);
        try account.mirror(_order(orderType, BTC, lots, orderType == OPEN_LONG ? 859_000 : 851_000, lev)) returns (bool done) {
            if (!done) {
                assertEq(ex.builderFeesCNS(26), feesBefore, "blocked copy paid a builder fee");
                return;
            }
            if (orderType == OPEN_LONG) {
                assertLe(uint256(20), uint256(maxFee), "attributed above the signed maximum");
                assertEq(ex.lastBuilderId(), 26);
                assertEq(ex.lastBuilderFeePer100K(), 20);
            } else {
                assertEq(ex.builderFeesCNS(26), feesBefore, "close paid a builder fee");
            }
        } catch {}
        assertEq(ex.attributedCloses(), 0);
    }
}
