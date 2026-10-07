const BPS = 10_000n;

export interface RiskState {
  equity: bigint;
  riskDay: number;
  dayStartEquity: bigint;
  highWaterEquity: bigint;
  dailyLossBps: number;
  drawdownBps: number;
}

export interface RiskView {
  dailyLossHit: boolean;
  drawdownHit: boolean;
  /** Equity below which the daily loss stop holds new exposure (null when the rule is off). */
  dailyLossFloorCNS: string | null;
  drawdownFloorCNS: string | null;
  dayStartEquityCNS: string;
  highWaterEquityCNS: string;
}

/**
 * MirrorAccount._checkLossStops against current equity: a new UTC day restarts the day's equity at the current
 * equity, the high-water mark rises with equity, and each stop holds when equity is below its floor.
 */
export function riskView(s: RiskState, nowSec = Math.floor(Date.now() / 1000)): RiskView {
  const today = Math.floor(nowSec / 86_400);
  const dayStart = s.riskDay !== today ? s.equity : s.dayStartEquity;
  const hwm = s.equity > s.highWaterEquity ? s.equity : s.highWaterEquity;
  const dlFloor = s.dailyLossBps > 0 ? (dayStart * (BPS - BigInt(s.dailyLossBps))) / BPS : null;
  const ddFloor = s.drawdownBps > 0 ? (hwm * (BPS - BigInt(s.drawdownBps))) / BPS : null;
  return {
    dailyLossHit: dlFloor !== null && s.equity < dlFloor,
    drawdownHit: ddFloor !== null && s.equity < ddFloor,
    dailyLossFloorCNS: dlFloor?.toString() ?? null,
    drawdownFloorCNS: ddFloor?.toString() ?? null,
    dayStartEquityCNS: dayStart.toString(),
    highWaterEquityCNS: hwm.toString(),
  };
}

export interface Snapshot {
  ts: number;
  equityCNS: bigint;
  netDepositsCNS: bigint;
}

/**
 * Today's PnL: equity now minus the first snapshot of the UTC day (the last one before today when there is none
 * yet), net of deposits and withdrawals since then. Null without a baseline.
 */
export function todayPnl(equityNow: bigint, netDepositsNow: bigint, baseline: Snapshot | undefined): bigint | null {
  if (!baseline) return null;
  return equityNow - netDepositsNow - (baseline.equityCNS - baseline.netDepositsCNS);
}

/** Thins a time series to at most `max` points (the last point of each bucket; the first and last points kept). */
export function thin<T extends { t: number }>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points;
  const first = points[0]!;
  const span = points.at(-1)!.t - first.t || 1;
  const buckets = new Map<number, T>();
  // Buckets 0..max-2 (the last point lands in the last bucket and is set last), plus the first point: at most max.
  for (const p of points) buckets.set(Math.min(max - 2, Math.floor(((p.t - first.t) / span) * (max - 1))), p);
  return [...new Set([first, ...buckets.values()])];
}
