// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange} from "../../src/interfaces/IPerplExchange.sol";

/// @dev Simplified Perpl Exchange for unit, fuzz and invariant tests.
///      - IOC orders fill at mark when the limit crosses mark, scaled by `fillBps` (partial fills).
///      - Opening the opposite side of an existing position reduces it and flips with the remainder.
///      - Positions carry deposit (collateral at order leverage) and PnL marked at the current mark price.
contract MockPerplExchange {
    struct Perp {
        uint8 lotDecimals;
        uint8 priceDecimals;
        uint256 mark;
        bool markValid;
        string symbol;
        uint256 oracle;
        uint256 oracleTs;
        bool ignOracle;
    }

    struct Pos {
        uint8 side;
        uint256 lots;
        uint256 entry;
        uint256 deposit;
    }

    IERC20 public immutable token;
    uint256 public minAccountOpen = 10e6;
    uint256 public fillBps = 10_000;
    /// Taker fee on notional, charged to the free balance on every fill.
    uint256 public feeBps;
    uint256 public refPriceMaxAgeSec = 60;
    uint256 public nextAccountId = 100;

    mapping(address => uint256) public accountOf;
    mapping(uint256 => address) public addrOf;
    mapping(uint256 => uint256) public balanceOf;
    mapping(uint256 => Perp) public perps;
    mapping(uint256 => mapping(uint256 => Pos)) internal _pos;
    mapping(uint256 => uint256[4]) internal _bits;

    uint256 public lastOrderDescId;
    IPerplExchange.OrderDesc public lastOrder;

    constructor(IERC20 token_) {
        token = token_;
    }

    // ---- test helpers --------------------------------------------------------------------------

    function addPerp(uint256 perpId, string calldata symbol, uint8 lotDec, uint8 priceDec, uint256 mark) external {
        perps[perpId] = Perp(lotDec, priceDec, mark, true, symbol, 0, 0, true);
    }

    function setMark(uint256 perpId, uint256 mark) external {
        perps[perpId].mark = mark;
    }

    /// Sets the Chainlink price; it counts as fresh for refPriceMaxAgeSec after `ts`.
    function setOracle(uint256 perpId, uint256 price, uint256 ts) external {
        perps[perpId].oracle = price;
        perps[perpId].oracleTs = ts;
        perps[perpId].ignOracle = false;
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    /// Leader-style position with an explicit entry price.
    function setPositionAt(uint256 perpId, uint256 accountId, uint8 side, uint256 lots, uint256 entry) external {
        _pos[perpId][accountId] = Pos(side, lots, entry, _notional(perpId, lots, entry) / 5);
        _setBit(accountId, perpId, lots != 0);
    }

    /// Simulates a liquidation: the position disappears without an order from the account.
    function wipePosition(uint256 perpId, uint256 accountId) external {
        delete _pos[perpId][accountId];
        _setBit(accountId, perpId, false);
    }

    function setMarkValid(uint256 perpId, bool valid) external {
        perps[perpId].markValid = valid;
    }

    function setFillBps(uint256 bps) external {
        fillBps = bps;
    }

    function setMinAccountOpen(uint256 v) external {
        minAccountOpen = v;
    }

    /// Set any account's position directly (used for leaders).
    function setPosition(uint256 perpId, uint256 accountId, uint8 side, uint256 lots) external {
        Perp memory p = perps[perpId];
        _pos[perpId][accountId] = Pos(side, lots, p.mark, _notional(perpId, lots, p.mark) / 5);
        _setBit(accountId, perpId, lots != 0);
    }

    // ---- exchange surface ----------------------------------------------------------------------

    function createAccount(uint256 amountCNS) external returns (uint256 id) {
        require(accountOf[msg.sender] == 0, "exists");
        require(amountCNS >= minAccountOpen, "min open");
        token.transferFrom(msg.sender, address(this), amountCNS);
        id = nextAccountId++;
        accountOf[msg.sender] = id;
        addrOf[id] = msg.sender;
        balanceOf[id] = amountCNS;
    }

    function depositCollateral(uint256 amountCNS) external {
        uint256 id = accountOf[msg.sender];
        require(id != 0, "no account");
        token.transferFrom(msg.sender, address(this), amountCNS);
        balanceOf[id] += amountCNS;
    }

    function withdrawCollateral(uint256 amountCNS) external {
        uint256 id = accountOf[msg.sender];
        require(id != 0, "no account");
        require(balanceOf[id] >= amountCNS, "insufficient");
        balanceOf[id] -= amountCNS;
        token.transfer(msg.sender, amountCNS);
    }

    function execOrder(IPerplExchange.OrderDesc memory d) external returns (IPerplExchange.OrderSignature memory) {
        uint256 id = accountOf[msg.sender];
        require(id != 0, "no account");
        require(d.immediateOrCancel, "only IOC in mock");
        lastOrderDescId = d.orderDescId;
        lastOrder = d;
        Perp memory p = perps[d.perpId];
        require(bytes(p.symbol).length != 0, "bad perp");

        bool bid = d.orderType == 0 || d.orderType == 3;
        bool crosses = bid ? d.pricePNS >= p.mark : d.pricePNS <= p.mark;
        if (!crosses) return IPerplExchange.OrderSignature(0, 0);
        uint256 lots = d.lotLNS * fillBps / 10_000;
        if (lots == 0) return IPerplExchange.OrderSignature(0, 0);
        uint256 fee = _notional(d.perpId, lots, p.mark) * feeBps / 10_000;
        require(balanceOf[id] >= fee, "fee");
        balanceOf[id] -= fee;

        if (d.orderType == 0 || d.orderType == 1) {
            uint8 side = d.orderType == 0 ? 0 : 1;
            require(d.leverageHdths > 0, "leverage");
            Pos storage pos = _pos[d.perpId][id];
            if (pos.lots != 0 && pos.side != side) {
                uint256 reduce = lots < pos.lots ? lots : pos.lots;
                _reduce(d.perpId, id, reduce, p.mark);
                lots -= reduce;
                if (lots == 0) return IPerplExchange.OrderSignature(0, 0);
            }
            uint256 margin = _notional(d.perpId, lots, p.mark) * 100 / d.leverageHdths;
            require(balanceOf[id] >= margin, "insufficient margin");
            balanceOf[id] -= margin;
            pos = _pos[d.perpId][id];
            if (pos.lots == 0) {
                _pos[d.perpId][id] = Pos(side, lots, p.mark, margin);
            } else {
                pos.entry = (pos.entry * pos.lots + p.mark * lots) / (pos.lots + lots);
                pos.lots += lots;
                pos.deposit += margin;
            }
            _setBit(id, d.perpId, true);
        } else if (d.orderType == 2 || d.orderType == 3) {
            uint8 side = d.orderType == 2 ? 0 : 1;
            Pos storage pos = _pos[d.perpId][id];
            require(pos.lots != 0 && pos.side == side, "nothing to close");
            uint256 reduce = lots < pos.lots ? lots : pos.lots;
            _reduce(d.perpId, id, reduce, p.mark);
        } else {
            revert("unsupported type");
        }
        return IPerplExchange.OrderSignature(0, 0);
    }

    function getAccountById(uint256 id) external view returns (IPerplExchange.AccountInfo memory a) {
        a.accountId = id;
        a.balanceCNS = balanceOf[id];
        a.accountAddr = addrOf[id];
        uint256[4] memory b = _bits[id];
        a.positions = IPerplExchange.PositionBitMap(b[0], b[1], b[2], b[3]);
    }

    function getAccountByAddr(address who) external view returns (IPerplExchange.AccountInfo memory a) {
        return this.getAccountById(accountOf[who]);
    }

    function getPositionV2(uint256 perpId, uint256 accountId)
        external
        view
        returns (IPerplExchange.PositionInfoV2 memory info, uint256 mark, bool valid)
    {
        Perp memory p = perps[perpId];
        Pos memory pos = _pos[perpId][accountId];
        mark = p.mark;
        valid = p.markValid;
        if (pos.lots == 0) return (info, mark, valid);
        info.accountId = accountId;
        info.positionType = pos.side;
        info.depositCNS = pos.deposit;
        info.pricePNS = pos.entry;
        info.lotLNS = pos.lots;
        info.deltaPnlCNS = _pnl(perpId, pos, p.mark);
        info.pnlCNS = info.deltaPnlCNS;
    }

    function getPerpetualInfoV2(uint256 perpId) external view returns (IPerplExchange.PerpetualInfoV2 memory info) {
        Perp memory p = perps[perpId];
        info.symbol = p.symbol;
        info.name = p.symbol;
        info.lotDecimals = p.lotDecimals;
        info.priceDecimals = p.priceDecimals;
        info.markPNS = p.mark;
        info.oraclePNS = p.oracle;
        info.oracleTimestampSec = p.oracleTs;
        info.refPriceMaxAgeSec = refPriceMaxAgeSec;
        info.ignOracle = p.ignOracle;
    }

    function getMinAccountOpenCNS() external view returns (uint256) {
        return minAccountOpen;
    }

    // ---- internals -----------------------------------------------------------------------------

    function _reduce(uint256 perpId, uint256 id, uint256 lots, uint256 mark) internal {
        Pos storage pos = _pos[perpId][id];
        uint256 depositShare = pos.deposit * lots / pos.lots;
        int256 pnl = _pnl(perpId, Pos(pos.side, lots, pos.entry, depositShare), mark);
        int256 back = int256(depositShare) + pnl;
        if (back > 0) balanceOf[id] += uint256(back);
        pos.lots -= lots;
        pos.deposit -= depositShare;
        if (pos.lots == 0) {
            delete _pos[perpId][id];
            _setBit(id, perpId, false);
        }
    }

    function _pnl(uint256 perpId, Pos memory pos, uint256 mark) internal view returns (int256) {
        Perp memory p = perps[perpId];
        int256 diff = int256(mark) - int256(pos.entry);
        if (pos.side == 1) diff = -diff;
        return diff * int256(pos.lots) * 1e6 / int256(10 ** (uint256(p.lotDecimals) + p.priceDecimals));
    }

    function _notional(uint256 perpId, uint256 lots, uint256 mark) internal view returns (uint256) {
        Perp memory p = perps[perpId];
        return lots * mark * 1e6 / 10 ** (uint256(p.lotDecimals) + p.priceDecimals);
    }

    function _setBit(uint256 id, uint256 perpId, bool on) internal {
        uint256 bank = perpId / 256;
        uint256 mask = 1 << (perpId % 256);
        if (on) _bits[id][bank] |= mask;
        else _bits[id][bank] &= ~mask;
    }
}
