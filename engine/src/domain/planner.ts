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

/** Same as MirrorAccount._targetLots: per leader ceil(lots*ratio/1e4) on `side`, minus floor on the other side. */
export function targetLots(leaders: LeaderPosition[], side: Side): bigint {
  let plus = 0n;
  let minus = 0n;
  for (const l of leaders) {
    if (l.lots === 0n) continue;
    if (l.side === side) plus += mulDivCeil(l.lots, BigInt(l.ratioBps), BPS_ONE);
    else minus += mulDiv(l.lots, BigInt(l.ratioBps), BPS_ONE);
  }
  return plus > minus ? plus - minus : 0n;
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

/** Position notional at mark in collateral units, as MirrorAccount._notional. */
export function notionalCNS(lots: bigint, mark: bigint, lotDecimals: number, priceDecimals: number, collateralDecimals = 6) {
  return mulDiv(lots * mark, 10n ** BigInt(collateralDecimals), 10n ** BigInt(lotDecimals + priceDecimals));
}

export interface CopyTrigger {
  leaderAccountId: number;
  /** Leader's side after the event. */
  side: Side;
  /** The event increased the leader's exposure on `side` (open, increase, invert). */
  increased: boolean;
  leverageHdths: number;
  leaderRef: Hex;
}

export interface PlanInput {
  perpId: number;
  follower: Position;
  targetLong: bigint;
  targetShort: bigint;
  trigger: CopyTrigger;
  mark: bigint;
  maxSlippageBps: number;
  safetyBps: number;
  maxMatches: number;
}

export interface PlannedOrder extends MirrorOrder {
  kind: 'open' | 'close';
}

/**
 * Orders that bring a follower toward its target after a leader change, in execution order:
 *  1. if the follower holds more than its target on its side (the leader reduced, closed or flipped), close the
 *     excess, so the copy shrinks in proportion to the leader;
 *  2. if the leader increased exposure, open the shortfall on the leader's side with the leader's leverage.
 * Opens never happen on reductions, and a follower on the opposite side is closed before any open.
 * Deltas below one lot are skipped.
 */
export function planCopy(p: PlanInput): PlannedOrder[] {
  const out: PlannedOrder[] = [];
  let lots = p.follower.lots;
  const side = p.follower.side;
  const base = { perpId: p.perpId, leaderAccountId: p.trigger.leaderAccountId, maxMatches: p.maxMatches, leaderRef: p.trigger.leaderRef };
  const target = (s: Side) => (s === LONG ? p.targetLong : p.targetShort);

  if (lots > 0n) {
    const t = target(side);
    if (lots > t) {
      const orderType = closeTypeFor(side);
      out.push({ ...base, kind: 'close', orderType, lotLNS: lots - t, leverageHdths: 0, pricePNS: copyPriceBound(orderType, p.mark, p.maxSlippageBps, p.safetyBps) });
      lots = t;
    }
  }

  if (p.trigger.increased) {
    const d = p.trigger.side;
    const t = target(d);
    if ((lots === 0n || side === d) && t > lots) {
      const orderType = openTypeFor(d);
      out.push({ ...base, kind: 'open', orderType, lotLNS: t - lots, leverageHdths: p.trigger.leverageHdths, pricePNS: copyPriceBound(orderType, p.mark, p.maxSlippageBps, p.safetyBps) });
    }
  }
  return out.filter((o) => o.lotLNS >= 1n);
}

export interface OpenCheckState {
  now: number;
  paused: boolean;
  expiry: number;
  marketAllowed: boolean;
  maxNotionalCNS: bigint;
  lotDecimals: number;
  priceDecimals: number;
  leaderAllowed: boolean;
  maxLeverageHdths: number;
  follower: Position;
  markValid: boolean;
  mark: bigint;
  maxSlippageBps: number;
  leader: Position;
  target: bigint;
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
  const none = (): BlockResult => ({ reason: 'None', limit: 0n, actual: 0n });
  if (s.paused) return { reason: 'Paused', limit: 0n, actual: 0n };
  if (s.now > s.expiry) return { reason: 'Expired', limit: BigInt(s.expiry), actual: BigInt(s.now) };
  if (!s.marketAllowed) return { reason: 'MarketNotAllowed', limit: 0n, actual: BigInt(o.perpId) };
  if (!s.leaderAllowed) return { reason: 'LeaderNotAllowed', limit: 0n, actual: BigInt(o.leaderAccountId) };
  if (o.leverageHdths < MIN_LEVERAGE_HDTHS) return { reason: 'LeverageTooLow', limit: BigInt(MIN_LEVERAGE_HDTHS), actual: BigInt(o.leverageHdths) };
  if (o.leverageHdths > s.maxLeverageHdths) return { reason: 'LeverageTooHigh', limit: BigInt(s.maxLeverageHdths), actual: BigInt(o.leverageHdths) };
  if (s.follower.lots !== 0n && s.follower.side !== orderSide) return { reason: 'FlipNotAllowed', limit: 0n, actual: s.follower.lots };
  if (!s.markValid) return { reason: 'StaleMark', limit: 0n, actual: 0n };
  const slip = priceWithinSlippage(o.orderType, o.pricePNS, s.mark, s.maxSlippageBps);
  if (!slip.ok) return { reason: 'SlippageTooHigh', limit: slip.bound, actual: o.pricePNS };
  if (s.leader.lots === 0n || s.leader.side !== orderSide) {
    return { reason: 'LeaderSideMismatch', limit: BigInt(orderSide), actual: s.leader.lots === 0n ? U256_MAX : BigInt(s.leader.side) };
  }
  const wouldBe = s.follower.lots + o.lotLNS;
  if (wouldBe > s.target) return { reason: 'ExceedsLeaderTarget', limit: s.target, actual: wouldBe };
  const notional = notionalCNS(wouldBe, s.mark, s.lotDecimals, s.priceDecimals);
  if (notional > s.maxNotionalCNS) return { reason: 'ExceedsMaxNotional', limit: s.maxNotionalCNS, actual: notional };

  const today = Math.floor(s.now / 86_400);
  const dayStart = today !== s.riskDay ? s.equity : s.dayStartEquity;
  const hwm = s.equity > s.highWaterEquity ? s.equity : s.highWaterEquity;
  if (s.dailyLossBps !== 0) {
    const floor = mulDiv(dayStart, BPS_ONE - BigInt(s.dailyLossBps), BPS_ONE);
    if (s.equity < floor) return { reason: 'DailyLossStop', limit: floor, actual: s.equity };
  }
  if (s.drawdownBps !== 0) {
    const floor = mulDiv(hwm, BPS_ONE - BigInt(s.drawdownBps), BPS_ONE);
    if (s.equity < floor) return { reason: 'DrawdownStop', limit: floor, actual: s.equity };
  }
  return none();
}
