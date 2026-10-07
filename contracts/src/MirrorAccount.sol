// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPerplExchange} from "./interfaces/IPerplExchange.sol";
import {IAuthorizedToken} from "./interfaces/IAuthorizedToken.sol";
import {KeeperRegistry} from "./KeeperRegistry.sol";

/// @title MirrorAccount
/// @notice One follower's copy-trading account. It owns its own Perpl Exchange account and lets registered
///         keepers mirror up to four leaders' trades into it, subject to the follower's policy, which is
///         checked onchain on every copied order.
/// @dev Security model:
///      - Only the owner (the follower's passkey-derived EOA) can withdraw, change policy or levels, pause,
///        close, or make arbitrary Exchange calls. Every owner action can also be relayed with an EIP-712
///        signature, so the follower never needs MON for gas.
///      - Keepers can only call {mirror}. A mirrored order is an immediate-or-cancel Perpl order built by this
///        contract; keepers cannot set the collateral amount, cannot post resting orders, and no code path
///        lets a keeper move collateral out of the account.
///      - Anyone may call the stop triggers, but only when the stop's condition is true onchain, and they
///        can only send reduce-only closing orders bounded by the owner's slippage setting.
///      - Collateral only ever leaves the contract to the owner ({withdraw}, {sweep}) or into this account's
///        own Perpl account. There is no admin, upgrade, or fee path. Clones are non-upgradeable EIP-1167.
///      - Pre-execution policy checks emit {Blocked} and return without trading, so a rule hit is provable
///        onchain. Post-execution checks revert as defence in depth.
///
///      Several leaders share one Perpl account, and Perpl nets each market into one position. So that every
///      position, budget and loss stop is attributable to exactly one leader, a market belongs to the leader
///      whose copy opened it until the position is flat again; another leader's copy into it is blocked.
contract MirrorAccount is Initializable, ReentrancyGuardTransient, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------

    uint8 internal constant OPEN_LONG = 0;
    uint8 internal constant OPEN_SHORT = 1;
    uint8 internal constant CLOSE_LONG = 2;
    uint8 internal constant CLOSE_SHORT = 3;

    uint8 internal constant LONG = 0;
    uint8 internal constant SHORT = 1;

    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_LEADERS = 4;
    uint256 public constant MAX_MARKETS = 16;
    /// Follower size can be at most the leader's size (ratio of 100%).
    uint256 public constant MAX_RATIO_BPS = 10_000;
    /// 1x .. 100x, in hundredths.
    uint256 public constant MIN_LEVERAGE_HDTHS = 100;
    uint256 public constant MAX_LEVERAGE_HDTHS = 10_000;
    uint256 public constant MAX_SLIPPAGE_BPS = 1_000;
    uint256 public constant MAX_CLOSE_ALL_SLIPPAGE_BPS = 2_000;
    uint256 public constant MAX_ENTRY_DEVIATION_BPS = 5_000;
    uint256 public constant MAX_MATCHES = 1_000;
    /// Stop triggers refuse to act when Perpl's mark and a fresh Chainlink price disagree by more than this.
    uint256 public constant MAX_MARK_ORACLE_GAP_BPS = 200;
    /// Perpl's decoder rejects builder fees above 1% (1,000 per 100,000).
    uint256 public constant MAX_BUILDER_FEE_PER_100K = 1_000;
    uint256 internal constant FEE_DENOMINATOR = 100_000;
    uint16 internal constant ORDER_EXTENSION_VERSION = 1;
    /// Perpl's default cap on negative-PnL collateralisation drawn on a fill.
    uint256 internal constant MAX_NEG_PNL_COLLAT_BPS = 1_000;

    // Signed owner actions.
    uint8 public constant ACTION_SET_POLICY = 1;
    uint8 public constant ACTION_SET_PAUSED = 2;
    uint8 public constant ACTION_CLOSE_ALL = 3;
    uint8 public constant ACTION_WITHDRAW = 4;
    uint8 public constant ACTION_EXCHANGE_CALL = 5;
    uint8 public constant ACTION_SWEEP = 6;
    uint8 public constant ACTION_FOLLOW = 7;
    uint8 public constant ACTION_MATCH_NOW = 8;
    uint8 public constant ACTION_SET_LEVELS = 9;
    uint8 public constant ACTION_CLOSE_MARKET = 10;

    /// leaderRef recorded on orders the owner places with match-now, so indexers can tell them apart.
    bytes32 public constant MATCH_NOW_REF = keccak256("MIRROR_MATCH_NOW");
    uint256 public constant MAX_MATCH_ORDERS = 16;

    bytes32 public constant ACTION_TYPEHASH =
        keccak256("Action(uint8 kind,bytes data,uint256 nonce,uint256 deadline)");
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    struct LeaderRule {
        /// Perpl account id of the leader being followed.
        uint32 accountId;
        /// Follower size as a fraction of the leader's size, in basis points.
        uint32 ratioBps;
        /// Most collateral this leader's positions may hold as margin, in collateral units (6 decimals).
        uint64 budgetCNS;
        /// Stop copying this leader once its PnL since it was added falls below -lossStopBps x budget (0 = off).
        uint16 lossStopBps;
    }

    struct MarketRule {
        uint32 perpId;
        /// Maximum position notional in this market at mark price, in collateral units (6 decimals).
        uint64 maxNotionalCNS;
    }

    struct Policy {
        uint16 maxLeverageHdths;
        uint16 maxSlippageBps;
        /// Stop increasing exposure once equity falls this far below the day's starting equity (0 = off).
        uint16 dailyLossBps;
        /// Stop increasing exposure once equity falls this far below its high-water mark (0 = off).
        uint16 drawdownBps;
        /// After this timestamp the account only reduces exposure.
        uint40 expiry;
        /// Refuse an opening copy whose limit, or the current mark, is further than this from the leader's
        /// onchain average entry price, on the worse side (0 = off).
        uint16 maxEntryDeviationBps;
        /// Slippage bound (from mark) for closes sent by a triggered stop.
        uint16 stopSlippageBps;
        /// When true, anyone may close positions once an account or leader loss stop is hit.
        bool flattenOnStop;
        /// Highest builder fee, per 100,000 of opening notional, the owner accepts. An opening copy is refused when
        /// the account's fixed builder fee is above it.
        uint16 maxBuilderFeePer100K;
        LeaderRule[] leaders;
        MarketRule[] markets;
    }

    struct Market {
        bool allowed;
        /// Set when an owner level fires in this market; opening copies stay blocked until the next policy.
        bool halted;
        uint8 lotDecimals;
        uint8 priceDecimals;
        uint64 maxNotionalCNS;
    }

    /// Owner-signed stop-loss / take-profit on the position held in one market.
    struct Level {
        uint32 perpId;
        /// Side of the position the level protects: 0 Long, 1 Short.
        uint8 side;
        /// Close when the price reaches this level against the position (0 = none).
        uint64 stopLossPNS;
        /// Close when the price reaches this level in favour of the position (0 = none).
        uint64 takeProfitPNS;
        /// Slippage bound (from mark) for the closing order.
        uint16 slippageBps;
    }

    struct MirrorOrder {
        /// Leader whose fill this order copies.
        uint32 leaderAccountId;
        uint32 perpId;
        /// 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort.
        uint8 orderType;
        uint64 lotLNS;
        /// Limit price; bounds slippage. Must sit within maxSlippageBps of mark.
        uint64 pricePNS;
        /// Leverage for opening orders, in hundredths. Ignored for closes.
        uint16 leverageHdths;
        uint16 maxMatches;
        /// Reference to the leader fill (the leader's transaction hash), emitted for attribution and latency.
        bytes32 leaderRef;
        /// The leader's fill price as reported by the keeper (0 if unknown). Recorded for statistics only and
        /// verifiable against Perpl's fill events in `leaderRef`; no rule trusts it.
        uint64 leaderFillPNS;
    }

    struct Action {
        uint8 kind;
        bytes data;
        uint256 nonce;
        uint256 deadline;
    }

    /// Appended only: existing indexes are relied on by the app and indexer.
    enum BlockReason {
        None,
        Paused,
        Expired,
        LeaderNotAllowed,
        LeaderSideMismatch,
        MarketNotAllowed,
        LeverageTooHigh,
        SlippageTooHigh,
        FlipNotAllowed,
        StaleMark,
        ExceedsLeaderTarget,
        ExceedsMaxNotional,
        DailyLossStop,
        DrawdownStop,
        LeverageTooLow,
        EntryTooFar,
        MarketHeldByOtherLeader,
        LeaderBudgetExceeded,
        LeaderLossStop,
        MarketHalted,
        CloseBelowTarget,
        BuilderFeeTooHigh
    }

    enum StopKind {
        DailyLoss,
        Drawdown,
        LeaderLoss,
        StopLoss,
        TakeProfit
    }

    /// Everything a copy-quality statistic needs, emitted with each {Mirrored}.
    struct CopyProof {
        /// Leader fill price reported by the keeper (0 if unknown).
        uint64 leaderFillPNS;
        /// Leader's onchain average entry price on the copied side at copy time (0 for closes).
        uint64 leaderEntryPNS;
        /// Perpl mark price at copy time.
        uint64 markPNS;
        /// This account's average fill price for an opening order, derived from its position before and
        /// after (0 if nothing filled, and for closes, where Perpl's fill events carry the price).
        uint64 fillPNS;
        /// fillPNS against leaderEntryPNS in basis points, positive when the follower paid worse.
        int32 entryDeviationBps;
        /// Builder fee Perpl charged on this copy: added lots x fill price x rate, rounded up as Perpl does (0 for
        /// closes, which never carry attribution). Perpl's TakerOrderFilledV2 has the exact figure.
        uint64 builderFeeCNS;
    }

    // ---------------------------------------------------------------------------------------------
    // Immutables (shared by all clones through the implementation's code)
    // ---------------------------------------------------------------------------------------------

    IPerplExchange public immutable EXCHANGE;
    IAuthorizedToken public immutable COLLATERAL;
    KeeperRegistry public immutable KEEPERS;
    address public immutable FACTORY;
    /// Maximum net deposits per account, in collateral units. The code is unaudited.
    uint256 public immutable DEPOSIT_CAP;
    uint8 internal immutable COLLATERAL_DECIMALS;
    /// Perpl builder id every opening order is attributed to (0 = none). Fixed at deployment: neither the keeper
    /// nor the owner can change where builder fees go.
    uint8 public immutable BUILDER_ID;
    /// Builder fee per 100,000 of the notional an opening order adds. Fixed at deployment.
    uint16 public immutable BUILDER_FEE_PER_100K;

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    address public owner;
    uint32 public perplAccountId;
    bool public paused;
    uint64 public orderNonce;

    uint256 public actionNonce;
    uint256 public netDeposits;

    uint32 public riskDay;
    uint128 public dayStartEquity;
    uint128 public highWaterEquity;

    uint16 public maxLeverageHdths;
    uint16 public maxSlippageBps;
    uint16 public dailyLossBps;
    uint16 public drawdownBps;
    uint40 public expiry;
    uint16 public maxEntryDeviationBps;
    uint16 public stopSlippageBps;
    bool public flattenOnStop;
    uint16 public maxBuilderFeePer100K;

    LeaderRule[] internal _leaders;
    uint32[] internal _marketIds;
    mapping(uint256 perpId => Market) public markets;

    /// Leader whose copy opened the position currently held in a market (meaningful only while it is open).
    mapping(uint256 perpId => uint32 leaderAccountId) public marketLeader;
    /// Realised PnL net of fees of each leader's copies since that leader was last added or re-armed.
    mapping(uint32 leaderAccountId => int256) public leaderRealizedCNS;
    /// Set when a leader's loss stop is hit; cleared when the owner sets a policy again.
    mapping(uint32 leaderAccountId => bool) public leaderStopped;
    mapping(uint256 perpId => Level) internal _levels;
    /// Permits accepted after a front-runner had already submitted them (each is honoured once).
    mapping(bytes32 permitDigest => bool) public frontRunPermitUsed;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Initialized(address indexed owner);
    event PerplAccountCreated(uint256 indexed perplAccountId);
    event PolicyUpdated(
        uint16 maxLeverageHdths,
        uint16 maxSlippageBps,
        uint16 dailyLossBps,
        uint16 drawdownBps,
        uint40 expiry,
        uint16 maxEntryDeviationBps,
        uint16 stopSlippageBps,
        bool flattenOnStop,
        uint16 maxBuilderFeePer100K,
        LeaderRule[] leaders,
        MarketRule[] markets
    );
    event PausedSet(bool paused);
    event Deposited(address indexed from, uint256 amount, uint256 netDeposits);
    event Withdrawn(address indexed to, uint256 amount, uint256 netDeposits);
    event Mirrored(
        address indexed keeper,
        uint32 indexed leaderAccountId,
        uint32 indexed perpId,
        uint8 orderType,
        uint64 lotLNS,
        uint64 pricePNS,
        uint16 leverageHdths,
        uint256 lotsBefore,
        uint256 lotsAfter,
        bytes32 leaderRef,
        CopyProof proof
    );
    event Blocked(
        address indexed keeper,
        uint32 indexed leaderAccountId,
        uint32 indexed perpId,
        BlockReason reason,
        uint8 orderType,
        uint64 lotLNS,
        uint256 limit,
        uint256 actual,
        bytes32 leaderRef,
        uint64 leaderFillPNS,
        uint64 markPNS
    );
    event ClosedAll(uint16 slippageBps, uint256 positionsClosed);
    event MarketClosed(uint32 indexed perpId, uint16 slippageBps, uint256 lotsBefore, uint256 lotsAfter);
    event LevelSet(uint32 indexed perpId, uint8 side, uint64 stopLossPNS, uint64 takeProfitPNS, uint16 slippageBps);
    event StopTriggered(
        address indexed caller,
        StopKind indexed kind,
        uint32 indexed scope,
        uint256 limit,
        uint256 actual,
        uint256 oraclePNS,
        uint256 positionsClosed
    );
    event LeaderStopped(uint32 indexed leaderAccountId, int256 pnlCNS, uint256 limitCNS);
    event ExchangeCalled(bytes data, bytes result);
    event Swept(address indexed token, uint256 amount);
    event ActionExecuted(uint8 indexed kind, uint256 nonce);
    event Followed(uint256 matchOrders, uint256 matchesExecuted);
    event RiskUpdated(uint32 day, uint128 dayStartEquity, uint128 highWaterEquity, uint256 equity);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error NotFactory();
    error NotOwner();
    error NotKeeper();
    error ZeroAddress();
    error NoPerplAccount();
    error InvalidOrderType();
    error ZeroLots();
    error NothingToClose();
    error CloseExceedsPosition();
    error PostTradeViolation(BlockReason reason, uint256 limit, uint256 actual);
    error InvalidPolicy(string field);
    error InvalidLevel(string field);
    error DepositCapExceeded(uint256 cap, uint256 wouldBe);
    error BelowMinimumAccountOpen(uint256 minimum, uint256 amount);
    error ActionExpired();
    error BadNonce();
    error BadSignature();
    error UnknownAction(uint8 kind);
    error ExchangeCallFailed(bytes result);
    error MatchNowOpensOnly();
    error TooManyMatchOrders();
    error StopNotTriggered();
    error FlattenOff();
    error UntrustedPrice(uint256 perpId, uint256 markPNS, uint256 oraclePNS);

    // ---------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------

    constructor(
        IPerplExchange exchange,
        IAuthorizedToken collateral,
        KeeperRegistry keepers,
        address factory,
        uint256 depositCap,
        uint8 builderId,
        uint16 builderFeePer100K
    ) EIP712("Mirror Account", "1") {
        if (
            address(exchange) == address(0) || address(collateral) == address(0) || address(keepers) == address(0)
                || factory == address(0)
        ) revert ZeroAddress();
        if (builderFeePer100K > MAX_BUILDER_FEE_PER_100K || (builderId == 0 && builderFeePer100K != 0)) {
            revert InvalidPolicy("builderFee");
        }
        BUILDER_ID = builderId;
        BUILDER_FEE_PER_100K = builderFeePer100K;
        EXCHANGE = exchange;
        COLLATERAL = collateral;
        KEEPERS = keepers;
        FACTORY = factory;
        DEPOSIT_CAP = depositCap;
        COLLATERAL_DECIMALS = collateral.decimals();
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        if (msg.sender != FACTORY) revert NotFactory();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit Initialized(owner_);
    }

    // ---------------------------------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyKeeper() {
        if (!KEEPERS.isKeeper(msg.sender)) revert NotKeeper();
        _;
    }

    // =============================================================================================
    // Keeper path
    // =============================================================================================

    /// @notice Copy one leader fill into this account.
    /// @return executed True when the order was sent to Perpl; false when a policy rule blocked it (a
    ///         {Blocked} event records which rule and the numbers).
    function mirror(MirrorOrder calldata o) external nonReentrant onlyKeeper returns (bool executed) {
        return _copy(o, msg.sender);
    }

    /// @dev The single copy path shared by keeper copies and owner match-now orders. Every rule is checked
    ///      the same way regardless of who submits the order.
    function _copy(MirrorOrder memory o, address actor) internal returns (bool) {
        uint256 acct = perplAccountId;
        if (acct == 0) revert NoPerplAccount();
        if (o.orderType > CLOSE_SHORT) revert InvalidOrderType();
        if (o.lotLNS == 0) revert ZeroLots();

        (IPerplExchange.PositionInfoV2 memory before, uint256 mark, bool markValid) =
            EXCHANGE.getPositionV2(o.perpId, acct);
        bool opening = o.orderType == OPEN_LONG || o.orderType == OPEN_SHORT;

        BlockReason reason;
        uint256 limit;
        uint256 actual;
        uint256 leaderEntry;
        if (opening) {
            (reason, limit, actual, leaderEntry) = _checkOpen(o, before, mark, markValid);
        } else {
            (reason, limit, actual) = _checkClose(o, before, mark, markValid);
        }
        if (reason != BlockReason.None) {
            emit Blocked(
                actor,
                o.leaderAccountId,
                o.perpId,
                reason,
                o.orderType,
                o.lotLNS,
                limit,
                actual,
                o.leaderRef,
                o.leaderFillPNS,
                uint64(mark)
            );
            return false;
        }

        _execTracked(
            o.perpId, o.orderType, o.lotLNS, o.pricePNS, opening ? o.leverageHdths : 0, o.maxMatches, o.leaderAccountId
        );

        (IPerplExchange.PositionInfoV2 memory aft,,) = EXCHANGE.getPositionV2(o.perpId, acct);
        // Side of the position this order opens or closes.
        uint8 orderSide = (o.orderType == OPEN_LONG || o.orderType == CLOSE_LONG) ? LONG : SHORT;
        if (opening) {
            if (aft.lotLNS != 0 && aft.positionType != orderSide) {
                revert PostTradeViolation(BlockReason.FlipNotAllowed, 0, aft.lotLNS);
            }
            uint256 target = _targetLots(o.perpId, o.leaderAccountId, orderSide);
            if (aft.lotLNS > target) revert PostTradeViolation(BlockReason.ExceedsLeaderTarget, target, aft.lotLNS);
            uint256 notional = _notional(o.perpId, aft.lotLNS, mark);
            uint256 cap = markets[o.perpId].maxNotionalCNS;
            if (notional > cap) revert PostTradeViolation(BlockReason.ExceedsMaxNotional, cap, notional);
            if (aft.lotLNS > before.lotLNS) marketLeader[o.perpId] = o.leaderAccountId;
        } else {
            if (aft.lotLNS > before.lotLNS || (aft.lotLNS != 0 && aft.positionType != before.positionType)) {
                revert PostTradeViolation(BlockReason.FlipNotAllowed, before.lotLNS, aft.lotLNS);
            }
            if (aft.lotLNS == 0) delete marketLeader[o.perpId];
        }

        emit Mirrored(
            actor,
            o.leaderAccountId,
            o.perpId,
            o.orderType,
            o.lotLNS,
            o.pricePNS,
            opening ? o.leverageHdths : 0,
            before.lotLNS,
            aft.lotLNS,
            o.leaderRef,
            _proof(o, before, aft, mark, leaderEntry, orderSide, opening)
        );
        return true;
    }

    function _proof(
        MirrorOrder memory o,
        IPerplExchange.PositionInfoV2 memory before,
        IPerplExchange.PositionInfoV2 memory aft,
        uint256 mark,
        uint256 leaderEntry,
        uint8 side,
        bool opening
    ) internal view returns (CopyProof memory p) {
        p.leaderFillPNS = o.leaderFillPNS;
        p.leaderEntryPNS = uint64(leaderEntry);
        p.markPNS = uint64(mark);
        if (!opening || aft.lotLNS <= before.lotLNS) return p;
        // Perpl keeps a position's average entry price; the added lots' average fill follows from it.
        uint256 added = aft.lotLNS - before.lotLNS;
        uint256 valueAfter = aft.pricePNS * aft.lotLNS;
        uint256 valueBefore = before.lotLNS == 0 ? 0 : before.pricePNS * before.lotLNS;
        if (valueAfter < valueBefore) return p;
        uint256 fill = (valueAfter - valueBefore) / added;
        p.fillPNS = uint64(fill);
        p.builderFeeCNS = uint64(_builderFee(o.perpId, added, fill));
        if (leaderEntry != 0) {
            int256 diff = int256(fill) - int256(leaderEntry);
            if (side == SHORT) diff = -diff;
            p.entryDeviationBps = int32(diff * int256(BPS) / int256(leaderEntry));
        }
    }

    /// @dev Every rule an opening (exposure-increasing) order must satisfy before it is sent.
    function _checkOpen(
        MirrorOrder memory o,
        IPerplExchange.PositionInfoV2 memory pos,
        uint256 mark,
        bool markValid
    ) internal returns (BlockReason, uint256, uint256, uint256 leaderEntry) {
        uint8 orderSide = o.orderType == OPEN_LONG ? LONG : SHORT;

        if (paused) return (BlockReason.Paused, 0, 0, 0);
        if (block.timestamp > expiry) return (BlockReason.Expired, expiry, block.timestamp, 0);

        Market memory m = markets[o.perpId];
        if (!m.allowed) return (BlockReason.MarketNotAllowed, 0, o.perpId, 0);
        if (m.halted) return (BlockReason.MarketHalted, 0, o.perpId, 0);

        (bool leaderAllowed, LeaderRule memory rule) = _leaderRule(o.leaderAccountId);
        if (!leaderAllowed) return (BlockReason.LeaderNotAllowed, 0, o.leaderAccountId, 0);
        if (leaderStopped[o.leaderAccountId]) return (BlockReason.LeaderLossStop, 0, 0, 0);

        if (BUILDER_FEE_PER_100K > maxBuilderFeePer100K) {
            return (BlockReason.BuilderFeeTooHigh, maxBuilderFeePer100K, BUILDER_FEE_PER_100K, 0);
        }
        if (o.leverageHdths < MIN_LEVERAGE_HDTHS) {
            return (BlockReason.LeverageTooLow, MIN_LEVERAGE_HDTHS, o.leverageHdths, 0);
        }
        if (o.leverageHdths > maxLeverageHdths) {
            return (BlockReason.LeverageTooHigh, maxLeverageHdths, o.leverageHdths, 0);
        }
        if (pos.lotLNS != 0 && pos.positionType != orderSide) return (BlockReason.FlipNotAllowed, 0, pos.lotLNS, 0);
        if (pos.lotLNS != 0 && marketLeader[o.perpId] != o.leaderAccountId) {
            return (BlockReason.MarketHeldByOtherLeader, o.leaderAccountId, marketLeader[o.perpId], 0);
        }
        if (!markValid) return (BlockReason.StaleMark, 0, 0, 0);

        (bool priceOk, uint256 bound) = _priceWithinSlippage(o.orderType, o.pricePNS, mark, maxSlippageBps);
        if (!priceOk) return (BlockReason.SlippageTooHigh, bound, o.pricePNS, 0);

        // The named leader must currently hold a position on the side being copied.
        (IPerplExchange.PositionInfoV2 memory lp,,) = EXCHANGE.getPositionV2(o.perpId, o.leaderAccountId);
        if (lp.lotLNS == 0 || lp.positionType != orderSide) {
            return (
                BlockReason.LeaderSideMismatch,
                orderSide,
                lp.lotLNS == 0 ? type(uint256).max : lp.positionType,
                0
            );
        }
        leaderEntry = lp.pricePNS;

        // Entry guard: neither the order's limit nor the current mark may be worse than the leader's entry
        // by more than the follower's bound.
        uint256 dev = maxEntryDeviationBps;
        if (dev != 0) {
            bool long_ = orderSide == LONG;
            uint256 eb = long_
                ? Math.mulDiv(leaderEntry, BPS + dev, BPS)
                : Math.mulDiv(leaderEntry, BPS - dev, BPS, Math.Rounding.Ceil);
            if (long_ ? o.pricePNS > eb : o.pricePNS < eb) {
                return (BlockReason.EntryTooFar, eb, o.pricePNS, leaderEntry);
            }
            if (long_ ? mark > eb : mark < eb) return (BlockReason.EntryTooFar, eb, mark, leaderEntry);
        }

        uint256 target = Math.mulDiv(lp.lotLNS, rule.ratioBps, BPS, Math.Rounding.Ceil);
        uint256 wouldBe = pos.lotLNS + o.lotLNS;
        if (wouldBe > target) return (BlockReason.ExceedsLeaderTarget, target, wouldBe, leaderEntry);

        uint256 notional = _notional(o.perpId, wouldBe, mark);
        if (notional > m.maxNotionalCNS) {
            return (BlockReason.ExceedsMaxNotional, m.maxNotionalCNS, notional, leaderEntry);
        }

        // Leader budget (margin held for this leader) and the leader's own loss stop.
        (uint256 margin, int256 unrealized) = _leaderExposure(o.leaderAccountId);
        uint256 px = Math.max(o.pricePNS, mark);
        uint256 addMargin =
            Math.mulDiv(_notional(o.perpId, o.lotLNS, px), 100, o.leverageHdths, Math.Rounding.Ceil);
        if (margin + addMargin > rule.budgetCNS) {
            return (BlockReason.LeaderBudgetExceeded, rule.budgetCNS, margin + addMargin, leaderEntry);
        }
        if (rule.lossStopBps != 0) {
            int256 pnl = leaderRealizedCNS[o.leaderAccountId] + unrealized;
            uint256 lossLimit = Math.mulDiv(rule.budgetCNS, rule.lossStopBps, BPS);
            if (pnl < -int256(lossLimit)) {
                leaderStopped[o.leaderAccountId] = true;
                emit LeaderStopped(o.leaderAccountId, pnl, lossLimit);
                return (BlockReason.LeaderLossStop, lossLimit, pnl < 0 ? uint256(-pnl) : 0, leaderEntry);
            }
        }

        (BlockReason r, uint256 l, uint256 a) = _checkLossStops();
        return (r, l, a, leaderEntry);
    }

    /// @dev A keeper close must reduce the position held for the leader it names, and may only bring it down
    ///      toward ratio x that leader's current position, never below it.
    function _checkClose(
        MirrorOrder memory o,
        IPerplExchange.PositionInfoV2 memory pos,
        uint256 mark,
        bool markValid
    ) internal view returns (BlockReason, uint256, uint256) {
        uint8 closingSide = o.orderType == CLOSE_LONG ? LONG : SHORT;
        if (pos.lotLNS == 0 || pos.positionType != closingSide) revert NothingToClose();
        if (o.lotLNS > pos.lotLNS) revert CloseExceedsPosition();
        (bool allowed,) = _leaderRule(o.leaderAccountId);
        if (!allowed) return (BlockReason.LeaderNotAllowed, 0, o.leaderAccountId);
        if (marketLeader[o.perpId] != o.leaderAccountId) {
            return (BlockReason.MarketHeldByOtherLeader, o.leaderAccountId, marketLeader[o.perpId]);
        }
        uint256 target = _targetLots(o.perpId, o.leaderAccountId, closingSide);
        uint256 after_ = pos.lotLNS - o.lotLNS;
        if (after_ < target) return (BlockReason.CloseBelowTarget, target, after_);
        if (!markValid) return (BlockReason.StaleMark, 0, 0);
        (bool ok, uint256 bound) = _priceWithinSlippage(o.orderType, o.pricePNS, mark, maxSlippageBps);
        if (!ok) return (BlockReason.SlippageTooHigh, bound, o.pricePNS);
        return (BlockReason.None, 0, 0);
    }

    /// @dev Updates the day's starting equity and the high-water mark, then applies both stops.
    function _checkLossStops() internal returns (BlockReason, uint256, uint256) {
        uint256 eq = _equity();
        uint32 today = uint32(block.timestamp / 1 days);
        uint128 dayStart = dayStartEquity;
        uint128 hwm = highWaterEquity;
        if (today != riskDay) {
            riskDay = today;
            dayStart = uint128(eq);
            dayStartEquity = dayStart;
        }
        if (eq > hwm) {
            hwm = uint128(eq);
            highWaterEquity = hwm;
        }
        emit RiskUpdated(today, dayStart, hwm, eq);

        uint256 dl = dailyLossBps;
        if (dl != 0) {
            uint256 floor = Math.mulDiv(dayStart, BPS - dl, BPS);
            if (eq < floor) return (BlockReason.DailyLossStop, floor, eq);
        }
        uint256 dd = drawdownBps;
        if (dd != 0) {
            uint256 floor = Math.mulDiv(hwm, BPS - dd, BPS);
            if (eq < floor) return (BlockReason.DrawdownStop, floor, eq);
        }
        return (BlockReason.None, 0, 0);
    }

    // =============================================================================================
    // Stops anyone can trigger (reduce-only, only when the condition is true onchain)
    // =============================================================================================

    /// @notice Close every position and pause copying once the daily loss or drawdown stop is hit.
    /// @dev Requires flattenOnStop. Every open market's mark must be trusted (see {_trustedMark}), because
    ///      equity is computed from marks.
    function triggerAccountStop() external nonReentrant returns (uint256 closed) {
        if (!flattenOnStop) revert FlattenOff();
        _requireTrustedMarks(0, false);
        (BlockReason r, uint256 limit, uint256 actual) = _checkLossStops();
        if (r != BlockReason.DailyLossStop && r != BlockReason.DrawdownStop) revert StopNotTriggered();
        _setPaused(true);
        closed = _closePositions(0, false, stopSlippageBps);
        emit StopTriggered(
            msg.sender, r == BlockReason.DailyLossStop ? StopKind.DailyLoss : StopKind.Drawdown, 0, limit, actual, 0, closed
        );
    }

    /// @notice Close the positions held for one leader once that leader's loss stop is hit.
    function triggerLeaderStop(uint32 leaderAccountId) external nonReentrant returns (uint256 closed) {
        if (!flattenOnStop) revert FlattenOff();
        (bool allowed, LeaderRule memory rule) = _leaderRule(leaderAccountId);
        if (!allowed || rule.lossStopBps == 0) revert StopNotTriggered();
        _requireTrustedMarks(leaderAccountId, true);
        (, int256 unrealized) = _leaderExposure(leaderAccountId);
        int256 pnl = leaderRealizedCNS[leaderAccountId] + unrealized;
        uint256 lossLimit = Math.mulDiv(rule.budgetCNS, rule.lossStopBps, BPS);
        if (pnl >= -int256(lossLimit)) revert StopNotTriggered();
        if (!leaderStopped[leaderAccountId]) {
            leaderStopped[leaderAccountId] = true;
            emit LeaderStopped(leaderAccountId, pnl, lossLimit);
        }
        closed = _closePositions(leaderAccountId, true, stopSlippageBps);
        emit StopTriggered(
            msg.sender, StopKind.LeaderLoss, leaderAccountId, lossLimit, pnl < 0 ? uint256(-pnl) : 0, 0, closed
        );
    }

    /// @notice Execute the owner's stop-loss or take-profit level in `perpId` once the price has reached it.
    /// @dev The condition reads Perpl's mark price (posted by Perpl's operators and bounded by Perpl to its
    ///      Chainlink oracle, so trades on a thin book do not move it). When the Chainlink price is fresh it
    ///      must have reached the level too, and the two must agree within MAX_MARK_ORACLE_GAP_BPS. The close
    ///      is an IOC order bounded at mark +/- the level's slippage, so a drained book can only make it fill
    ///      less, never worse.
    function triggerLevel(uint256 perpId) external nonReentrant returns (uint256 lotsClosed) {
        uint256 acct = perplAccountId;
        if (acct == 0) revert NoPerplAccount();
        Level memory lv = _levels[perpId];
        if (lv.stopLossPNS == 0 && lv.takeProfitPNS == 0) revert StopNotTriggered();
        (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(perpId, acct);
        if (pos.lotLNS == 0 || pos.positionType != lv.side) revert StopNotTriggered();

        (uint256 mark, uint256 oracle, bool oracleFresh) = _trustedMark(perpId);
        bool long_ = lv.side == LONG;
        StopKind kind;
        uint256 levelPNS;
        if (lv.stopLossPNS != 0 && _reached(long_, false, lv.stopLossPNS, mark, oracle, oracleFresh)) {
            kind = StopKind.StopLoss;
            levelPNS = lv.stopLossPNS;
        } else if (lv.takeProfitPNS != 0 && _reached(long_, true, lv.takeProfitPNS, mark, oracle, oracleFresh)) {
            kind = StopKind.TakeProfit;
            levelPNS = lv.takeProfitPNS;
        } else {
            revert StopNotTriggered();
        }

        // No new copies into this market until the owner sets a policy again.
        markets[perpId].halted = true;
        uint256 after_ = _closeOne(perpId, acct, lv.slippageBps);
        lotsClosed = pos.lotLNS - after_;
        if (after_ == 0) delete _levels[perpId];
        emit StopTriggered(msg.sender, kind, uint32(perpId), levelPNS, mark, oracleFresh ? oracle : 0, lotsClosed);
    }

    /// @dev Long stop-loss: price at or below the level. Long take-profit: at or above. Short is mirrored.
    function _reached(bool long_, bool profit, uint256 levelPNS, uint256 mark, uint256 oracle, bool oracleFresh)
        internal
        pure
        returns (bool)
    {
        bool below = long_ != profit;
        bool markOk = below ? mark <= levelPNS : mark >= levelPNS;
        if (!markOk) return false;
        if (!oracleFresh) return true;
        return below ? oracle <= levelPNS : oracle >= levelPNS;
    }

    /// @dev Perpl's mark for `perpId`, required valid; when Perpl's Chainlink price is fresh, the two must agree
    ///      within MAX_MARK_ORACLE_GAP_BPS.
    function _trustedMark(uint256 perpId) internal view returns (uint256 mark, uint256 oracle, bool oracleFresh) {
        bool valid;
        (, mark, valid) = EXCHANGE.getPositionV2(perpId, perplAccountId);
        IPerplExchange.PerpetualInfoV2 memory info = EXCHANGE.getPerpetualInfoV2(perpId);
        oracle = info.oraclePNS;
        oracleFresh = !info.ignOracle && oracle != 0 && info.oracleTimestampSec + info.refPriceMaxAgeSec >= block.timestamp;
        if (!valid || mark == 0) revert UntrustedPrice(perpId, mark, oracle);
        if (oracleFresh) {
            uint256 gap = mark > oracle ? mark - oracle : oracle - mark;
            if (gap * BPS > oracle * MAX_MARK_ORACLE_GAP_BPS) revert UntrustedPrice(perpId, mark, oracle);
        }
    }

    /// @dev Requires a trusted mark in every open market (or, if `onlyLeader`, every market held for `leader`).
    function _requireTrustedMarks(uint32 leader, bool onlyLeader) internal view {
        uint256 acct = perplAccountId;
        if (acct == 0) return;
        IPerplExchange.AccountInfo memory info = EXCHANGE.getAccountById(acct);
        uint256[4] memory banks = [info.positions.bank1, info.positions.bank2, info.positions.bank3, info.positions.bank4];
        for (uint256 b; b < 4; ++b) {
            uint256 bits = banks[b];
            while (bits != 0) {
                uint256 perpId = b * 256 + _lowestBit(bits);
                bits &= bits - 1;
                if (onlyLeader && marketLeader[perpId] != leader) continue;
                _trustedMark(perpId);
            }
        }
    }

    // =============================================================================================
    // Deposits (anyone may relay; funds can only come from, and belong to, the owner)
    // =============================================================================================

    /// @notice Deposit with an ERC-3009 receive authorization signed by the owner. Gasless for the owner.
    function depositWithAuthorization(
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        COLLATERAL.receiveWithAuthorization(owner, address(this), amount, validAfter, validBefore, nonce, v, r, s);
        _deposit(owner, amount);
    }

    /// @notice Deposit with an ERC-2612 permit signed by the owner. Gasless for the owner.
    /// @dev If someone front-runs the permit, the token call fails but the allowance is in place. The deposit
    ///      then goes ahead only if (v, r, s) is the owner's permit for exactly this account, amount and deadline
    ///      at the nonce just consumed, and only once. Without this check, any standing allowance the owner gave
    ///      this account could be pulled in by anyone with a junk signature.
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        address o = owner;
        try COLLATERAL.permit(o, address(this), amount, deadline, v, r, s) {}
        catch {
            uint256 n = COLLATERAL.nonces(o);
            if (n == 0 || block.timestamp > deadline) revert BadSignature();
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    COLLATERAL.DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(PERMIT_TYPEHASH, o, address(this), amount, n - 1, deadline))
                )
            );
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, v, r, s);
            if (err != ECDSA.RecoverError.NoError || signer != o || frontRunPermitUsed[digest]) revert BadSignature();
            frontRunPermitUsed[digest] = true;
        }
        IERC20(address(COLLATERAL)).safeTransferFrom(o, address(this), amount);
        _deposit(o, amount);
    }

    /// @notice Deposit from the owner's wallet using a standing allowance.
    function deposit(uint256 amount) external nonReentrant onlyOwner {
        IERC20(address(COLLATERAL)).safeTransferFrom(msg.sender, address(this), amount);
        _deposit(msg.sender, amount);
    }

    function _deposit(address from, uint256 amount) internal {
        uint256 wouldBe = netDeposits + amount;
        if (wouldBe > DEPOSIT_CAP) revert DepositCapExceeded(DEPOSIT_CAP, wouldBe);
        netDeposits = wouldBe;

        IERC20(address(COLLATERAL)).forceApprove(address(EXCHANGE), amount);
        if (perplAccountId == 0) {
            uint256 minOpen = EXCHANGE.getMinAccountOpenCNS();
            if (amount < minOpen) revert BelowMinimumAccountOpen(minOpen, amount);
            uint256 id = EXCHANGE.createAccount(amount);
            perplAccountId = uint32(id);
            emit PerplAccountCreated(id);
        } else {
            EXCHANGE.depositCollateral(amount);
        }

        // Deposits are not performance: lift both loss-stop baselines by the amount.
        dayStartEquity += uint128(amount);
        highWaterEquity += uint128(amount);
        emit Deposited(from, amount, wouldBe);
    }

    // =============================================================================================
    // Owner actions (direct or relayed with an EIP-712 signature)
    // =============================================================================================

    function setPolicy(Policy calldata p) external onlyOwner nonReentrant {
        _setPolicy(p);
    }

    /// @notice Set the policy, resume copying, and immediately bring the account to the leaders' current
    ///         positions ("match now"). Each match order goes through exactly the same checks as a keeper
    ///         copy, so it can never exceed ratio x the leader's current same-side position.
    function follow(Policy calldata p, MirrorOrder[] calldata matches)
        external
        onlyOwner
        nonReentrant
        returns (bool[] memory executed)
    {
        return _follow(p, matches);
    }

    /// @notice Bring the account to the leaders' current positions under the existing policy.
    function matchNow(MirrorOrder[] calldata matches) external onlyOwner nonReentrant returns (bool[] memory executed) {
        return _matchNow(matches);
    }

    /// @notice Set or clear stop-loss / take-profit levels. A level with both prices zero clears that market.
    function setLevels(Level[] calldata levels) external onlyOwner nonReentrant {
        _setLevels(levels);
    }

    function setPaused(bool p) external onlyOwner nonReentrant {
        _setPaused(p);
    }

    function closeAll(uint16 slippageBps) external onlyOwner nonReentrant {
        _closeAll(slippageBps);
    }

    /// @notice Close the whole position in one market with an IOC order bounded at mark +/- slippageBps.
    function closeMarket(uint32 perpId, uint16 slippageBps) external onlyOwner nonReentrant {
        _closeMarket(perpId, slippageBps);
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        _withdraw(amount);
    }

    /// @notice Escape hatch: the owner may make any call to the Perpl Exchange as this account (for example
    ///         if the Exchange ABI changes). Keepers and admins have no equivalent.
    function exchangeCall(bytes calldata data) external onlyOwner nonReentrant returns (bytes memory) {
        return _exchangeCall(data);
    }

    function sweep(address token) external onlyOwner nonReentrant {
        _sweep(token);
    }

    /// @notice Execute an owner action authorised by an EIP-712 signature. Anyone may relay it.
    function execute(Action calldata a, bytes calldata signature) external nonReentrant returns (bytes memory result) {
        if (block.timestamp > a.deadline) revert ActionExpired();
        if (a.nonce != actionNonce) revert BadNonce();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ACTION_TYPEHASH, a.kind, keccak256(a.data), a.nonce, a.deadline)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != owner) revert BadSignature();
        unchecked {
            actionNonce = a.nonce + 1;
        }

        if (a.kind == ACTION_SET_POLICY) {
            _setPolicy(abi.decode(a.data, (Policy)));
        } else if (a.kind == ACTION_SET_PAUSED) {
            _setPaused(abi.decode(a.data, (bool)));
        } else if (a.kind == ACTION_CLOSE_ALL) {
            _closeAll(abi.decode(a.data, (uint16)));
        } else if (a.kind == ACTION_WITHDRAW) {
            _withdraw(abi.decode(a.data, (uint256)));
        } else if (a.kind == ACTION_EXCHANGE_CALL) {
            result = _exchangeCall(abi.decode(a.data, (bytes)));
        } else if (a.kind == ACTION_SWEEP) {
            _sweep(abi.decode(a.data, (address)));
        } else if (a.kind == ACTION_FOLLOW) {
            (Policy memory p, MirrorOrder[] memory m) = abi.decode(a.data, (Policy, MirrorOrder[]));
            result = abi.encode(_follow(p, m));
        } else if (a.kind == ACTION_MATCH_NOW) {
            result = abi.encode(_matchNow(abi.decode(a.data, (MirrorOrder[]))));
        } else if (a.kind == ACTION_SET_LEVELS) {
            _setLevels(abi.decode(a.data, (Level[])));
        } else if (a.kind == ACTION_CLOSE_MARKET) {
            (uint32 perpId, uint16 slip) = abi.decode(a.data, (uint32, uint16));
            _closeMarket(perpId, slip);
        } else {
            revert UnknownAction(a.kind);
        }
        emit ActionExecuted(a.kind, a.nonce);
    }

    /// @notice EIP-712 digest of an action, for clients that want to show or verify what is signed.
    function actionDigest(Action calldata a) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ACTION_TYPEHASH, a.kind, keccak256(a.data), a.nonce, a.deadline)));
    }

    function _setPolicy(Policy memory p) internal {
        if (p.maxLeverageHdths < MIN_LEVERAGE_HDTHS || p.maxLeverageHdths > MAX_LEVERAGE_HDTHS) {
            revert InvalidPolicy("maxLeverageHdths");
        }
        if (p.maxSlippageBps == 0 || p.maxSlippageBps > MAX_SLIPPAGE_BPS) revert InvalidPolicy("maxSlippageBps");
        if (p.dailyLossBps >= BPS) revert InvalidPolicy("dailyLossBps");
        if (p.drawdownBps >= BPS) revert InvalidPolicy("drawdownBps");
        if (p.expiry <= block.timestamp) revert InvalidPolicy("expiry");
        if (p.maxEntryDeviationBps > MAX_ENTRY_DEVIATION_BPS) revert InvalidPolicy("maxEntryDeviationBps");
        if (p.stopSlippageBps == 0 || p.stopSlippageBps > MAX_CLOSE_ALL_SLIPPAGE_BPS) {
            revert InvalidPolicy("stopSlippageBps");
        }
        if (p.maxBuilderFeePer100K > MAX_BUILDER_FEE_PER_100K) revert InvalidPolicy("maxBuilderFeePer100K");
        if (p.leaders.length == 0 || p.leaders.length > MAX_LEADERS) revert InvalidPolicy("leaders");
        if (p.markets.length == 0 || p.markets.length > MAX_MARKETS) revert InvalidPolicy("markets");

        uint32 self = perplAccountId;
        LeaderRule[] memory old = _leaders;
        delete _leaders;
        for (uint256 i; i < p.leaders.length; ++i) {
            LeaderRule memory l = p.leaders[i];
            if (l.accountId == 0 || (self != 0 && l.accountId == self)) revert InvalidPolicy("leader.accountId");
            if (l.ratioBps == 0 || l.ratioBps > MAX_RATIO_BPS) revert InvalidPolicy("leader.ratioBps");
            if (l.budgetCNS == 0) revert InvalidPolicy("leader.budgetCNS");
            if (l.lossStopBps > BPS) revert InvalidPolicy("leader.lossStopBps");
            for (uint256 j; j < i; ++j) {
                if (p.leaders[j].accountId == l.accountId) revert InvalidPolicy("leader.duplicate");
            }
            bool kept;
            for (uint256 j; j < old.length; ++j) {
                if (old[j].accountId == l.accountId) kept = true;
            }
            // A newly added or re-armed leader starts with a clean loss record.
            if (!kept || leaderStopped[l.accountId]) {
                leaderRealizedCNS[l.accountId] = 0;
                leaderStopped[l.accountId] = false;
            }
            _leaders.push(l);
        }

        uint256 oldLen = _marketIds.length;
        for (uint256 i; i < oldLen; ++i) {
            delete markets[_marketIds[i]];
        }
        delete _marketIds;
        for (uint256 i; i < p.markets.length; ++i) {
            MarketRule memory mr = p.markets[i];
            if (mr.maxNotionalCNS == 0) revert InvalidPolicy("market.maxNotionalCNS");
            if (markets[mr.perpId].allowed) revert InvalidPolicy("market.duplicate");
            IPerplExchange.PerpetualInfoV2 memory info = EXCHANGE.getPerpetualInfoV2(mr.perpId);
            if (bytes(info.symbol).length == 0 || info.lotDecimals > 18 || info.priceDecimals > 18) {
                revert InvalidPolicy("market.perpId");
            }
            markets[mr.perpId] = Market({
                allowed: true,
                halted: false,
                lotDecimals: uint8(info.lotDecimals),
                priceDecimals: uint8(info.priceDecimals),
                maxNotionalCNS: mr.maxNotionalCNS
            });
            _marketIds.push(mr.perpId);
        }

        maxLeverageHdths = p.maxLeverageHdths;
        maxSlippageBps = p.maxSlippageBps;
        dailyLossBps = p.dailyLossBps;
        drawdownBps = p.drawdownBps;
        expiry = p.expiry;
        maxEntryDeviationBps = p.maxEntryDeviationBps;
        stopSlippageBps = p.stopSlippageBps;
        flattenOnStop = p.flattenOnStop;
        maxBuilderFeePer100K = p.maxBuilderFeePer100K;
        emit PolicyUpdated(
            p.maxLeverageHdths,
            p.maxSlippageBps,
            p.dailyLossBps,
            p.drawdownBps,
            p.expiry,
            p.maxEntryDeviationBps,
            p.stopSlippageBps,
            p.flattenOnStop,
            p.maxBuilderFeePer100K,
            p.leaders,
            p.markets
        );
    }

    function _setLevels(Level[] memory levels) internal {
        if (levels.length > MAX_MARKETS) revert InvalidLevel("length");
        for (uint256 i; i < levels.length; ++i) {
            Level memory lv = levels[i];
            if (lv.stopLossPNS == 0 && lv.takeProfitPNS == 0) {
                delete _levels[lv.perpId];
            } else {
                if (lv.side > SHORT) revert InvalidLevel("side");
                if (lv.slippageBps == 0 || lv.slippageBps > MAX_CLOSE_ALL_SLIPPAGE_BPS) revert InvalidLevel("slippageBps");
                if (lv.stopLossPNS != 0 && lv.takeProfitPNS != 0) {
                    // A long's stop sits below its take-profit; a short's above.
                    if (lv.side == LONG ? lv.stopLossPNS >= lv.takeProfitPNS : lv.stopLossPNS <= lv.takeProfitPNS) {
                        revert InvalidLevel("order");
                    }
                }
                _levels[lv.perpId] = lv;
            }
            emit LevelSet(lv.perpId, lv.side, lv.stopLossPNS, lv.takeProfitPNS, lv.slippageBps);
        }
    }

    function _follow(Policy memory p, MirrorOrder[] memory matches) internal returns (bool[] memory executed) {
        _setPolicy(p);
        if (paused) _setPaused(false);
        executed = _matchNow(matches);
        uint256 n;
        for (uint256 i; i < executed.length; ++i) {
            if (executed[i]) ++n;
        }
        emit Followed(matches.length, n);
    }

    function _matchNow(MirrorOrder[] memory matches) internal returns (bool[] memory executed) {
        if (matches.length > MAX_MATCH_ORDERS) revert TooManyMatchOrders();
        executed = new bool[](matches.length);
        for (uint256 i; i < matches.length; ++i) {
            MirrorOrder memory o = matches[i];
            if (o.orderType != OPEN_LONG && o.orderType != OPEN_SHORT) revert MatchNowOpensOnly();
            o.leaderRef = MATCH_NOW_REF;
            executed[i] = _copy(o, owner);
        }
    }

    function _setPaused(bool p) internal {
        paused = p;
        emit PausedSet(p);
    }

    /// @dev Pauses copying and closes every open position with IOC orders bounded at mark +/- slippageBps.
    function _closeAll(uint16 slippageBps) internal {
        if (slippageBps == 0 || slippageBps > MAX_CLOSE_ALL_SLIPPAGE_BPS) revert InvalidPolicy("slippageBps");
        _setPaused(true);
        uint256 closed = _closePositions(0, false, slippageBps);
        emit ClosedAll(slippageBps, closed);
    }

    function _closeMarket(uint32 perpId, uint16 slippageBps) internal {
        if (slippageBps == 0 || slippageBps > MAX_CLOSE_ALL_SLIPPAGE_BPS) revert InvalidPolicy("slippageBps");
        uint256 acct = perplAccountId;
        if (acct == 0) revert NoPerplAccount();
        (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(perpId, acct);
        if (pos.lotLNS == 0) revert NothingToClose();
        uint256 after_ = _closeOne(perpId, acct, slippageBps);
        emit MarketClosed(perpId, slippageBps, pos.lotLNS, after_);
    }

    /// @dev Closes every open position, or only those held for `leader` when `onlyLeader`.
    function _closePositions(uint32 leader, bool onlyLeader, uint256 slippageBps) internal returns (uint256 closed) {
        uint256 acct = perplAccountId;
        if (acct == 0) return 0;
        IPerplExchange.AccountInfo memory info = EXCHANGE.getAccountById(acct);
        uint256[4] memory banks = [info.positions.bank1, info.positions.bank2, info.positions.bank3, info.positions.bank4];
        for (uint256 b; b < 4; ++b) {
            uint256 bits = banks[b];
            while (bits != 0) {
                uint256 perpId = b * 256 + _lowestBit(bits);
                bits &= bits - 1;
                if (onlyLeader && marketLeader[perpId] != leader) continue;
                (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(perpId, acct);
                if (pos.lotLNS == 0) continue;
                _closeOne(perpId, acct, slippageBps);
                ++closed;
            }
        }
    }

    /// @dev Reduce-only IOC close of the whole position in `perpId`, bounded at mark +/- slippageBps.
    ///      Returns the lots left (non-zero after a partial fill).
    function _closeOne(uint256 perpId, uint256 acct, uint256 slippageBps) internal returns (uint256 lotsAfter) {
        (IPerplExchange.PositionInfoV2 memory pos, uint256 mark,) = EXCHANGE.getPositionV2(perpId, acct);
        uint8 orderType = pos.positionType == LONG ? CLOSE_LONG : CLOSE_SHORT;
        uint256 price = pos.positionType == LONG
            ? Math.mulDiv(mark, BPS - slippageBps, BPS)
            : Math.mulDiv(mark, BPS + slippageBps, BPS, Math.Rounding.Ceil);
        _execTracked(perpId, orderType, pos.lotLNS, price, 0, 0, marketLeader[perpId]);
        (IPerplExchange.PositionInfoV2 memory aft,,) = EXCHANGE.getPositionV2(perpId, acct);
        if (aft.lotLNS > pos.lotLNS || (aft.lotLNS != 0 && aft.positionType != pos.positionType)) {
            revert PostTradeViolation(BlockReason.FlipNotAllowed, pos.lotLNS, aft.lotLNS);
        }
        if (aft.lotLNS == 0) delete marketLeader[perpId];
        return aft.lotLNS;
    }

    function _withdraw(uint256 amount) internal {
        uint256 idle = IERC20(address(COLLATERAL)).balanceOf(address(this));
        if (amount > idle) {
            EXCHANGE.withdrawCollateral(amount - idle);
        }
        address o = owner;
        IERC20(address(COLLATERAL)).safeTransfer(o, amount);

        uint256 nd = netDeposits;
        nd = amount >= nd ? 0 : nd - amount;
        netDeposits = nd;
        uint128 a = uint128(Math.min(amount, type(uint128).max));
        dayStartEquity = dayStartEquity > a ? dayStartEquity - a : 0;
        highWaterEquity = highWaterEquity > a ? highWaterEquity - a : 0;
        emit Withdrawn(o, amount, nd);
    }

    function _exchangeCall(bytes memory data) internal returns (bytes memory result) {
        bool ok;
        (ok, result) = address(EXCHANGE).call(data);
        if (!ok) revert ExchangeCallFailed(result);
        emit ExchangeCalled(data, result);
    }

    function _sweep(address token) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner, bal);
        emit Swept(token, bal);
    }

    // =============================================================================================
    // Views
    // =============================================================================================

    function leaders() external view returns (LeaderRule[] memory) {
        return _leaders;
    }

    function marketIds() external view returns (uint32[] memory) {
        return _marketIds;
    }

    function level(uint256 perpId) external view returns (Level memory) {
        return _levels[perpId];
    }

    /// @notice Account equity in collateral units: free balance plus each position's deposit and PnL.
    function equity() external view returns (uint256) {
        return _equity();
    }

    /// @notice Margin held and unrealised PnL of the positions held for one leader, and its realised PnL.
    function leaderBook(uint32 leaderAccountId)
        external
        view
        returns (uint256 marginCNS, int256 unrealizedCNS, int256 realizedCNS, bool stopped)
    {
        (marginCNS, unrealizedCNS) = _leaderExposure(leaderAccountId);
        return (marginCNS, unrealizedCNS, leaderRealizedCNS[leaderAccountId], leaderStopped[leaderAccountId]);
    }

    /// @notice Maximum lots this account may hold on `side` in `perpId` for one leader, given that leader's
    ///         current position: ratio x the leader's same-side lots, rounded up; zero for any other leader.
    function targetLots(uint256 perpId, uint32 leaderAccountId, uint8 side) external view returns (uint256) {
        return _targetLots(perpId, leaderAccountId, side);
    }

    // =============================================================================================
    // Internals
    // =============================================================================================

    /// @dev Sends an IOC order and books the change in (free balance + this market's position deposit), which
    ///      is realised PnL net of fees, against the leader the position is held for.
    function _execTracked(
        uint256 perpId,
        uint8 orderType,
        uint256 lots,
        uint256 price,
        uint256 leverage,
        uint256 maxMatches,
        uint32 leader
    ) internal {
        uint256 acct = perplAccountId;
        int256 before = _bookValue(perpId, acct);
        _execIoc(perpId, orderType, lots, price, leverage, maxMatches);
        if (leader != 0) leaderRealizedCNS[leader] += _bookValue(perpId, acct) - before;
    }

    function _bookValue(uint256 perpId, uint256 acct) internal view returns (int256) {
        (IPerplExchange.PositionInfoV2 memory pos,,) = EXCHANGE.getPositionV2(perpId, acct);
        return int256(EXCHANGE.getAccountById(acct).balanceCNS) + int256(pos.depositCNS);
    }

    function _execIoc(uint256 perpId, uint8 orderType, uint256 lots, uint256 price, uint256 leverage, uint256 maxMatches)
        internal
    {
        if (maxMatches > MAX_MATCHES) maxMatches = MAX_MATCHES;
        unchecked {
            ++orderNonce;
        }
        IPerplExchange.OrderDesc memory d = IPerplExchange.OrderDesc({
                orderDescId: orderNonce,
                perpId: perpId,
                orderType: orderType,
                orderId: 0,
                pricePNS: price,
                lotLNS: lots,
                expiryBlock: 0,
                postOnly: false,
                fillOrKill: false,
                immediateOrCancel: true,
                maxMatches: maxMatches,
                leverageHdths: leverage,
                lastExecutionBlock: 0,
                amountCNS: 0,
                maxNegPnlCollatBPS: MAX_NEG_PNL_COLLAT_BPS
            });
        // Only opening orders carry builder attribution. Perpl charges the builder fee on whatever an attributed
        // order fills, closes included, so every reducing path (keeper closes, stops, close-all, close-market)
        // goes through the builder-blind entrypoint and can never pay one.
        bool opening = orderType == OPEN_LONG || orderType == OPEN_SHORT;
        if (opening && BUILDER_ID != 0) {
            EXCHANGE.execOrderV2(
                d,
                abi.encode(ORDER_EXTENSION_VERSION, abi.encode(uint256(BUILDER_ID), uint256(BUILDER_FEE_PER_100K)))
            );
        } else {
            EXCHANGE.execOrder(d);
        }
    }

    /// @dev Builder fee on `lots` added at `pricePNS`: notional x rate, rounded up (as Perpl rounds it).
    function _builderFee(uint256 perpId, uint256 lots, uint256 pricePNS) internal view returns (uint256) {
        if (BUILDER_ID == 0 || BUILDER_FEE_PER_100K == 0) return 0;
        return Math.mulDiv(_notional(perpId, lots, pricePNS), BUILDER_FEE_PER_100K, FEE_DENOMINATOR, Math.Rounding.Ceil);
    }

    function _leaderRule(uint32 accountId) internal view returns (bool, LeaderRule memory rule) {
        uint256 n = _leaders.length;
        for (uint256 i; i < n; ++i) {
            if (_leaders[i].accountId == accountId) return (true, _leaders[i]);
        }
        return (false, rule);
    }

    /// @dev Ratio x the leader's current lots on `side`, rounded up; zero if the leader is not followed or holds
    ///      the other side.
    function _targetLots(uint256 perpId, uint32 leader, uint8 side) internal view returns (uint256) {
        (bool allowed, LeaderRule memory rule) = _leaderRule(leader);
        if (!allowed) return 0;
        (IPerplExchange.PositionInfoV2 memory lp,,) = EXCHANGE.getPositionV2(perpId, leader);
        if (lp.lotLNS == 0 || lp.positionType != side) return 0;
        return Math.mulDiv(lp.lotLNS, rule.ratioBps, BPS, Math.Rounding.Ceil);
    }

    /// @dev Sum of position deposits and of unrealised PnL over the open markets held for `leader`.
    function _leaderExposure(uint32 leader) internal view returns (uint256 margin, int256 unrealized) {
        uint256 acct = perplAccountId;
        if (acct == 0) return (0, 0);
        IPerplExchange.AccountInfo memory info = EXCHANGE.getAccountById(acct);
        uint256[4] memory banks = [info.positions.bank1, info.positions.bank2, info.positions.bank3, info.positions.bank4];
        for (uint256 b; b < 4; ++b) {
            uint256 bits = banks[b];
            while (bits != 0) {
                uint256 perpId = b * 256 + _lowestBit(bits);
                bits &= bits - 1;
                if (marketLeader[perpId] != leader) continue;
                (IPerplExchange.PositionInfoV2 memory p,,) = EXCHANGE.getPositionV2(perpId, acct);
                if (p.lotLNS == 0) continue;
                margin += p.depositCNS;
                unrealized += p.deltaPnlCNS + p.premiumPnlCNS;
            }
        }
    }

    function _notional(uint256 perpId, uint256 lots, uint256 mark) internal view returns (uint256) {
        Market memory m = markets[perpId];
        uint256 scaleDown = 10 ** (uint256(m.lotDecimals) + m.priceDecimals);
        return Math.mulDiv(lots * mark, 10 ** COLLATERAL_DECIMALS, scaleDown);
    }

    /// @dev Bids (open long, close short) may pay at most mark*(1+s); asks (open short, close long) must
    ///      receive at least mark*(1-s).
    function _priceWithinSlippage(uint8 orderType, uint256 price, uint256 mark, uint256 slippageBps)
        internal
        pure
        returns (bool ok, uint256 bound)
    {
        bool bid = orderType == OPEN_LONG || orderType == CLOSE_SHORT;
        if (bid) {
            bound = Math.mulDiv(mark, BPS + slippageBps, BPS);
            ok = price <= bound;
        } else {
            bound = Math.mulDiv(mark, BPS - slippageBps, BPS, Math.Rounding.Ceil);
            ok = price >= bound;
        }
    }

    function _equity() internal view returns (uint256) {
        uint256 acct = perplAccountId;
        uint256 idle = IERC20(address(COLLATERAL)).balanceOf(address(this));
        if (acct == 0) return idle;
        IPerplExchange.AccountInfo memory info = EXCHANGE.getAccountById(acct);
        int256 total = int256(info.balanceCNS) + int256(idle);
        uint256[4] memory banks =
            [info.positions.bank1, info.positions.bank2, info.positions.bank3, info.positions.bank4];
        for (uint256 b; b < 4; ++b) {
            uint256 bits = banks[b];
            while (bits != 0) {
                uint256 bit = _lowestBit(bits);
                bits &= bits - 1;
                (IPerplExchange.PositionInfoV2 memory p,,) = EXCHANGE.getPositionV2(b * 256 + bit, acct);
                total += int256(p.depositCNS) + p.deltaPnlCNS + p.premiumPnlCNS;
            }
        }
        return total > 0 ? uint256(total) : 0;
    }

    function _lowestBit(uint256 x) internal pure returns (uint256) {
        // Index of the least significant set bit (x != 0).
        return Math.log2(x & (~x + 1));
    }
}
