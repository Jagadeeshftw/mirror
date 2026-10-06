import { describe, expect, it } from "vitest";

import {
  addSample,
  deviationBps,
  isBuyOrder,
  leaderFillBasis,
  leaderFillDiffBps,
  leaderFillMismatch,
  percentile,
  sampleCount,
  weightedFillPrice,
  type Histogram,
} from "../src/lib/quality.js";

const fill = (pricePNS: bigint, lotsLNS: bigint, priceSource = "EVENT") => ({ pricePNS, lotsLNS, priceSource });

describe("copy-quality math", () => {
  it("leader fill: lots-weighted over priced events, estimates ignored", () => {
    expect(weightedFillPrice([])).toBeNull();
    expect(weightedFillPrice([fill(300000n, 100n)])).toBe(300000n);
    // 100 @ 3000.00 + 300 @ 3004.00 -> 3003.00
    expect(weightedFillPrice([fill(300000n, 100n), fill(300400n, 300n, "DERIVED_FROM_PNL")])).toBe(300300n);
    // LAST_TRADE / NONE are not execution prices
    expect(weightedFillPrice([fill(290000n, 100n, "LAST_TRADE"), fill(0n, 100n, "NONE")])).toBeNull();
    expect(weightedFillPrice([fill(290000n, 100n, "LAST_TRADE"), fill(300000n, 100n, "DERIVED_FROM_ENTRY")])).toBe(300000n);
  });

  it("order side: open long and close short buy", () => {
    expect([0, 1, 2, 3].map(isBuyOrder)).toEqual([true, false, false, true]);
  });

  it("deviation is positive when the follower got the worse price", () => {
    // buy: paid 3003 vs leader 3000 -> +10 bps worse
    expect(deviationBps(300300n, 300000n, true)).toBe(10);
    // buy: paid less -> negative (better)
    expect(deviationBps(299700n, 300000n, true)).toBe(-10);
    // sell: received 3096.90 vs leader 3100 -> +10 bps worse
    expect(deviationBps(309690n, 310000n, false)).toBe(10);
    // sell: received more -> better
    expect(deviationBps(305153n, 305000n, false)).toBe(-5);
    // rounding half away from zero: 1.5 bps -> 2, -1.5 -> -2
    expect(deviationBps(1_000_150n, 1_000_000n, true)).toBe(2);
    expect(deviationBps(1_000_150n, 1_000_000n, false)).toBe(-2);
    expect(deviationBps(null, 300000n, true)).toBeNull();
    expect(deviationBps(300000n, null, true)).toBeNull();
    expect(deviationBps(0n, 300000n, true)).toBeNull();
  });

  it("flags a keeper-reported leader fill that differs from the onchain one", () => {
    expect(leaderFillMismatch(0n, 310000n)).toBe(false); // not reported
    expect(leaderFillMismatch(310500n, null)).toBe(false); // nothing to compare with
    expect(leaderFillMismatch(310001n, 310000n)).toBe(false); // within the 1 PNS derivation tolerance
    expect(leaderFillMismatch(310002n, 310000n)).toBe(true);
    expect(leaderFillMismatch(310500n, 310000n)).toBe(true);
    expect(leaderFillDiffBps(310500n, 310000n)).toBe(16);
    expect(leaderFillDiffBps(309500n, 310000n)).toBe(-16);
    expect(leaderFillDiffBps(0n, 310000n)).toBeNull();
  });

  it("deviation basis: actual first, then reported, never for match-now", () => {
    expect(leaderFillBasis(false, 300000n, 300100n)).toEqual({ basis: "ACTUAL", pricePNS: 300000n });
    expect(leaderFillBasis(false, null, 300100n)).toEqual({ basis: "REPORTED", pricePNS: 300100n });
    expect(leaderFillBasis(false, null, 0n)).toEqual({ basis: "NONE", pricePNS: null });
    expect(leaderFillBasis(true, 300000n, 300100n)).toEqual({ basis: "NONE", pricePNS: null });
  });

  it("histogram keeps exact counts sorted by value", () => {
    let h: Histogram = { values: [], counts: [] };
    for (const v of [10, -5, 40, 10, 0, 10]) h = addSample(h, v);
    expect(h).toEqual({ values: [-5, 0, 10, 40], counts: [1, 1, 3, 1] });
    expect(sampleCount(h)).toBe(6);
  });

  it("nearest-rank percentiles", () => {
    const empty: Histogram = { values: [], counts: [] };
    expect(percentile(empty, 50)).toBeNull();
    const one = addSample(empty, 7);
    expect([percentile(one, 50), percentile(one, 90)]).toEqual([7, 7]);
    // [-5, 10, 10, 40]: median = 2nd value (lower middle), p90 = 4th
    let h = empty;
    for (const v of [40, 10, -5, 10]) h = addSample(h, v);
    expect([percentile(h, 50), percentile(h, 90)]).toEqual([10, 40]);
    // 1..10: median 5, p90 9, p100 10
    let r = empty;
    for (let i = 10; i >= 1; i--) r = addSample(r, i);
    expect([percentile(r, 50), percentile(r, 90), percentile(r, 100)]).toEqual([5, 9, 10]);
  });

  it("percentiles match a sort-based reference on random samples", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 50; run++) {
      const n = 1 + Math.floor(rand() * 60);
      const xs = Array.from({ length: n }, () => Math.floor(rand() * 41) - 20);
      let h: Histogram = { values: [], counts: [] };
      for (const x of xs) h = addSample(h, x);
      const sorted = [...xs].sort((a, b) => a - b);
      for (const p of [50, 90]) {
        expect(percentile(h, p)).toBe(sorted[Math.max(1, Math.ceil((p * n) / 100)) - 1]);
      }
    }
  });
});
