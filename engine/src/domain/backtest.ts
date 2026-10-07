import { builderFeeCNS, classifyClose, classifyOpen, mulDiv, mulDivCeil, notionalCNS, planCopy, targetLots, type PlannedOrder } from './planner.js';
import { LONG, SHORT, isBid, isOpen, type Side } from './types.js';
import type { BtEvent, BtMarket, BtParams, BtResult, BtTrade } from './backtest-types.js';

export type { BtEvent, BtMarket, BtParams, BtResult } from './backtest-types.js';

const ZERO_REF = `0x${'00'.repeat(32)}` as const;
const P100K = 100_000n;
const DAY = 86_400;

interface Pos {
  side: Side;
  lots: bigint;
  entry: bigint;
  margin: bigint;
}

/** Deterministic replay of one leader's position events through a follower MirrorAccount's rules. */
class Replay {
  private pos = new Map<number, Pos>();
  private marks = new Map<number, bigint>();
  private realized = 0n; // contract leaderRealizedCNS: realized PnL net of fees (single leader)
  private fees = 0n;
  private builderFees = 0n;
  private halted = new Set<number>();
  private paused = false;
  private leaderStopped = false;
  private riskDay = 0;
  private dayStart = 0n;
  private hwm = 0n;
  private readonly slip: bigint;
  private readonly fee: bigint;
  readonly blocked: Record<string, number> = {};
  readonly skipped: Record<string, number> = {};
  readonly stops: BtResult['stops'] = [];
  readonly trades: BtTrade[] = [];
  readonly curve: Array<{ t: number; eq: bigint }> = [];
  copied = 0;

  constructor(private readonly p: BtParams, private readonly markets: Map<number, BtMarket>) {
    this.slip = BigInt(Math.round(p.slippageBps * 10));
    this.fee = BigInt(Math.round(p.takerFeeBps * 10));
  }

  private dec(perpId: number) {
    const m = this.markets.get(perpId)!;
    return { ld: m.lotDecimals, pd: m.priceDecimals };
  }
  private notional(perpId: number, lots: bigint, px: bigint) {
    const { ld, pd } = this.dec(perpId);
    return notionalCNS(lots, px, ld, pd);
  }
  private unrealized(perpId: number, q: Pos, mark: bigint) {
    const v = this.notional(perpId, q.lots, mark > q.entry ? mark - q.entry : q.entry - mark);
    return (mark >= q.entry) === (q.side === LONG) ? v : -v;
  }
  private totalUnrealized() {
    let u = 0n;
    for (const [id, q] of this.pos) if (q.lots > 0n) u += this.unrealized(id, q, this.marks.get(id) ?? q.entry);
    return u;
  }
  private totalMargin() {
    let m = 0n;
    for (const q of this.pos.values()) m += q.margin;
    return m;
  }
  equity() {
    return this.p.depositCNS + this.realized + this.totalUnrealized();
  }
  private bump(map: Record<string, number>, k: string) {
    map[k] = (map[k] ?? 0) + 1;
  }

  /** Follower fill: the leader's price moved `slippageBps` against the follower, never past the IOC limit. */
  private fillPrice(orderType: number, px: bigint, limit?: bigint) {
    if (isBid(orderType)) {
      const f = (px * (P100K + this.slip)) / P100K;
      return limit !== undefined && f > limit ? limit : f;
    }
    const f = (px * (P100K - this.slip)) / P100K;
    return limit !== undefined && f < limit ? limit : f;
  }

  /** Builder fee on an opening fill: added notional x BUILDER_FEE_PER_100K, rounded up (closes never pay one). */
  private builderFee(perpId: number, lots: bigint, fill: bigint) {
    const { ld, pd } = this.dec(perpId);
    return builderFeeCNS(lots, fill, this.p.builderFeePer100K ?? 0, ld, pd);
  }

  private open(perpId: number, side: Side, lots: bigint, fill: bigint, lev: number, t: number) {
    const n = this.notional(perpId, lots, fill);
    const builder = this.builderFee(perpId, lots, fill);
    const fee = (n * this.fee) / P100K + builder;
    this.builderFees += builder;
    const q = this.pos.get(perpId) ?? { side, lots: 0n, entry: 0n, margin: 0n };
    q.entry = q.lots === 0n ? fill : (q.entry * q.lots + fill * lots) / (q.lots + lots);
    q.side = side;
    q.lots += lots;
    q.margin += mulDivCeil(n, 100n, BigInt(Math.max(1, lev)));
    this.pos.set(perpId, q);
    this.realized -= fee;
    this.fees += fee;
    this.trades.push({ t, perpId, action: 'open', side: side === LONG ? 'long' : 'short', lots: lots.toString(), fillPNS: fill.toString(), feeCNS: fee.toString(), pnlCNS: (-fee).toString() });
  }

  private close(perpId: number, lots: bigint, fill: bigint, t: number, action: 'close' | 'stop', note?: string) {
    const q = this.pos.get(perpId)!;
    const pnl = this.unrealized(perpId, { ...q, lots }, fill);
    const fee = (this.notional(perpId, lots, fill) * this.fee) / P100K;
    q.margin -= mulDiv(q.margin, lots, q.lots);
    q.lots -= lots;
    if (q.lots === 0n) this.pos.delete(perpId);
    this.realized += pnl - fee;
    this.fees += fee;
    this.trades.push({ t, perpId, action, side: q.side === LONG ? 'long' : 'short', lots: lots.toString(), fillPNS: fill.toString(), feeCNS: fee.toString(), pnlCNS: (pnl - fee).toString(), ...(note ? { note } : {}) });
  }

  private flattenAll(t: number, note: string) {
    for (const [id, q] of [...this.pos]) {
      const orderType = q.side === LONG ? 2 : 3;
      this.close(id, q.lots, this.fillPrice(orderType, this.marks.get(id) ?? q.entry), t, 'stop', note);
    }
  }

  /** Owner level (stop-loss / take-profit from the follower's entry): closes the market and halts it. */
  private checkLevel(perpId: number, px: bigint, t: number) {
    const q = this.pos.get(perpId);
    if (!q || q.lots === 0n) return;
    const long = q.side === LONG;
    const lvl = (pct: number | undefined, profit: boolean) => {
      if (!pct) return undefined;
      const bps = BigInt(Math.round(pct * 100));
      return mulDiv(q.entry, long === profit ? 10_000n + bps : 10_000n - bps, 10_000n);
    };
    const sl = lvl(this.p.stopLossPct, false);
    const tp = lvl(this.p.takeProfitPct, true);
    const kind = sl !== undefined && (long ? px <= sl : px >= sl) ? 'StopLoss' : tp !== undefined && (long ? px >= tp : px <= tp) ? 'TakeProfit' : undefined;
    if (!kind) return;
    this.halted.add(perpId);
    this.close(perpId, q.lots, this.fillPrice(long ? 2 : 3, px), t, 'stop', kind);
    this.stops.push({ t, kind, perpId });
  }

  /** Same as MirrorAccount._checkLossStops (persists the day start and high-water mark). */
  private lossStops(t: number, persist: boolean): string | undefined {
    const eq = this.equity();
    const today = Math.floor(t / DAY);
    const dayStart = today !== this.riskDay ? eq : this.dayStart;
    const hwm = eq > this.hwm ? eq : this.hwm;
    if (persist) {
      this.riskDay = today;
      this.dayStart = dayStart;
      this.hwm = hwm;
    }
    if (this.p.dailyLossBps && eq < mulDiv(dayStart, 10_000n - BigInt(this.p.dailyLossBps), 10_000n)) return 'DailyLoss';
    if (this.p.drawdownBps && eq < mulDiv(hwm, 10_000n - BigInt(this.p.drawdownBps), 10_000n)) return 'Drawdown';
    return undefined;
  }

  /** flattenOnStop: the stop executor's leader and account triggers, checked at each event. */
  private checkFlatten(t: number) {
    if (!this.p.flattenOnStop || this.pos.size === 0) return;
    const lossLimit = mulDiv(this.p.budgetCNS, BigInt(this.p.lossStopBps), 10_000n);
    if (this.p.lossStopBps && this.realized + this.totalUnrealized() < -lossLimit) {
      this.leaderStopped = true;
      this.flattenAll(t, 'LeaderLoss');
      this.stops.push({ t, kind: 'LeaderLoss', perpId: null });
      return;
    }
    if (this.lossStops(t, false)) {
      const kind = this.lossStops(t, true)!;
      this.flattenAll(t, kind);
      this.paused = true;
      this.stops.push({ t, kind, perpId: null });
    }
  }

  step(e: BtEvent) {
    const p = this.p;
    const rule = p.markets.find((m) => m.perpId === e.perpId);
    if (!rule || !this.markets.has(e.perpId)) return this.bump(this.skipped, 'MarketNotInPolicy');
    if (!e.lotsKnown || e.pricePNS <= 0n) return this.bump(this.skipped, 'LeaderSizeOrPriceUnknown');
    const mark = e.pricePNS;
    this.marks.set(e.perpId, mark);
    this.checkLevel(e.perpId, mark, e.timestamp);
    this.checkFlatten(e.timestamp);

    const q = this.pos.get(e.perpId) ?? { side: LONG as Side, lots: 0n, entry: 0n, margin: 0n };
    const leader = { ratioBps: p.ratioBps, side: e.side, lots: e.lotsAfter };
    const increased = (e.kind === 'OPEN' || e.kind === 'INCREASE' || e.kind === 'INVERT') && e.lotsAfter > 0n;
    const orders = planCopy({
      perpId: e.perpId, follower: { side: q.side, lots: q.lots }, holder: q.lots > 0n ? p.leaderAccountId : 0,
      holderTarget: targetLots(leader, q.side), triggerTarget: targetLots(leader, e.side),
      trigger: { leaderAccountId: p.leaderAccountId, side: e.side, increased, leverageHdths: e.leverageHdths, leaderRef: ZERO_REF, leaderFillPNS: e.pricePNS, leaderEntryPNS: e.entryPricePNS },
      mark, maxSlippageBps: p.maxSlippageBps, safetyBps: p.safetyBps, maxMatches: 100, maxEntryDeviationBps: p.maxEntryDeviationBps,
    });
    for (const o of orders) if (!this.order(o, e, rule.maxNotionalCNS, leader)) break;
    this.curve.push({ t: e.timestamp, eq: this.equity() });
  }

  /** Applies MirrorAccount's checks (planner replay) to one planned order; false stops the plan. */
  private order(o: PlannedOrder, e: BtEvent, maxNotionalCNS: bigint, leader: { ratioBps: number; side: Side; lots: bigint }): boolean {
    const p = this.p;
    const mark = e.pricePNS;
    const q = this.pos.get(e.perpId) ?? { side: LONG as Side, lots: 0n, entry: 0n, margin: 0n };
    const side: Side = o.orderType === 0 || o.orderType === 2 ? LONG : SHORT;
    const target = targetLots(leader, side);
    if (!isOpen(o.orderType)) {
      const r = classifyClose(o, { follower: { side: q.side, lots: q.lots }, leaderAllowed: true, marketLeader: p.leaderAccountId, target, markValid: true, mark, maxSlippageBps: p.maxSlippageBps });
      if (r === 'revert') return false;
      if (r.reason !== 'None') return (this.bump(this.blocked, r.reason), false);
      this.close(e.perpId, o.lotLNS, this.fillPrice(o.orderType, mark, o.pricePNS), e.timestamp, 'close');
      this.copied += 1;
      return true;
    }
    const { ld, pd } = this.dec(e.perpId);
    const r = classifyOpen(o, {
      now: e.timestamp, paused: this.paused, expiry: Number.MAX_SAFE_INTEGER, marketAllowed: true, marketHalted: this.halted.has(e.perpId),
      maxNotionalCNS, lotDecimals: ld, priceDecimals: pd, leaderAllowed: true, leaderStopped: this.leaderStopped,
      builderFeePer100K: p.builderFeePer100K ?? 0, maxBuilderFeePer100K: p.maxBuilderFeePer100K ?? p.builderFeePer100K ?? 0, maxLeverageHdths: p.maxLeverageHdths,
      follower: { side: q.side, lots: q.lots }, marketLeader: q.lots > 0n ? p.leaderAccountId : 0, markValid: true, mark, maxSlippageBps: p.maxSlippageBps,
      leader: { side: leader.side, lots: leader.lots }, leaderEntryPNS: e.entryPricePNS, maxEntryDeviationBps: p.maxEntryDeviationBps, target,
      budgetCNS: p.budgetCNS, lossStopBps: p.lossStopBps, leaderMarginCNS: this.totalMargin(), leaderUnrealizedCNS: this.totalUnrealized(),
      leaderRealizedCNS: this.realized, equity: this.equity(), riskDay: this.riskDay, dayStartEquity: this.dayStart, highWaterEquity: this.hwm,
      dailyLossBps: p.dailyLossBps, drawdownBps: p.drawdownBps,
    });
    // The contract persists the risk day / high-water mark once _checkLossStops is reached, and latches the leader stop.
    if (r.reason === 'None' || r.reason === 'DailyLossStop' || r.reason === 'DrawdownStop') this.lossStops(e.timestamp, true);
    if (r.reason === 'LeaderLossStop') this.leaderStopped = true;
    if (r.reason !== 'None') return (this.bump(this.blocked, r.reason), false);
    const fill = this.fillPrice(o.orderType, mark, o.pricePNS);
    const n = this.notional(e.perpId, o.lotLNS, fill);
    const need = mulDivCeil(n, 100n, BigInt(Math.max(1, o.leverageHdths))) + (n * this.fee) / P100K + this.builderFee(e.perpId, o.lotLNS, fill);
    if (this.equity() - this.totalMargin() < need) return (this.bump(this.skipped, 'InsufficientCollateral'), false);
    this.open(e.perpId, side, o.lotLNS, fill, o.leverageHdths, e.timestamp);
    this.copied += 1;
    return true;
  }

  finish(): Pick<BtResult, 'openPositions'> {
    for (const [id] of this.pos) {
      const last = this.markets.get(id)?.lastPricePNS;
      if (last && last > 0n) this.marks.set(id, last);
    }
    this.curve.push({ t: this.p.endTs, eq: this.equity() });
    return {
      openPositions: [...this.pos].map(([id, q]) => ({ perpId: id, side: q.side === LONG ? 'long' : 'short', lots: q.lots.toString(), entryPNS: q.entry.toString(), markPNS: (this.marks.get(id) ?? q.entry).toString() })),
    };
  }

  totals() {
    return { fees: this.fees, builderFees: this.builderFees };
  }
}

export { Replay };
