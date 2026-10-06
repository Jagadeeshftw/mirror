/**
 * Client for the public stats endpoints of the Mirror API (docs/api.md):
 *   GET {API_BASE}/v1/stats   public traction stats, team-run excluded, paginated copies
 *   GET {API_BASE}/v1/config  chain, contracts, keeper, team-run addresses
 *   GET {API_BASE}/v1/demo    team-run demo leader / follower and recent demo cycles
 *
 * The normalisers accept the field names of docs/api.md and of the indexer's GlobalStats /
 * CopyEvent entities (indexer/schema.graphql), so small naming differences in the API do not
 * break the page. Anything missing renders as "not available", never as a made-up number.
 */
import { API_BASE, API_CONFIGURED } from "./site";

export const MARKETS: Record<number, { symbol: string; lotDecimals: number; priceDecimals: number }> = {
  1: { symbol: "BTC", lotDecimals: 5, priceDecimals: 1 },
  10: { symbol: "MON", lotDecimals: 0, priceDecimals: 6 },
  20: { symbol: "ETH", lotDecimals: 3, priceDecimals: 2 },
  31: { symbol: "SOL", lotDecimals: 3, priceDecimals: 3 },
  40: { symbol: "HYPE", lotDecimals: 2, priceDecimals: 4 },
  50: { symbol: "ZEC", lotDecimals: 4, priceDecimals: 2 },
  60: { symbol: "LIT", lotDecimals: 1, priceDecimals: 5 },
  70: { symbol: "VVV", lotDecimals: 2, priceDecimals: 4 },
  90: { symbol: "PUMP", lotDecimals: 0, priceDecimals: 6 },
  100: { symbol: "NEAR", lotDecimals: 2, priceDecimals: 4 },
  110: { symbol: "UNI", lotDecimals: 2, priceDecimals: 4 },
};

/** MirrorAccount.BlockReason, same order as the Solidity enum. */
export const BLOCK_REASONS = [
  "None",
  "Paused",
  "Expired",
  "LeaderNotAllowed",
  "LeaderSideMismatch",
  "MarketNotAllowed",
  "LeverageTooHigh",
  "SlippageTooHigh",
  "FlipNotAllowed",
  "StaleMark",
  "ExceedsLeaderTarget",
  "ExceedsMaxNotional",
  "DailyLossStop",
  "DrawdownStop",
  "LeverageTooLow",
] as const;

export const BLOCK_REASON_LABEL: Record<string, string> = {
  Paused: "Paused",
  Expired: "Policy expired",
  LeaderNotAllowed: "Leader not followed",
  LeaderSideMismatch: "Leader not on that side",
  MarketNotAllowed: "Market not allowed",
  LeverageTooHigh: "Max leverage",
  SlippageTooHigh: "Max slippage",
  FlipNotAllowed: "Flip not allowed",
  StaleMark: "Stale mark price",
  ExceedsLeaderTarget: "Above leader target",
  ExceedsMaxNotional: "Max notional per market",
  DailyLossStop: "Daily loss stop",
  DrawdownStop: "Drawdown stop",
  LeverageTooLow: "Leverage below 1x",
  Unknown: "Unknown",
};

const ORDER_TYPES = ["Open long", "Open short", "Close long", "Close short"];

export type CopyRow = {
  txHash: string;
  timestamp: number | null;
  account: string | null;
  leader: string | null;
  market: string;
  action: string;
  size: string | null;
  leverage: string | null;
  latencyMs: number | null;
  keeper: string | null;
  matchNow: boolean;
};

export type Stats = {
  accountsCreated: number | null;
  fundedAccounts: number | null;
  netDepositedAusd: number | null;
  copiesExecuted: number | null;
  copiesBlocked: number | null;
  blockedByRule: { reason: string; label: string; count: number }[];
  medianLatencyMs: number | null;
  activeFollowers7d: number | null;
  copies: CopyRow[];
  nextCursor: string | null;
  totalCopies: number | null;
  updatedAt: number | null;
  keeper: string | null;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Json | undefined, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (isObj(v)) return num(pick(v, "total", "count", "value"));
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return null;
}

/** Raw 6-decimal collateral units to AUSD. */
function cnsToAusd(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : n / 1e6;
}

function scaled(v: unknown, decimals: number): string | null {
  const s = str(v);
  if (s === null || !/^\d+$/.test(s)) return s;
  if (decimals === 0) return s;
  const padded = s.padStart(decimals + 1, "0");
  const int = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function toSeconds(v: unknown): number | null {
  if (typeof v === "string" && !/^\d+$/.test(v)) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  const n = num(v);
  if (n === null) return null;
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

function normaliseCopy(c: Json): CopyRow | null {
  const txHash = str(pick(c, "txHash", "tx", "hash", "transactionHash"));
  if (!txHash) return null;
  const perpId = num(pick(c, "perpId"));
  const mk = perpId !== null ? MARKETS[perpId] : undefined;
  const marketRaw = pick(c, "market", "symbol");
  const market =
    (typeof marketRaw === "string" ? marketRaw : isObj(marketRaw) ? str(pick(marketRaw, "symbol")) : null) ??
    mk?.symbol ??
    (perpId !== null ? `#${perpId}` : "?");

  const ot = pick(c, "orderType", "action", "side");
  let action: string;
  if (typeof ot === "number") action = ORDER_TYPES[ot] ?? String(ot);
  else if (typeof ot === "string")
    action = /^\d$/.test(ot)
      ? ORDER_TYPES[Number(ot)] ?? ot
      : ot
          .toLowerCase()
          .replace(/_/g, " ")
          .replace(/^\w/, (m) => m.toUpperCase());
  else action = "Copy";

  const sizeDisplay = str(pick(c, "sizeDisplay", "size"));
  const lots = pick(c, "filledLotsLNS", "lotLNS", "lots");
  const size = sizeDisplay ?? (mk ? scaled(lots, mk.lotDecimals) : str(lots));

  const levH = num(pick(c, "leverageHdths"));
  const leverage = levH ? `${(levH / 100).toFixed(levH % 100 === 0 ? 0 : 1)}x` : str(pick(c, "leverage"));

  const leaderRaw = pick(c, "leaderAccountId", "leader", "leaderAddress");
  const leader = isObj(leaderRaw)
    ? str(pick(leaderRaw, "accountId", "id", "address"))
    : str(leaderRaw);
  const accRaw = pick(c, "account", "mirrorAccount", "follower");
  const account = isObj(accRaw) ? str(pick(accRaw, "id", "address")) : str(accRaw);

  return {
    txHash,
    timestamp: toSeconds(pick(c, "timestamp", "time", "at", "createdAt")),
    account,
    leader,
    market,
    action,
    size,
    leverage: action.toLowerCase().startsWith("close") ? null : leverage,
    latencyMs: num(pick(c, "latencyMs", "latency")),
    keeper: str(pick(c, "keeper", "sender", "from")),
    matchNow: Boolean(pick(c, "isMatchNow", "matchNow")),
  };
}

function normaliseBlocked(v: unknown): { reason: string; label: string; count: number }[] {
  const out: { reason: string; label: string; count: number }[] = [];
  const add = (reason: string, count: number | null) => {
    if (count === null) return;
    const name = /^\d+$/.test(reason) ? BLOCK_REASONS[Number(reason)] ?? reason : reason;
    out.push({ reason: name, label: BLOCK_REASON_LABEL[name] ?? name, count });
  };
  if (Array.isArray(v)) {
    for (const r of v) if (isObj(r)) add(String(pick(r, "reason", "rule", "name") ?? "Unknown"), num(pick(r, "count", "total", "n")));
  } else if (isObj(v)) {
    for (const [k, c] of Object.entries(v)) if (!["total", "count"].includes(k)) add(k, num(c));
  }
  return out.sort((a, b) => b.count - a.count);
}

export function normaliseStats(raw: unknown): Stats {
  const root = isObj(raw) ? raw : {};
  const o = isObj(root.stats) ? (root.stats as Json) : isObj(root.global) ? (root.global as Json) : root;
  const blockedRaw = pick(o, "copiesBlocked", "blocked");
  const byRule = normaliseBlocked(
    pick(o, "copiesBlockedByRule", "blockedByRule", "blockedByReason", "copiesBlockedPerRule") ??
      (isObj(blockedRaw) ? pick(blockedRaw, "byReason", "byRule", "perRule") ?? blockedRaw : undefined)
  );
  const copiesRaw = pick(root, "copies", "executedCopies", "items") ?? pick(o, "copies");
  const list = Array.isArray(copiesRaw)
    ? copiesRaw
    : isObj(copiesRaw)
      ? (pick(copiesRaw, "items", "data", "rows") as unknown[]) ?? []
      : [];
  const pageMeta = isObj(copiesRaw) ? copiesRaw : root;

  const net =
    num(pick(o, "netDepositedUsd", "netAusdDepositedDisplay", "netDepositedDisplay")) ??
    cnsToAusd(pick(o, "netDepositedCNS", "netDepositsCNS", "netAusdDeposited", "netDeposited"));

  const blockedTotal = num(blockedRaw) ?? (byRule.length ? byRule.reduce((s, r) => s + r.count, 0) : null);

  return {
    accountsCreated: num(pick(o, "accountsCreated", "mirrorAccounts", "accounts")),
    fundedAccounts: num(pick(o, "fundedAccounts", "funded")),
    netDepositedAusd: net,
    copiesExecuted: num(pick(o, "copiesExecuted", "copies_executed")) ?? (typeof copiesRaw === "number" ? copiesRaw : null),
    copiesBlocked: blockedTotal,
    blockedByRule: byRule,
    medianLatencyMs: num(pick(o, "medianLatencyMs", "latencyMedianMs", "medianLatency")),
    activeFollowers7d: num(pick(o, "activeFollowers7d", "activeFollowers", "followersActive7d")),
    copies: (list ?? []).filter(isObj).map(normaliseCopy).filter((c): c is CopyRow => c !== null),
    nextCursor: str(pick(pageMeta as Json, "nextCursor", "cursor", "next")),
    totalCopies: num(pick(pageMeta as Json, "total", "totalCount")),
    updatedAt: toSeconds(pick(o, "updatedAt", "lastUpdatedAt", "asOf")),
    keeper: str(pick(o, "keeper", "keeperAddress")),
  };
}

export class ApiUnavailable extends Error {}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  if (!API_CONFIGURED) throw new ApiUnavailable("API_BASE not configured");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiUnavailable("API unreachable");
  }
  if (!res.ok) throw new ApiUnavailable(`API returned ${res.status}`);
  return res.json();
}

export async function fetchStats(opts: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 25) });
  if (opts.cursor) q.set("cursor", opts.cursor);
  return normaliseStats(await getJson(`/v1/stats?${q}`, opts.signal));
}

export async function fetchJson(path: "/v1/config" | "/v1/demo", signal?: AbortSignal) {
  return getJson(path, signal) as Promise<Record<string, unknown>>;
}

export { pick, num, str, isObj, toSeconds };

export const shortHex = (h: string, a = 6, b = 4) => (h.length > a + b + 2 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);
