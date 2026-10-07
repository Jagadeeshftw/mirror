import "server-only";
/** Market-level data: Perpl REST context, candles and funding, plus long/short open interest from the chain. */
import { fetchCandles, fetchContext, fetchFunding, marketId, marketSymbol } from "./rest";
import { perpetuals } from "./chain";
import { maintenanceFraction, divergence } from "./risk";
import { cns, scale } from "./format";

export type Sourced<T> = { ok: true; value: T; source: string } | { ok: false; reason: string; source: string };

export async function sourced<T>(source: string, f: () => Promise<T>): Promise<Sourced<T>> {
  try {
    return { ok: true, value: await f(), source };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unavailable", source };
  }
}

export type MarketRow = {
  perpId: number;
  symbol: string;
  priceDecimals: number;
  sizeDecimals: number;
  isOpen: boolean;
  mark: number | null;
  oracle: number | null;
  divergence: number | null;
  volume24h: number | null;
  oiBase: number | null;
  oiNotional: number | null;
  fundingRate: number | null;
  fundingIntervalSec: number | null;
  maintFraction: number | null;
  maxLeverage: number | null;
  stateAt: number | null;
  block: number | null;
};

export async function marketRows(): Promise<MarketRow[]> {
  const ctx = await fetchContext();
  return ctx.markets
    .map((m) => {
      const pd = m.config.price_decimals;
      const sd = m.config.size_decimals;
      const mark = m.state ? scale(m.state.mrk, pd) : null;
      const oracle = m.state ? scale(m.state.orl, pd) : null;
      const oiBase = m.state ? scale(m.state.oi, sd) : null;
      return {
        perpId: marketId(m),
        symbol: marketSymbol(m),
        priceDecimals: pd,
        sizeDecimals: sd,
        isOpen: m.config.is_open,
        mark,
        oracle,
        divergence: divergence(mark, oracle),
        volume24h: m.state ? cns(m.state.dva) : null,
        oiBase,
        oiNotional: oiBase !== null && mark !== null ? oiBase * mark : null,
        fundingRate: m.funding ? m.funding.rate / 1e6 : null,
        fundingIntervalSec: m.funding_interval_sec ?? null,
        maintFraction: maintenanceFraction(m.config.maintenance_margin, m.config.taker_fee),
        maxLeverage: m.config.initial_margin ? m.config.initial_margin / 100 : null,
        stateAt: m.state ? Math.floor(m.state.at.t / 1000) : null,
        block: m.state?.at.b ?? null,
      };
    })
    .sort((a, b) => a.perpId - b.perpId);
}

export type ChainOi = { perpId: number; long: number; short: number; longNotional: number; shortNotional: number; mark: number; oracle: number };

/** Long and short open interest per market from getPerpetualInfoV2. */
export async function chainOi(markets: MarketRow[]): Promise<ChainOi[]> {
  const info = await perpetuals(markets.map((m) => m.perpId));
  return info.map((p) => {
    const m = markets.find((x) => x.perpId === p.perpId)!;
    const mark = scale(p.markPNS, m.priceDecimals) ?? 0;
    const long = scale(p.longOiLNS, m.sizeDecimals) ?? 0;
    const short = scale(p.shortOiLNS, m.sizeDecimals) ?? 0;
    return { perpId: p.perpId, long, short, longNotional: long * mark, shortNotional: short * mark, mark, oracle: scale(p.oraclePNS, m.priceDecimals) ?? 0 };
  });
}

export type VolumeHistory = {
  /** Daily totals across markets, oldest first (UTC days; the last one is today so far). */
  daily: { t: number; volume: number }[];
  /** Trailing 7x24h volume per market, from hourly candles. */
  week: Record<number, number>;
};

export async function volumeHistory(markets: MarketRow[], days = 30): Promise<VolumeHistory> {
  // One request per market: hourly candles over 30 days (720 < 1024) give both the UTC-day totals and an
  // exact trailing 7x24h sum.
  const now = Date.now();
  const dayMs = 86_400_000;
  const from = Math.floor(now / dayMs) * dayMs - (days - 1) * dayMs;
  const hourlies = await Promise.all(markets.map((m) => fetchCandles(m.perpId, 3600, from, now)));
  const byDay = new Map<number, number>();
  const week: Record<number, number> = {};
  markets.forEach((m, i) => {
    week[m.perpId] = 0;
    for (const c of hourlies[i]) {
      const v = cns(c.v) ?? 0;
      const day = Math.floor(c.t / dayMs) * dayMs;
      byDay.set(day, (byDay.get(day) ?? 0) + v);
      if (c.t >= now - 7 * dayMs) week[m.perpId] += v;
    }
  });
  return { daily: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, volume]) => ({ t: t / 1000, volume })), week };
}

export type FundingHistory = Record<number, { series: { t: number; rate: number }[]; avg24h: number | null; avg7d: number | null }>;

export async function fundingHistory(markets: MarketRow[]): Promise<FundingHistory> {
  const now = Date.now();
  const from = now - 7 * 86_400_000;
  const settled = await Promise.allSettled(markets.map((m) => fetchFunding(m.perpId, from, now)));
  if (settled.every((x) => x.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  const all = settled.map((x) => (x.status === "fulfilled" ? x.value : []));
  const out: FundingHistory = {};
  markets.forEach((m, i) => {
    const series = all[i].map((e) => ({ t: Math.floor(e.at.t / 1000), rate: e.rate / 1e6 }));
    const avg = (xs: { rate: number }[]) => (xs.length ? xs.reduce((s, x) => s + x.rate, 0) / xs.length : null);
    out[m.perpId] = { series, avg24h: avg(series.filter((x) => x.t * 1000 >= now - 86_400_000)), avg7d: avg(series) };
  });
  return out;
}
