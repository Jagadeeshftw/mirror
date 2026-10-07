import { Replay } from './backtest.js';
import type { BtEvent, BtMarket, BtParams, BtResult } from './backtest-types.js';

const DAY = 86_400;

/** Max drawdown of an equity series (starting from `start`): absolute and in bps of the peak (floored). */
export function maxDrawdown(start: bigint, points: bigint[]): { cns: bigint; bps: number } {
  let peak = start;
  let best = 0n;
  let bestBps = 0;
  for (const eq of points) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > best) {
      best = dd;
      bestBps = peak > 0n ? Number((dd * 10_000n) / peak) : 0;
    }
  }
  return { cns: best, bps: bestBps };
}

/** End-of-day equity for every UTC day from startTs to endTs (carried forward; the deposit before any event). */
export function dailyCurve(start: bigint, curve: Array<{ t: number; eq: bigint }>, startTs: number, endTs: number) {
  const out: BtResult['equityCurve'] = [];
  let i = 0;
  let eq = start;
  for (let day = Math.floor(startTs / DAY); day <= Math.floor(endTs / DAY); day++) {
    const end = (day + 1) * DAY;
    while (i < curve.length && curve[i]!.t < end) eq = curve[i++]!.eq;
    out.push({ day, date: new Date(day * DAY * 1000).toISOString().slice(0, 10), equityCNS: eq.toString() });
  }
  return out;
}

/**
 * "What if I had followed": replays the leader's position events in (block, timestamp) order through the
 * follower's MirrorAccount rules (the planner's planCopy, classifyOpen and classifyClose), filling every copy
 * at the leader's price moved by `slippageBps` against the follower and charging `takerFeeBps`. Funding is
 * ignored. Pure and deterministic: the same inputs always give the same result.
 */
export function runBacktest(events: BtEvent[], markets: BtMarket[], p: BtParams): BtResult {
  const byId = new Map(markets.map((m) => [m.perpId, m]));
  const r = new Replay(p, byId);
  const ordered = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.timestamp >= p.startTs && e.timestamp <= p.endTs)
    .sort((a, b) => a.e.block - b.e.block || a.e.timestamp - b.e.timestamp || a.i - b.i)
    .map(({ e }) => e);
  for (const e of ordered) r.step(e);
  const { openPositions } = r.finish();
  const final = r.curve.at(-1)!.eq;
  const dd = maxDrawdown(p.depositCNS, r.curve.map((c) => c.eq));
  const pnl = final - p.depositCNS;
  const blockedTotal = Object.values(r.blocked).reduce((a, b) => a + b, 0);
  return {
    simulation: true,
    depositCNS: p.depositCNS.toString(),
    finalEquityCNS: final.toString(),
    pnlCNS: pnl.toString(),
    pnlPct: p.depositCNS > 0n ? Number((pnl * 1_000_000n) / p.depositCNS) / 10_000 : 0,
    feesCNS: r.totals().fees.toString(),
    maxDrawdownCNS: dd.cns.toString(),
    maxDrawdownBps: dd.bps,
    tradesCopied: r.copied,
    tradesBlocked: r.blocked,
    tradesBlockedTotal: blockedTotal,
    skipped: r.skipped,
    stops: r.stops,
    equityCurve: dailyCurve(p.depositCNS, r.curve, p.startTs, p.endTs),
    openPositions,
    trades: r.trades,
    eventsReplayed: ordered.length,
  };
}

/** Plain-language assumptions returned with every backtest. */
export function backtestAssumptions(p: BtParams, slippageSource: string): string[] {
  const a = [
    'This is a simulation of past trades, not a record of real copies. Past results do not predict future results.',
    "Every leader position event is replayed in chain order; the follower copies it with the same rules the MirrorAccount contract applies (ratio target, max leverage, slippage bound, entry filter, per-market max notional, leader budget, leader loss stop, daily loss and drawdown stops).",
    `Each copy fills at the leader's own fill price moved ${p.slippageBps} bps against the follower (${slippageSource}), never past the order's limit price.`,
    `A taker fee of ${p.takerFeeBps} bps of notional is charged on every fill, opens and closes. Funding payments are ignored.`,
    "The leader's fill price is used as the mark price at that moment; open positions are valued at the last known price of each market.",
    'Copies are assumed to always find liquidity at that price (no thin-book shrinking or skipping, no partial fills).',
    'Leader events whose size or price is unknown (positions opened before the indexed history) are skipped, and markets outside your policy are not copied.',
    'The follower account is never liquidated in the simulation; margin is tracked only for the budget check and available collateral.',
  ];
  if (p.stopLossPct || p.takeProfitPct) {
    a.push("Stop-loss / take-profit levels are placed at the given percentage from the follower's average entry and checked only at the leader's event prices; a fired level closes that market at the observed price and, as onchain, halts new copies there for the rest of the period.");
  }
  if (p.flattenOnStop) a.push('With flatten on stop, loss stops are checked at each leader event and close every position at the observed prices.');
  else a.push('Loss stops only block new copies (flatten on stop is off), as onchain.');
  return a;
}
