/**
 * Rolling-window aggregation over per-day rows.
 *
 * Max drawdown over a window is computed exactly from daily rows: for any point t on day D,
 * the running peak is max(peak before D, intraday running high up to t). So
 *   maxDD = max over days D of max(intradayMaxDD_D, peakBefore_D - low_D)
 * where intradayMaxDD_D is measured from a running high that starts at the day's opening value.
 */
import { max } from "./math.js";

export type DayRow = {
  readonly day: number;
  readonly trades: number;
  readonly closingTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly realizedPnlCNS: bigint;
  readonly fundingCNS: bigint;
  readonly feesCNS: bigint;
  readonly netPnlCNS: bigint;
  readonly volumeCNS: bigint;
  readonly openingNotionalCNS: bigint;
  readonly leverageNotionalSum: bigint;
  readonly startCumPnlCNS: bigint;
  readonly endCumPnlCNS: bigint;
  readonly highCumPnlCNS: bigint;
  readonly lowCumPnlCNS: bigint;
  readonly maxIntradayDrawdownCNS: bigint;
  readonly lastTradeAt: number;
};

export type WindowAgg = {
  trades: number;
  closingTrades: number;
  wins: number;
  losses: number;
  realizedPnlCNS: bigint;
  fundingCNS: bigint;
  feesCNS: bigint;
  netPnlCNS: bigint;
  volumeCNS: bigint;
  openingNotionalCNS: bigint;
  leverageNotionalSum: bigint;
  startCumPnlCNS: bigint;
  peakCumPnlCNS: bigint;
  maxDrawdownCNS: bigint;
  activeDays: number;
  lastTradeAt: number;
};

export function emptyWindow(cum: bigint): WindowAgg {
  return {
    trades: 0,
    closingTrades: 0,
    wins: 0,
    losses: 0,
    realizedPnlCNS: 0n,
    fundingCNS: 0n,
    feesCNS: 0n,
    netPnlCNS: 0n,
    volumeCNS: 0n,
    openingNotionalCNS: 0n,
    leverageNotionalSum: 0n,
    startCumPnlCNS: cum,
    peakCumPnlCNS: cum,
    maxDrawdownCNS: 0n,
    activeDays: 0,
    lastTradeAt: 0,
  };
}

/** First day included in a window of `days` ending on `asOfDay`. */
export function windowStart(asOfDay: number, days: number): number {
  return asOfDay - days + 1;
}

/**
 * Aggregate the rows that fall in [asOfDay - days + 1, asOfDay]. `currentCum` is the account's
 * cumulative net PnL now; it is the baseline when the window has no rows.
 */
export function computeWindow(rows: readonly DayRow[], asOfDay: number, days: number, currentCum: bigint): WindowAgg {
  const from = windowStart(asOfDay, days);
  const inWindow = rows.filter((r) => r.day >= from && r.day <= asOfDay).sort((a, b) => a.day - b.day);
  const first = inWindow[0];
  if (!first) return emptyWindow(currentCum);
  const w = emptyWindow(first.startCumPnlCNS);
  let peak = first.startCumPnlCNS;
  let dd = 0n;
  for (const r of inWindow) {
    w.trades += r.trades;
    w.closingTrades += r.closingTrades;
    w.wins += r.wins;
    w.losses += r.losses;
    w.realizedPnlCNS += r.realizedPnlCNS;
    w.fundingCNS += r.fundingCNS;
    w.feesCNS += r.feesCNS;
    w.netPnlCNS += r.netPnlCNS;
    w.volumeCNS += r.volumeCNS;
    w.openingNotionalCNS += r.openingNotionalCNS;
    w.leverageNotionalSum += r.leverageNotionalSum;
    if (r.trades > 0) w.activeDays += 1;
    if (r.lastTradeAt > w.lastTradeAt) w.lastTradeAt = r.lastTradeAt;
    dd = max(dd, max(r.maxIntradayDrawdownCNS, peak - r.lowCumPnlCNS));
    peak = max(peak, r.highCumPnlCNS);
  }
  w.peakCumPnlCNS = peak;
  w.maxDrawdownCNS = dd;
  return w;
}

export type TradeDelta = {
  trades: number;
  closingTrades: number;
  wins: number;
  losses: number;
  realizedPnlCNS: bigint;
  fundingCNS: bigint;
  feesCNS: bigint;
  netPnlCNS: bigint;
  volumeCNS: bigint;
  openingNotionalCNS: bigint;
  leverageNotionalSum: bigint;
  timestamp: number;
};

/** Incremental update of a window that is already current for today. */
export function applyDelta(w: WindowAgg, d: TradeDelta, cumAfter: bigint, firstTradeToday: boolean): WindowAgg {
  const peakBefore = w.peakCumPnlCNS;
  return {
    trades: w.trades + d.trades,
    closingTrades: w.closingTrades + d.closingTrades,
    wins: w.wins + d.wins,
    losses: w.losses + d.losses,
    realizedPnlCNS: w.realizedPnlCNS + d.realizedPnlCNS,
    fundingCNS: w.fundingCNS + d.fundingCNS,
    feesCNS: w.feesCNS + d.feesCNS,
    netPnlCNS: w.netPnlCNS + d.netPnlCNS,
    volumeCNS: w.volumeCNS + d.volumeCNS,
    openingNotionalCNS: w.openingNotionalCNS + d.openingNotionalCNS,
    leverageNotionalSum: w.leverageNotionalSum + d.leverageNotionalSum,
    startCumPnlCNS: w.startCumPnlCNS,
    peakCumPnlCNS: max(peakBefore, cumAfter),
    maxDrawdownCNS: max(w.maxDrawdownCNS, peakBefore - cumAfter),
    activeDays: w.activeDays + (firstTradeToday ? 1 : 0),
    lastTradeAt: Math.max(w.lastTradeAt, d.timestamp),
  };
}
