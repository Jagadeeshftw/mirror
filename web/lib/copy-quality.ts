/**
 * Client for GET {API_BASE}/v1/stats/copy-quality?period=all|7d|30d (docs/api.md, "Copy quality").
 * Team-run copies are never in the public aggregates; the API reports them under `teamRun`.
 * Missing fields stay null and render as "—", never as an invented number.
 */
import { ApiUnavailable, BLOCK_REASON_LABEL, MARKETS, isObj, num, pick, str } from "./stats";
import { API_BASE, API_CONFIGURED } from "./site";

export type Period = "7d" | "30d" | "all";
export const PERIODS: { id: Period; label: string }[] = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "All" },
];

type Json = Record<string, unknown>;
export type Dist = { samples: number | null; median: number | null; p90: number | null };

export type QualityCopy = {
  txHash: string;
  account: string | null;
  leaderAccountId: string | null;
  perpId: number | null;
  orderType: number | null;
  leaderFillPNS: string | null;
  followerFillPNS: string | null;
  deviationBps: number | null;
  latencyMs: number | null;
  latencyBlocks: number | null;
  block: number | null;
  timestamp: number | null;
  matchNow: boolean;
};

export type QualityScope = {
  copies: number | null;
  matchNowCopies: number | null;
  blocked: number | null;
  deviation: Dist & { avg: number | null; worseThanLeader: number | null };
  latencyMs: Dist;
  latencyBlocks: Dist;
  blockedByReason: { reason: string; label: string; count: number }[];
  recent: QualityCopy[];
};

export type CopyQuality = QualityScope & {
  source: string | null;
  period: string | null;
  teamRun: (QualityScope & { label: string | null }) | null;
};

/** Labels for the contract's BlockReason names, including the reasons added after the stats page shipped. */
export const REASON_LABEL: Record<string, string> = {
  ...BLOCK_REASON_LABEL,
  EntryTooFar: "Entry filter",
  MarketHeldByOtherLeader: "Market held by another leader",
  LeaderBudgetExceeded: "Leader budget",
  LeaderLossStop: "Leader loss stop",
  MarketHalted: "Market halted",
  CloseBelowTarget: "Close below target",
  LeaderDetached: "Stopped following this leader (positions kept)",
  ThinBook: "Thin book",
};

const dist = (v: unknown): Dist => {
  const o = isObj(v) ? v : {};
  return { samples: num(pick(o, "samples", "count")), median: num(pick(o, "median", "p50")), p90: num(pick(o, "p90")) };
};

const reasons = (v: unknown) => {
  const out: QualityScope["blockedByReason"] = [];
  const add = (r: string, c: number | null) => c !== null && c > 0 && out.push({ reason: r, label: REASON_LABEL[r] ?? r, count: c });
  if (Array.isArray(v)) for (const r of v) isObj(r) && add(String(pick(r, "reason") ?? "Unknown"), num(pick(r, "count")));
  else if (isObj(v)) for (const [k, c] of Object.entries(v)) add(k, num(c));
  return out.sort((a, b) => b.count - a.count);
};

const copy = (c: Json): QualityCopy | null => {
  const txHash = str(pick(c, "txHash", "tx"));
  if (!txHash) return null;
  return {
    txHash,
    account: str(pick(c, "account", "mirrorAccount")),
    leaderAccountId: str(pick(c, "leaderAccountId", "leader")),
    perpId: num(pick(c, "perpId")),
    orderType: num(pick(c, "orderType")),
    leaderFillPNS: str(pick(c, "leaderFillPNS")),
    followerFillPNS: str(pick(c, "followerFillPNS")),
    deviationBps: num(pick(c, "deviationBps")),
    latencyMs: num(pick(c, "latencyMs")),
    latencyBlocks: num(pick(c, "latencyBlocks")),
    block: num(pick(c, "block", "blockNumber")),
    timestamp: num(pick(c, "timestamp")),
    matchNow: Boolean(pick(c, "matchNow", "isMatchNow")),
  };
};

function scope(o: Json): QualityScope {
  const a = isObj(o.aggregates) ? (o.aggregates as Json) : {};
  const d = dist(a.deviationBps);
  const dv = isObj(a.deviationBps) ? (a.deviationBps as Json) : {};
  const list = Array.isArray(o.copies) ? o.copies : [];
  return {
    copies: num(a.copies),
    matchNowCopies: num(a.matchNowCopies),
    blocked: num(a.blocked),
    deviation: { ...d, avg: num(dv.avg), worseThanLeader: num(dv.worseThanLeader) },
    latencyMs: dist(a.latencyMs),
    latencyBlocks: dist(a.latencyBlocks),
    blockedByReason: reasons(o.blockedByReason),
    recent: list.filter(isObj).map(copy).filter((c): c is QualityCopy => c !== null),
  };
}

export function normaliseCopyQuality(raw: unknown): CopyQuality {
  const o = isObj(raw) ? raw : {};
  const tr = isObj(o.teamRun) ? (o.teamRun as Json) : null;
  return {
    ...scope(o),
    source: str(o.source),
    period: str(o.period),
    teamRun: tr ? { ...scope(tr), label: str(tr.label) } : null,
  };
}

export async function fetchCopyQuality(period: Period, signal?: AbortSignal): Promise<CopyQuality> {
  if (!API_CONFIGURED) throw new ApiUnavailable("API_BASE not configured");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/stats/copy-quality?period=${period}`, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiUnavailable("API unreachable");
  }
  if (!res.ok) throw new ApiUnavailable(`API returned ${res.status}`);
  return normaliseCopyQuality(await res.json());
}

/** Market symbol and price decimals: /v1/config markets first, then the built-in table. */
export type MarketMeta = Record<number, { symbol: string; priceDecimals: number }>;
export function marketsFromConfig(config: Record<string, unknown> | null): MarketMeta {
  const out: MarketMeta = {};
  for (const [id, m] of Object.entries(MARKETS)) out[Number(id)] = { symbol: m.symbol, priceDecimals: m.priceDecimals };
  const list = config && Array.isArray(config.markets) ? config.markets : [];
  for (const m of list.filter(isObj)) {
    const id = num(pick(m, "perpId", "id"));
    const dec = isObj(m.decimals) ? num(pick(m.decimals as Json, "price", "priceDecimals")) : null;
    const pd = num(pick(m, "priceDecimals")) ?? dec;
    const sym = str(pick(m, "symbol", "name"));
    if (id !== null && pd !== null && sym) out[id] = { symbol: sym, priceDecimals: pd };
  }
  return out;
}

/** Raw PNS integer string to a grouped display price, or null if the decimals are unknown. */
export function fmtPrice(pns: string | null, decimals: number | undefined): string | null {
  if (!pns || !/^\d+$/.test(pns) || decimals === undefined) return null;
  const padded = pns.padStart(decimals + 1, "0");
  const int = Number(padded.slice(0, padded.length - decimals)).toLocaleString("en-US");
  return decimals ? `${int}.${padded.slice(-decimals)}` : int;
}

/** Deviation histogram buckets (bps, + = follower worse), as in the approved design. */
export const DEV_BUCKETS: { label: string; test: (d: number) => boolean }[] = [
  { label: "≤−5", test: (d) => d <= -5 },
  { label: "−5…−2", test: (d) => d > -5 && d <= -2 },
  { label: "−2…0", test: (d) => d > -2 && d < 0 },
  { label: "0…2", test: (d) => d >= 0 && d <= 2 },
  { label: "2…5", test: (d) => d > 2 && d <= 5 },
  { label: "5…10", test: (d) => d > 5 && d <= 10 },
  { label: ">10", test: (d) => d > 10 },
];
export const BLOCK_BUCKETS: { label: string; test: (b: number) => boolean }[] = [
  { label: "1 block", test: (b) => b <= 1 },
  { label: "2 blocks", test: (b) => b === 2 },
  { label: "3 blocks", test: (b) => b === 3 },
  { label: "4+", test: (b) => b >= 4 },
];

export function bucketize(values: number[], buckets: { label: string; test: (v: number) => boolean }[]) {
  return buckets.map((b) => ({ label: b.label, count: values.filter(b.test).length }));
}

/** CSV of the loaded recent copies (what the page shows, nothing more). */
export function toCsv(rows: QualityCopy[], markets: MarketMeta): string {
  const head = ["timestamp", "txHash", "account", "leaderAccountId", "market", "orderType", "leaderFill", "followerFill", "deviationBps", "latencyBlocks", "latencyMs", "block", "matchNow"];
  const esc = (v: unknown) => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`);
  const lines = rows.map((r) => {
    const m = r.perpId !== null ? markets[r.perpId] : undefined;
    return [
      r.timestamp !== null ? new Date(r.timestamp * 1000).toISOString() : null,
      r.txHash, r.account, r.leaderAccountId, m?.symbol ?? r.perpId, r.orderType,
      fmtPrice(r.leaderFillPNS, m?.priceDecimals)?.replace(/,/g, "") ?? r.leaderFillPNS,
      fmtPrice(r.followerFillPNS, m?.priceDecimals)?.replace(/,/g, "") ?? r.followerFillPNS,
      r.deviationBps, r.latencyBlocks, r.latencyMs, r.block, r.matchNow,
    ].map(esc).join(",");
  });
  return [head.join(","), ...lines].join("\n");
}
