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
///         keepers mirror a leader's trades into it, subject to the follower's policy, which is checked
///         onchain on every copied order.
/// @dev Security model:
///      - Only the owner (the follower's passkey-derived EOA) can withdraw, change policy, pause, close all,
///        or make arbitrary Exchange calls. Every owner action can also be relayed with an EIP-712 signature,
///        so the follower never needs MON for gas.
///      - Keepers can only call {mirror}. A mirrored order is an immediate-or-cancel Perpl order built by this
///        contract; keepers cannot set the collateral amount, cannot post resting orders, and no code path
///        lets a keeper move collateral out of the account.
///      - There is no admin, upgrade, or pause path outside the owner. The implementation is behind
///        non-upgradeable EIP-1167 clones.
///      - Policy checks that fail before execution emit {Blocked} and return without trading, so a rule
///        hit is provable onchain. Post-execution checks revert as defence in depth.
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
    uint256 public constant MAX_MATCHES = 1_000;
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

    /// leaderRef recorded on orders the owner places with match-now, so indexers can tell them apart.
    bytes32 public constant MATCH_NOW_REF = keccak256("MIRROR_MATCH_NOW");
    uint256 public constant MAX_MATCH_ORDERS = 16;

    bytes32 public constant ACTION_TYPEHASH =
        keccak256("Action(uint8 kind,bytes data,uint256 nonce,uint256 deadline)");

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    struct LeaderRule {
        /// Perpl account id of the leader being followed.
        uint32 accountId;
        /// Follower size as a fraction of the leader's size, in basis points.
        uint32 ratioBps;
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
        LeaderRule[] leaders;
        MarketRule[] markets;
    }

    struct Market {
        bool allowed;
        uint8 lotDecimals;
        uint8 priceDecimals;
        uint64 maxNotionalCNS;
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
        /// Reference to the leader fill (e.g. leader tx hash), emitted for attribution and latency.
        bytes32 leaderRef;
    }

    struct Action {
        uint8 kind;
        bytes data;
        uint256 nonce;
        uint256 deadline;
    }

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
        LeverageTooLow
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

    LeaderRule[] internal _leaders;
    uint32[] internal _marketIds;
    mapping(uint256 perpId => Market) public markets;

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
        bytes32 leaderRef
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
        bytes32 leaderRef
    );
    event ClosedAll(uint16 slippageBps, uint256 positionsClosed);
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
    error DepositCapExceeded(uint256 cap, uint256 wouldBe);
    error BelowMinimumAccountOpen(uint256 minimum, uint256 amount);
    error ActionExpired();
    error BadNonce();
    error BadSignature();
    error UnknownAction(uint8 kind);
    error ExchangeCallFailed(bytes result);
    error MatchNowOpensOnly();
    error TooManyMatchOrders();

    // ---------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------

    constructor(
        IPerplExchange exchange,
        IAuthorizedToken collateral,
        KeeperRegistry keepers,
        address factory,
        uint256 depositCap
    ) EIP712("Mirror Account", "1") {
        if (
            address(exchange) == address(0) || address(collateral) == address(0) || address(keepers) == address(0)
                || factory == address(0)
        ) revert ZeroAddress();
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

        (uint8 side, uint256 lotsBefore, uint256 mark, bool markValid) = _position(o.perpId, acct);
        bool opening = o.orderType == OPEN_LONG || o.orderType == OPEN_SHORT;

        if (opening) {
            (BlockReason reason, uint256 limit, uint256 actual) =
                _checkOpen(o, side, lotsBefore, mark, markValid);
            if (reason != BlockReason.None) {
                emit Blocked(
                    actor, o.leaderAccountId, o.perpId, reason, o.orderType, o.lotLNS, limit, actual, o.leaderRef
                );
                return false;
            }
        } else {
            uint8 closingSide = o.orderType == CLOSE_LONG ? LONG : SHORT;
            if (lotsBefore == 0 || side != closingSide) revert NothingToClose();
            if (o.lotLNS > lotsBefore) revert CloseExceedsPosition();
            if (!markValid) {
                emit Blocked(
                    actor, o.leaderAccountId, o.perpId, BlockReason.StaleMark, o.orderType, o.lotLNS, 0, 0, o.leaderRef
                );
                return false;
            }
            (bool ok, uint256 bound) = _priceWithinSlippage(o.orderType, o.pricePNS, mark, maxSlippageBps);
            if (!ok) {
                emit Blocked(
                    actor,
                    o.leaderAccountId,
                    o.perpId,
                    BlockReason.SlippageTooHigh,
                    o.orderType,
                    o.lotLNS,
                    bound,
                    o.pricePNS,
                    o.leaderRef
                );
                return false;
            }
        }

        _execIoc(o.perpId, o.orderType, o.lotLNS, o.pricePNS, opening ? o.leverageHdths : 0, o.maxMatches);

        (uint8 sideAfter, uint256 lotsAfter,,) = _position(o.perpId, acct);
        if (opening) {
            uint8 orderSide = o.orderType == OPEN_LONG ? LONG : SHORT;
            if (lotsAfter != 0 && sideAfter != orderSide) {
                revert PostTradeViolation(BlockReason.FlipNotAllowed, 0, lotsAfter);
            }
            uint256 target = _targetLots(o.perpId, orderSide);
            if (lotsAfter > target) revert PostTradeViolation(BlockReason.ExceedsLeaderTarget, target, lotsAfter);
            uint256 notional = _notional(o.perpId, lotsAfter, mark);
            uint256 cap = markets[o.perpId].maxNotionalCNS;
            if (notional > cap) revert PostTradeViolation(BlockReason.ExceedsMaxNotional, cap, notional);
        } else {
            if (lotsAfter > lotsBefore || (lotsAfter != 0 && sideAfter != side)) {
                revert PostTradeViolation(BlockReason.FlipNotAllowed, lotsBefore, lotsAfter);
            }
        }

        emit Mirrored(
            actor,
            o.leaderAccountId,
            o.perpId,
            o.orderType,
            o.lotLNS,
            o.pricePNS,
            opening ? o.leverageHdths : 0,
            lotsBefore,
            lotsAfter,
            o.leaderRef
        );
        return true;
    }

    /// @dev Every rule an opening (exposure-increasing) order must satisfy before it is sent.
    function _checkOpen(MirrorOrder memory o, uint8 side, uint256 lotsBefore, uint256 mark, bool markValid)
        internal
        returns (BlockReason, uint256, uint256)
    {
        uint8 orderSide = o.orderType == OPEN_LONG ? LONG : SHORT;

        if (paused) return (BlockReason.Paused, 0, 0);
        if (block.timestamp > expiry) return (BlockReason.Expired, expiry, block.timestamp);

        Market memory m = markets[o.perpId];
        if (!m.allowed) return (BlockReason.MarketNotAllowed, 0, o.perpId);

        (bool leaderAllowed,) = _leaderRatio(o.leaderAccountId);
        if (!leaderAllowed) return (BlockReason.LeaderNotAllowed, 0, o.leaderAccountId);

        if (o.leverageHdths < MIN_LEVERAGE_HDTHS) {
            return (BlockReason.LeverageTooLow, MIN_LEVERAGE_HDTHS, o.leverageHdths);
        }
        if (o.leverageHdths > maxLeverageHdths) {
            return (BlockReason.LeverageTooHigh, maxLeverageHdths, o.leverageHdths);
        }
        if (lotsBefore != 0 && side != orderSide) return (BlockReason.FlipNotAllowed, 0, lotsBefore);
        if (!markValid) return (BlockReason.StaleMark, 0, 0);

        (bool priceOk, uint256 bound) = _priceWithinSlippage(o.orderType, o.pricePNS, mark, maxSlippageBps);
        if (!priceOk) return (BlockReason.SlippageTooHigh, bound, o.pricePNS);

        // The named leader must currently hold a position on the side being copied.
        (uint8 leaderSide, uint256 leaderLots,,) = _position(o.perpId, o.leaderAccountId);
        if (leaderLots == 0 || leaderSide != orderSide) {
            return (BlockReason.LeaderSideMismatch, orderSide, leaderLots == 0 ? type(uint256).max : leaderSide);
        }

        uint256 target = _targetLots(o.perpId, orderSide);
        uint256 wouldBe = lotsBefore + o.lotLNS;
        if (wouldBe > target) return (BlockReason.ExceedsLeaderTarget, target, wouldBe);

        uint256 notional = _notional(o.perpId, wouldBe, mark);
        if (notional > m.maxNotionalCNS) return (BlockReason.ExceedsMaxNotional, m.maxNotionalCNS, notional);

        return _checkLossStops();
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
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        address o = owner;
        // A front-run permit leaves the allowance in place; tolerate it and rely on transferFrom.
        try COLLATERAL.permit(o, address(this), amount, deadline, v, r, s) {} catch {}
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

    function setPaused(bool p) external onlyOwner nonReentrant {
        _setPaused(p);
    }

    function closeAll(uint16 slippageBps) external onlyOwner nonReentrant {
        _closeAll(slippageBps);
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
        if (p.leaders.length == 0 || p.leaders.length > MAX_LEADERS) revert InvalidPolicy("leaders");
        if (p.markets.length == 0 || p.markets.length > MAX_MARKETS) revert InvalidPolicy("markets");

        uint32 self = perplAccountId;
        delete _leaders;
        for (uint256 i; i < p.leaders.length; ++i) {
            LeaderRule memory l = p.leaders[i];
            if (l.accountId == 0 || (self != 0 && l.accountId == self)) revert InvalidPolicy("leader.accountId");
            if (l.ratioBps == 0 || l.ratioBps > MAX_RATIO_BPS) revert InvalidPolicy("leader.ratioBps");
            for (uint256 j; j < i; ++j) {
                if (p.leaders[j].accountId == l.accountId) revert InvalidPolicy("leader.duplicate");
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
        emit PolicyUpdated(
            p.maxLeverageHdths, p.maxSlippageBps, p.dailyLossBps, p.drawdownBps, p.expiry, p.leaders, p.markets
        );
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
        uint256 acct = perplAccountId;
        uint256 closed;
        if (acct != 0) {
            IPerplExchange.AccountInfo memory info = EXCHANGE.getAccountById(acct);
            uint256[4] memory banks =
                [info.positions.bank1, info.positions.bank2, info.positions.bank3, info.positions.bank4];
            for (uint256 b; b < 4; ++b) {
                uint256 bits = banks[b];
                while (bits != 0) {
                    uint256 bit = _lowestBit(bits);
                    bits &= bits - 1;
                    uint256 perpId = b * 256 + bit;
                    (uint8 side, uint256 lots, uint256 mark,) = _position(perpId, acct);
                    if (lots == 0) continue;
                    uint8 orderType = side == LONG ? CLOSE_LONG : CLOSE_SHORT;
                    uint256 price = side == LONG
                        ? Math.mulDiv(mark, BPS - slippageBps, BPS)
                        : Math.mulDiv(mark, BPS + slippageBps, BPS, Math.Rounding.Ceil);
                    _execIoc(perpId, orderType, lots, price, 0, 0);
                    ++closed;
                }
            }
        }
        emit ClosedAll(slippageBps, closed);
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

    /// @notice Account equity in collateral units: free balance plus each position's deposit and PnL.
    function equity() external view returns (uint256) {
        return _equity();
    }

    /// @notice Maximum lots this account may hold on `side` in `perpId` given the leaders' current positions.
    function targetLots(uint256 perpId, uint8 side) external view returns (uint256) {
        return _targetLots(perpId, side);
    }

    // =============================================================================================
    // Internals
    // =============================================================================================

    function _execIoc(uint256 perpId, uint8 orderType, uint256 lots, uint256 price, uint256 leverage, uint256 maxMatches)
        internal
    {
        if (maxMatches > MAX_MATCHES) maxMatches = MAX_MATCHES;
        unchecked {
            ++orderNonce;
        }
        EXCHANGE.execOrder(
            IPerplExchange.OrderDesc({
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
            })
        );
    }

    function _position(uint256 perpId, uint256 accountId)
        internal
        view
        returns (uint8 side, uint256 lots, uint256 mark, bool markValid)
    {
        (IPerplExchange.PositionInfoV2 memory p, uint256 m, bool v) = EXCHANGE.getPositionV2(perpId, accountId);
        return (p.positionType, p.lotLNS, m, v);
    }

    function _leaderRatio(uint32 accountId) internal view returns (bool, uint256) {
        uint256 n = _leaders.length;
        for (uint256 i; i < n; ++i) {
            if (_leaders[i].accountId == accountId) return (true, _leaders[i].ratioBps);
        }
        return (false, 0);
    }

    /// @dev Sum over leaders of ratio x leader lots on `side` (rounded up per leader), minus leaders on the
    ///      opposite side (rounded down), floored at zero.
    function _targetLots(uint256 perpId, uint8 side) internal view returns (uint256) {
        uint256 plus;
        uint256 minus;
        uint256 n = _leaders.length;
        for (uint256 i; i < n; ++i) {
            LeaderRule memory l = _leaders[i];
            (uint8 ls, uint256 lots,,) = _position(perpId, l.accountId);
            if (lots == 0) continue;
            if (ls == side) plus += Math.mulDiv(lots, l.ratioBps, BPS, Math.Rounding.Ceil);
            else minus += Math.mulDiv(lots, l.ratioBps, BPS);
        }
        return plus > minus ? plus - minus : 0;
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
