import { describe, expect, it } from "vitest";

import { max, min } from "../src/lib/math.js";
import { applyDelta, computeWindow, emptyWindow, type DayRow, type TradeDelta } from "../src/lib/windows.js";

/** Deterministic PRNG so the property test is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Trade = { day: number; pnl: bigint };

function rowsFrom(trades: Trade[]): DayRow[] {
  const rows = new Map<number, DayRow & { [k: string]: unknown }>();
  let cum = 0n;
  for (const t of trades) {
    const before = cum;
    cum += t.pnl;
    const r = rows.get(t.day) ?? {
      day: t.day, trades: 0, closingTrades: 0, wins: 0, losses: 0, realizedPnlCNS: 0n, fundingCNS: 0n, feesCNS: 0n,
      netPnlCNS: 0n, volumeCNS: 0n, openingNotionalCNS: 0n, leverageNotionalSum: 0n, startCumPnlCNS: before,
      endCumPnlCNS: before, highCumPnlCNS: before, lowCumPnlCNS: before, maxIntradayDrawdownCNS: 0n, lastTradeAt: 0,
    };
    rows.set(t.day, {
      ...r,
      trades: r.trades + 1,
      netPnlCNS: r.netPnlCNS + t.pnl,
      endCumPnlCNS: cum,
      highCumPnlCNS: max(r.highCumPnlCNS, cum),
      lowCumPnlCNS: min(r.lowCumPnlCNS, cum),
      maxIntradayDrawdownCNS: max(r.maxIntradayDrawdownCNS, r.highCumPnlCNS - cum),
    });
  }
  return [...rows.values()];
}

/** Brute-force max drawdown over the cumulative path restricted to [from, to]. */
function bruteDD(trades: Trade[], from: number, to: number): bigint {
  let cum = 0n;
  let started = false;
  let peak = 0n;
  let dd = 0n;
  for (const t of trades) {
    if (t.day >= from && !started) {
      started = true;
      peak = cum;
    }
    cum += t.pnl;
    if (t.day < from || t.day > to) continue;
    peak = max(peak, cum);
    dd = max(dd, peak - cum);
  }
  return dd;
}

describe("rolling windows", () => {
  it("drawdown from day rows equals the brute-force path drawdown (property test)", () => {
    const rand = rng(42);
    for (let run = 0; run < 200; run++) {
      const trades: Trade[] = [];
      let day = 1000;
      const n = 1 + Math.floor(rand() * 60);
      for (let i = 0; i < n; i++) {
        day += Math.floor(rand() * 4);
        trades.push({ day, pnl: BigInt(Math.floor(rand() * 2000) - 1000) });
      }
      const rows = rowsFrom(trades);
      for (const days of [7, 30, 90]) {
        const asOf = day;
        const w = computeWindow(rows, asOf, days, 0n);
        expect(w.maxDrawdownCNS).toBe(bruteDD(trades, asOf - days + 1, asOf));
        const expectedNet = trades.filter((t) => t.day > asOf - days && t.day <= asOf).reduce((a, t) => a + t.pnl, 0n);
        expect(w.netPnlCNS).toBe(expectedNet);
      }
    }
  });

  it("incremental updates on the same day equal a full recompute", () => {
    const trades: Trade[] = [
      { day: 10, pnl: 500n },
      { day: 15, pnl: -200n },
      { day: 16, pnl: 100n },
    ];
    const today = 16;
    const later: Trade[] = [
      { day: 16, pnl: -400n },
      { day: 16, pnl: 250n },
    ];
    let w = computeWindow(rowsFrom(trades), today, 7, 400n);
    let cum = 400n;
    for (const t of later) {
      cum += t.pnl;
      const d: TradeDelta = {
        trades: 1, closingTrades: 0, wins: 0, losses: 0, realizedPnlCNS: 0n, fundingCNS: 0n, feesCNS: 0n,
        netPnlCNS: t.pnl, volumeCNS: 0n, openingNotionalCNS: 0n, leverageNotionalSum: 0n, timestamp: 0,
      };
      w = applyDelta(w, d, cum, false);
    }
    const full = computeWindow(rowsFrom([...trades, ...later]), today, 7, cum);
    expect(w.netPnlCNS).toBe(full.netPnlCNS);
    expect(w.maxDrawdownCNS).toBe(full.maxDrawdownCNS);
    expect(w.peakCumPnlCNS).toBe(full.peakCumPnlCNS);
    expect(w.trades).toBe(full.trades);
  });

  it("an empty window keeps the current cumulative PnL as baseline", () => {
    expect(computeWindow([], 100, 7, 123n)).toEqual(emptyWindow(123n));
  });
});
