import "server-only";
/**
 * Perpl public REST API (no key), https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md
 * Units (api-docs types.md): prices and sizes are integers scaled by the market's price/size decimals,
 * amounts (`dva`, candle `v`, `tvl`) are AUSD x 1e6, funding `rate` is per funding interval in 1e-6,
 * `initial_margin` / `maintenance_margin` are leverages in hundredths (2000 = 20x = 5%).
 */

export const PERPL_API = (process.env.PERPL_API_URL ?? "https://app.perpl.xyz/api").replace(/\/$/, "");

type BlockTs = { b: number; t: number };

export type RestMarket = {
  id: number;
  perpetual_id?: number;
  name: string;
  symbol: string;
  funding_interval_sec?: number;
  config: {
    is_open: boolean;
    price_decimals: number;
    size_decimals: number;
    initial_margin: number;
    maintenance_margin: number;
    taker_fee: number;
    maker_fee: number;
  };
  state?: { at: BlockTs; orl: number; mrk: number; lst: number; bid: number; ask: number; prv: number; dv: number; dva: string; oi: number; tvl: string };
  funding?: { at: BlockTs; rate: number };
};

export type RestContext = { chain: { chain_id: number; gas?: { h?: number } }; markets: RestMarket[] };
export type Candle = { t: number; o: number; c: number; h: number; l: number; v: string; n: number };
export type FundingEvent = { at: BlockTs; feb: number; rate: number };

/**
 * In-memory cache per server instance (fresh for `revalidate` seconds, keyed by a time bucket so candle ranges
 * reuse the same entry) with the last good answer served for up to 30 min when Perpl rate-limits or fails,
 * plus a small concurrency cap: the overview makes about 23 calls and Perpl answers 429 to bursts.
 */
const memo = new Map<string, { at: number; value: unknown }>();
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await f();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function get<T>(path: string, revalidate: number, key = path): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < revalidate * 1000) return hit.value as T;
  try {
    const value = await slot(() => fetchJson<T>(path, revalidate));
    memo.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.value as T;
    throw e;
  }
}

async function fetchJson<T>(path: string, revalidate: number): Promise<T> {
  const res = await fetch(`${PERPL_API}${path}`, {
    next: { revalidate },
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Perpl REST ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchContext = () => get<RestContext>("/v1/pub/context", 15);

/** Candles of one market, oldest first. `resolution` in seconds, at most 1024 candles. */
export async function fetchCandles(marketId: number, resolution: number, fromMs: number, toMs: number, revalidate = 300) {
  const key = `candles:${marketId}:${resolution}:${Math.round((toMs - fromMs) / 3_600_000)}`;
  const r = await get<{ d: Candle[] }>(`/v1/market-data/${marketId}/candles/${resolution}/${fromMs}-${toMs}`, revalidate, key);
  return r.d ?? [];
}

/** Funding events of one market, oldest first (at most 1024 intervals). */
export async function fetchFunding(marketId: number, fromMs: number, toMs: number, revalidate = 300) {
  const key = `funding:${marketId}:${Math.round((toMs - fromMs) / 60_000)}`;
  const r = await get<{ d: FundingEvent[] }>(`/v1/market-data/${marketId}/funding/${fromMs}-${toMs}`, revalidate, key);
  // A repeat of a known `feb` is an update of the same interval (types.md): keep the last one.
  const byFeb = new Map<number, FundingEvent>();
  for (const e of r.d ?? []) byFeb.set(e.feb, e);
  return [...byFeb.values()].sort((a, b) => a.feb - b.feb);
}

export const marketId = (m: RestMarket) => m.perpetual_id ?? m.id;
export const marketSymbol = (m: RestMarket) => m.name || m.symbol || `#${marketId(m)}`;
