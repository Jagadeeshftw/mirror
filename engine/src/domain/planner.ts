import type { Hex } from 'viem';
import {
  BPS_ONE,
  LONG,
  SHORT,
  closeTypeFor,
  isBid,
  openTypeFor,
  type BlockReason,
  type MirrorOrder,
  type Position,
  type Side,
} from './math.js';

export interface LeaderPosition {
  ratioBps: number;
  side: Side;
  lots: bigint;
}

export const mulDiv = (a: bigint, b: bigint, d: bigint) => (a * b) / d;
export const mulDivCeil = (a: bigint, b: bigint, d: bigint) => (a * b + d - 1n) / d;

/**
 * Same as MirrorAccount._targetLots for one leader: ceil(lots*ratio/1e4) when the leader holds `side`, else 0
 * (also 0 for a leader that is not followed, passed as undefined). Targets are per leader; there is no
 * netting across leaders, because a market belongs to the one leader whose copy opened it.
 */
export function targetLots(leader: LeaderPosition | undefined, side: Side): bigint {
  if (!leader || leader.lots === 0n || leader.side !== side) return 0n;
  return mulDivCeil(leader.lots, BigInt(leader.ratioBps), BPS_ONE);
}

/** Same as MirrorAccount._priceWithinSlippage: the bound the contract enforces for `slippageBps`. */
export function contractSlippageBound(orderType: number, mark: bigint, slippageBps: number): bigint {
  return isBid(orderType)
    ? mulDiv(mark, BPS_ONE + BigInt(slippageBps), BPS_ONE)
    : mulDivCeil(mark, BPS_ONE - BigInt(slippageBps), BPS_ONE);
}

export function priceWithinSlippage(orderType: number, price: bigint, mark: bigint, slippageBps: number) {
  const bound = contractSlippageBound(orderType, mark, slippageBps);
  return { ok: isBid(orderType) ? price <= bound : price >= bound, bound };
}

/**
 * Limit price for a copy: the policy's slippage minus a safety margin, so a small mark move between planning
 * and execution does not turn the copy into a SlippageTooHigh block. Always inside the contract bound.
 */
export function copyPriceBound(orderType: number, mark: bigint, maxSlippageBps: number, safetyBps: number): bigint {
  const eff = Math.max(1, maxSlippageBps - Math.max(0, safetyBps));
  return contractSlippageBound(orderType, mark, Math.min(eff, maxSlippageBps));
}

/**
 * The entry guard's bound in MirrorAccount._checkOpen: a long may pay at most entry*(1+dev) (rounded down), a
 * short must receive at least entry*(1-dev) (rounded up). Undefined when the guard is off.
 */
export function entryBound(side: Side, leaderEntryPNS: bigint, maxEntryDeviationBps: number): bigint | undefined {
  if (maxEntryDeviationBps === 0 || leaderEntryPNS === 0n) return undefined;
  const dev = BigInt(maxEntryDeviationBps);
  return side === LONG ? mulDiv(leaderEntryPNS, BPS_ONE + dev, BPS_ONE) : mulDivCeil(leaderEntryPNS, BPS_ONE - dev, BPS_ONE);
}

/**
 * Limit price for an opening copy: the tighter of the slippage bound and the entry-guard bound (min for a long,
 * max for a short), so the IOC never fills worse than either rule allows.
 */
export function openPrice(orderType: number, mark: bigint, maxSlippageBps: number, safetyBps: number, leaderEntryPNS: bigint, maxEntryDeviationBps: number): bigint {
  const slip = copyPriceBound(orderType, mark, maxSlippageBps, safetyBps);
  const side: Side = orderType === openTypeFor(LONG) ? LONG : SHORT;
  const eb = entryBound(side, leaderEntryPNS, maxEntryDeviationBps);
  if (eb === undefined) return slip;
  return side === LONG ? (eb < slip ? eb : slip) : eb > slip ? eb : slip;
}

/** Position notional at mark in collateral units, as MirrorAccount._notional. */
export function notionalCNS(lots: bigint, mark: bigint, lotDecimals: number, priceDecimals: number, collateralDecimals = 6) {
  return mulDiv(lots * mark, 10n ** BigInt(collateralDecimals), 10n ** BigInt(lotDecimals + priceDecimals));
}

/** Margin an opening order adds to its leader's budget: notional at max(limit, mark) / leverage, rounded up. */
export function addedMarginCNS(lots: bigint, price: bigint, mark: bigint, leverageHdths: number, lotDecimals: number, priceDecimals: number) {
  const px = price > mark ? price : mark;
  return mulDivCeil(notionalCNS(lots, px, lotDecimals, priceDecimals), 100n, BigInt(Math.max(1, leverageHdths)));
}

export interface CopyTrigger {
  leaderAccountId: number;
  /** Leader's side after the event. */
  side: Side;
  /** The event increased the leader's exposure on `side` (open, increase, invert). */
  increased: boolean;
  leverageHdths: number;
  leaderRef: Hex;
  /** Leader fill price from the Perpl event (0 if the event has none); recorded in the copy proof. */
  leaderFillPNS: bigint;
  /** Leader's onchain average entry after the event (PositionInfoV2.pricePNS), for the entry guard. */
  leaderEntryPNS: bigint;
}

export interface PlanInput {
  perpId: number;
  follower: Position;
  /** MirrorAccount.marketLeader(perpId): the leader whose copy opened the follower's position (0 if none). */
  holder: number;
  /** targetLots(perpId, holder, follower.side). */
  holderTarget: bigint;
  /** targetLots(perpId, trigger leader, trigger.side). */
  triggerTarget: bigint;
  trigger: CopyTrigger;
  mark: bigint;
  maxSlippageBps: number;
  safetyBps: number;
  maxMatches: number;
  maxEntryDeviationBps: number;
}

export interface PlannedOrder extends MirrorOrder {
  kind: 'open' | 'close';
}

/**
 * Orders that bring a follower toward its target after a leader change, in execution order:
 *  1. if the changed leader holds the follower's market and the follower is above that leader's target (the
 *     leader reduced, closed or flipped), close down to the target and never below it, so the copy shrinks in
 *     proportion to the leader;
 *  2. if the leader increased exposure, open the shortfall on the leader's side with the leader's leverage.
 *     From flat any followed leader may open; otherwise only the holder adds. An opening copy for another
 *     leader on the same side is still planned so the contract records MarketHeldByOtherLeader.
 * A follower on the opposite side is closed before any open (by its holder only); deltas below one lot are
 * skipped.
 */
export function planCopy(p: PlanInput): PlannedOrder[] {
  const out: PlannedOrder[] = [];
  const t = p.trigger;
  let lots = p.follower.lots;
  const side = p.follower.side;
  let holder = lots > 0n ? p.holder : 0;
  const base = { perpId: p.perpId, maxMatches: p.maxMatches, leaderRef: t.leaderRef, leaderFillPNS: t.leaderFillPNS };

  if (lots > 0n && holder !== 0 && holder === t.leaderAccountId && lots > p.holderTarget) {
    const orderType = closeTypeFor(side);
    out.push({ ...base, kind: 'close', leaderAccountId: holder, orderType, lotLNS: lots - p.holderTarget, leverageHdths: 0, pricePNS: copyPriceBound(orderType, p.mark, p.maxSlippageBps, p.safetyBps) });
    lots = p.holderTarget;
  }
  if (lots === 0n) holder = 0;

  if (t.increased && p.triggerTarget > 0n) {
    const d = t.side;
    let want = 0n;
    if (lots === 0n) want = p.triggerTarget;
    else if (side === d) want = holder === t.leaderAccountId ? (p.triggerTarget > lots ? p.triggerTarget - lots : 0n) : p.triggerTarget;
    if (want > 0n) {
      const orderType = openTypeFor(d);
      out.push({ ...base, kind: 'open', leaderAccountId: t.leaderAccountId, orderType, lotLNS: want, leverageHdths: t.leverageHdths, pricePNS: openPrice(orderType, p.mark, p.maxSlippageBps, p.safetyBps, t.leaderEntryPNS, p.maxEntryDeviationBps) });
    }
  }
  return out.filter((o) => o.lotLNS >= 1n);
}

export interface OpenCheckState {
  now: number;
  paused: boolean;
  expiry: number;
  marketAllowed: boolean;
  marketHalted: boolean;
  maxNotionalCNS: bigint;
  lotDecimals: number;
  priceDecimals: number;
  leaderAllowed: boolean;
  leaderStopped: boolean;
  maxLeverageHdths: number;
  follower: Position;
  /** MirrorAccount.marketLeader(perpId). */
  marketLeader: number;
  markValid: boolean;
  mark: bigint;
  maxSlippageBps: number;
  leader: Position;
  leaderEntryPNS: bigint;
  maxEntryDeviationBps: number;
  target: bigint;
  budgetCNS: bigint;
  lossStopBps: number;
  /** leaderBook(leader): margin and unrealized PnL of the positions held for the leader, realized PnL. */
  leaderMarginCNS: bigint;
  leaderUnrealizedCNS: bigint;
  leaderRealizedCNS: bigint;
  equity: bigint;
  riskDay: number;
  dayStartEquity: bigint;
  highWaterEquity: bigint;
  dailyLossBps: number;
  drawdownBps: number;
}

export interface BlockResult {
  reason: BlockReason;
  limit: bigint;
  actual: bigint;
}

const MIN_LEVERAGE_HDTHS = 100;
const U256_MAX = (1n << 256n) - 1n;

/** Off-chain replay of MirrorAccount._checkOpen, in the same order, to explain a simulated block. */
export function classifyOpen(o: MirrorOrder, s: OpenCheckState): BlockResult {
  const orderSide: Side = o.orderType === 0 ? LONG : SHORT;
  const r = (reason: BlockReason, limit = 0n, actual = 0n): BlockResult => ({ reason, limit, actual });
  if (s.paused) return r('Paused');
  if (s.now > s.expiry) return r('Expired', BigInt(s.expiry), BigInt(s.now));
  if (!s.marketAllowed) return r('MarketNotAllowed', 0n, BigInt(o.perpId));
  if (s.marketHalted) return r('MarketHalted', 0n, BigInt(o.perpId));
  if (!s.leaderAllowed) return r('LeaderNotAllowed', 0n, BigInt(o.leaderAccountId));
  if (s.leaderStopped) return r('LeaderLossStop');
  if (o.leverageHdths < MIN_LEVERAGE_HDTHS) return r('LeverageTooLow', BigInt(MIN_LEVERAGE_HDTHS), BigInt(o.leverageHdths));
  if (o.leverageHdths > s.maxLeverageHdths) return r('LeverageTooHigh', BigInt(s.maxLeverageHdths), BigInt(o.leverageHdths));
  if (s.follower.lots !== 0n && s.follower.side !== orderSide) return r('FlipNotAllowed', 0n, s.follower.lots);
  if (s.follower.lots !== 0n && s.marketLeader !== o.leaderAccountId) return r('MarketHeldByOtherLeader', BigInt(o.leaderAccountId), BigInt(s.marketLeader));
  if (!s.markValid) return r('StaleMark');
  const slip = priceWithinSlippage(o.orderType, o.pricePNS, s.mark, s.maxSlippageBps);
  if (!slip.ok) return r('SlippageTooHigh', slip.bound, o.pricePNS);
  if (s.leader.lots === 0n || s.leader.side !== orderSide) {
    return r('LeaderSideMismatch', BigInt(orderSide), s.leader.lots === 0n ? U256_MAX : BigInt(s.leader.side));
  }
  const eb = entryBound(orderSide, s.leaderEntryPNS, s.maxEntryDeviationBps);
  if (s.maxEntryDeviationBps !== 0 && eb !== undefined) {
    const long = orderSide === LONG;
    if (long ? o.pricePNS > eb : o.pricePNS < eb) return r('EntryTooFar', eb, o.pricePNS);
    if (long ? s.mark > eb : s.mark < eb) return r('EntryTooFar', eb, s.mark);
  }
  const wouldBe = s.follower.lots + o.lotLNS;
  if (wouldBe > s.target) return r('ExceedsLeaderTarget', s.target, wouldBe);
  const notional = notionalCNS(wouldBe, s.mark, s.lotDecimals, s.priceDecimals);
  if (notional > s.maxNotionalCNS) return r('ExceedsMaxNotional', s.maxNotionalCNS, notional);

  const add = addedMarginCNS(o.lotLNS, o.pricePNS, s.mark, o.leverageHdths, s.lotDecimals, s.priceDecimals);
  if (s.leaderMarginCNS + add > s.budgetCNS) return r('LeaderBudgetExceeded', s.budgetCNS, s.leaderMarginCNS + add);
  if (s.lossStopBps !== 0) {
    const pnl = s.leaderRealizedCNS + s.leaderUnrealizedCNS;
    const lossLimit = mulDiv(s.budgetCNS, BigInt(s.lossStopBps), BPS_ONE);
    if (pnl < -lossLimit) return r('LeaderLossStop', lossLimit, pnl < 0n ? -pnl : 0n);
  }

  const today = Math.floor(s.now / 86_400);
  const dayStart = today !== s.riskDay ? s.equity : s.dayStartEquity;
  const hwm = s.equity > s.highWaterEquity ? s.equity : s.highWaterEquity;
  if (s.dailyLossBps !== 0) {
    const floor = mulDiv(dayStart, BPS_ONE - BigInt(s.dailyLossBps), BPS_ONE);
    if (s.equity < floor) return r('DailyLossStop', floor, s.equity);
  }
  if (s.drawdownBps !== 0) {
    const floor = mulDiv(hwm, BPS_ONE - BigInt(s.drawdownBps), BPS_ONE);
    if (s.equity < floor) return r('DrawdownStop', floor, s.equity);
  }
  return r('None');
}

export interface CloseCheckState {
  follower: Position;
  leaderAllowed: boolean;
  marketLeader: number;
  target: bigint;
  markValid: boolean;
  mark: bigint;
  maxSlippageBps: number;
}

/**
 * Off-chain replay of MirrorAccount._checkClose. Returns 'revert' where the contract reverts (nothing to close
 * on that side, or more than the position).
 */
export function classifyClose(o: MirrorOrder, s: CloseCheckState): BlockResult | 'revert' {
  const closingSide: Side = o.orderType === 2 ? LONG : SHORT;
  if (s.follower.lots === 0n || s.follower.side !== closingSide || o.lotLNS > s.follower.lots) return 'revert';
  if (!s.leaderAllowed) return { reason: 'LeaderNotAllowed', limit: 0n, actual: BigInt(o.leaderAccountId) };
  if (s.marketLeader !== o.leaderAccountId) return { reason: 'MarketHeldByOtherLeader', limit: BigInt(o.leaderAccountId), actual: BigInt(s.marketLeader) };
  const after = s.follower.lots - o.lotLNS;
  if (after < s.target) return { reason: 'CloseBelowTarget', limit: s.target, actual: after };
  if (!s.markValid) return { reason: 'StaleMark', limit: 0n, actual: 0n };
  const slip = priceWithinSlippage(o.orderType, o.pricePNS, s.mark, s.maxSlippageBps);
  if (!slip.ok) return { reason: 'SlippageTooHigh', limit: slip.bound, actual: o.pricePNS };
  return { reason: 'None', limit: 0n, actual: 0n };
}

/** Close size a keeper may send: down to the holder's target, never below it (0 when at or under target). */
export function closeLotsToTarget(followerLots: bigint, holderTarget: bigint): bigint {
  return followerLots > holderTarget ? followerLots - holderTarget : 0n;
}
