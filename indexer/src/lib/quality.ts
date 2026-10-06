/**
 * Copy-quality math: leader fill lookup, price deviation, latency and exact percentiles. Pure
 * functions, all prices bigint PNS; bps results are integers (rounded half away from zero).
 */
import { BPS, abs, divRound } from "./math.js";

/** Price sources that are an execution price (LAST_TRADE and NONE are not). */
export const EXACT_PRICE_SOURCES: ReadonlySet<string> = new Set(["EVENT", "DERIVED_FROM_PNL", "DERIVED_FROM_ENTRY"]);

/** Derived Perpl prices can be off by 1 PNS (see samples/derived-price-check.json). */
export const LEADER_FILL_TOLERANCE_PNS = 1n;

export type PricedFill = { pricePNS: bigint; lotsLNS: bigint; priceSource: string };

/**
 * Lots-weighted average price of the priced fills (one Perpl position event per account and market per
 * order, so usually a single fill). Null when none is priced. Fills with unknown size count once.
 */
export function weightedFillPrice(fills: readonly PricedFill[]): bigint | null {
  const priced = fills.filter((f) => f.pricePNS > 0n && EXACT_PRICE_SOURCES.has(f.priceSource));
  if (priced.length === 0) return null;
  if (priced.length === 1) return priced[0]!.pricePNS;
  let value = 0n;
  let lots = 0n;
  for (const f of priced) {
    const w = f.lotsLNS > 0n ? f.lotsLNS : 1n;
    value += f.pricePNS * w;
    lots += w;
  }
  return divRound(value, lots);
}

/** Open long and close short buy; open short and close long sell. */
export function isBuyOrder(orderTypeCode: number): boolean {
  return orderTypeCode === 0 || orderTypeCode === 3;
}

/**
 * Follower fill against the leader fill in bps, positive when the follower got the worse price:
 * paid more on a buy, received less on a sell. Null when either price is unknown.
 */
export function deviationBps(followerFillPNS: bigint | null, leaderFillPNS: bigint | null, buy: boolean): number | null {
  if (followerFillPNS === null || leaderFillPNS === null || followerFillPNS <= 0n || leaderFillPNS <= 0n) return null;
  const diff = buy ? followerFillPNS - leaderFillPNS : leaderFillPNS - followerFillPNS;
  return Number(divRound(diff * BPS, leaderFillPNS));
}

/** True when both are known and further apart than the derivation tolerance. */
export function leaderFillMismatch(reportedPNS: bigint, actualPNS: bigint | null): boolean {
  if (reportedPNS <= 0n || actualPNS === null) return false;
  return abs(reportedPNS - actualPNS) > LEADER_FILL_TOLERANCE_PNS;
}

/** (reported - actual) / actual in bps; null unless both are known. */
export function leaderFillDiffBps(reportedPNS: bigint, actualPNS: bigint | null): number | null {
  if (reportedPNS <= 0n || actualPNS === null || actualPNS <= 0n) return null;
  return Number(divRound((reportedPNS - actualPNS) * BPS, actualPNS));
}

/** Which leader fill the deviation is measured against. */
export function leaderFillBasis(
  isMatchNow: boolean,
  actualPNS: bigint | null,
  reportedPNS: bigint,
): { basis: "ACTUAL" | "REPORTED" | "NONE"; pricePNS: bigint | null } {
  if (isMatchNow) return { basis: "NONE", pricePNS: null };
  if (actualPNS !== null) return { basis: "ACTUAL", pricePNS: actualPNS };
  if (reportedPNS > 0n) return { basis: "REPORTED", pricePNS: reportedPNS };
  return { basis: "NONE", pricePNS: null };
}

// -------------------------------------------------------------------------------------------------
// Exact histograms: parallel arrays of distinct values (ascending) and their counts.
// -------------------------------------------------------------------------------------------------

export type Histogram = { values: number[]; counts: number[] };

export function addSample(h: Histogram, value: number): Histogram {
  const values = [...h.values];
  const counts = [...h.counts];
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  if (values[lo] === value) counts[lo] = counts[lo]! + 1;
  else {
    values.splice(lo, 0, value);
    counts.splice(lo, 0, 1);
  }
  return { values, counts };
}

export function sampleCount(h: Histogram): number {
  return h.counts.reduce((a, b) => a + b, 0);
}

/**
 * Nearest-rank percentile: the smallest value with at least ceil(pct/100 * n) samples at or below it.
 * The median (pct 50) of an even count is the lower middle value. Null when empty.
 */
export function percentile(h: Histogram, pct: number): number | null {
  const n = sampleCount(h);
  if (n === 0) return null;
  const rank = Math.max(1, Math.ceil((pct * n) / 100));
  let seen = 0;
  for (let i = 0; i < h.values.length; i++) {
    seen += h.counts[i]!;
    if (seen >= rank) return h.values[i]!;
  }
  return h.values[h.values.length - 1]!;
}
