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

        // 3. A compliant copy fills against Perpl's live BTC book (IOC, bounded by slippage).
        o.leverageHdths = 200;
        vm.prank(keeper);
        assertTrue(account.mirror(o));
        (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(BTC, acct);
        console.log("lots after open", pos.lotLNS, "deposit", pos.depositCNS);
        assertEq(pos.positionType, 0);
        assertLe(pos.lotLNS, 1);

        // 4. The keeper still cannot withdraw.
        vm.prank(keeper);
        vm.expectRevert(MirrorAccount.NotOwner.selector);
        account.withdraw(1e6);

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
}
