// Engine responses (docs/api.md; engine/src/services/views.ts, feed.ts) mapped onto the app's types, so
// screens never see the wire shape. The engine is the source of truth; these accept its shape (and the
// app's own shape, which passes through) and turn missing fields into safe defaults instead of crashes.
import { getAddress } from "viem";
import { ruleWithLimit } from "./blockReasons";
import { BLOCK_REASONS } from "./contracts";
import { notionalCNS } from "./format";
import { normalizeLevels } from "./levels";
import type { Address, FeedEvent, FeedPage, LeaderAttribution, MirrorAccount, OwnerAccounts, Position } from "./types";

// ---------------------------------------------------------------- context learned from other responses
type MarketMeta = { perpId: number; symbol: string; lotDecimals: number; priceDecimals: number };
const markets = new Map<number, MarketMeta>();
const leaderAddresses = new Map<number, Address>();
const leaderLabels = new Map<number, string[]>();
let depositCap = "25000000";
const teamRunAddresses = new Set<string>();

/** From /v1/config: market decimals (notional, leverage) and the deposit cap. */
export function learnConfig(cfg: { markets?: MarketMeta[]; depositCapCNS?: string; teamRun?: { addresses?: string[] } } | null | undefined) {
  for (const a of cfg?.teamRun?.addresses ?? []) teamRunAddresses.add(String(a).toLowerCase());
  for (const m of cfg?.markets ?? []) markets.set(Number(m.perpId), { perpId: Number(m.perpId), symbol: m.symbol, lotDecimals: Number(m.lotDecimals ?? 0), priceDecimals: Number(m.priceDecimals ?? 0) });
  if (cfg?.depositCapCNS) depositCap = String(cfg.depositCapCNS);
}
/** From /v1/leaders and /v1/demo: leader account id -> address (accounts and feed items only carry the id). */
export function learnLeader(accountId: unknown, address: unknown, labels?: unknown) {
  if (Array.isArray(labels) && Number(accountId) > 0) leaderLabels.set(Number(accountId), labels.map(String));
  if (typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address) && Number(accountId) > 0) leaderAddresses.set(Number(accountId), address as Address);
}
export const knowsLeader = (accountId: number) => leaderAddresses.has(Number(accountId));

/** Team-run addresses from /v1/config (demo leader and demo follower), excluded from user-facing lists. */
export const isTeamRunAddress = (a: unknown) => typeof a === "string" && teamRunAddresses.has(a.toLowerCase());
export const marketMeta = (perpId: number | null | undefined) => (perpId === null || perpId === undefined ? undefined : markets.get(Number(perpId)));

// ---------------------------------------------------------------- helpers
const str = (v: unknown, d = "0"): string => (v === null || v === undefined || v === "" ? d : String(v));
const big = (v: unknown): bigint => {
  try {
    return BigInt(str(v));
  } catch {
    return 0n;
  }
};
const numOr = <T>(v: unknown, d: T): number | T => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
const sideOf = (v: unknown): "long" | "short" => (v === 1 || String(v).toLowerCase().startsWith("s") ? "short" : "long");
export function checksum(a: unknown): Address {
  try {
    return getAddress(String(a)) as Address;
  } catch {
    return String(a ?? "") as Address;
  }
}
const ms = (t: unknown): number => {
  const n = Number(t ?? 0);
  return n > 0 && n < 1e12 ? n * 1000 : n;
};
function notional(perpId: number, lots: unknown, price: unknown): bigint | null {
  const m = markets.get(perpId);
  if (!m || lots === null || lots === undefined || price === null || price === undefined) return null;
  return notionalCNS(big(lots), big(price), m.lotDecimals, m.priceDecimals);
}

// ---------------------------------------------------------------- accounts
function position(p: any): Position {
  const perpId = Number(p.perpId);
  const mark = str(p.markPNS ?? p.entryPNS ?? p.entryPricePNS);
  const n = p.notionalCNS !== undefined ? big(p.notionalCNS) : (notional(perpId, p.lotLNS, mark) ?? 0n);
  const margin = big(p.marginCNS ?? p.depositCNS);
  return {
    perpId,
    side: sideOf(p.side),
    lotLNS: str(p.lotLNS),
    entryPNS: str(p.entryPNS ?? p.entryPricePNS),
    markPNS: mark,
    liqPNS: str(p.liqPNS),
    leverageHdths: p.leverageHdths !== undefined ? Number(p.leverageHdths) : margin > 0n ? Number((n * 100n) / margin) : 0,
    marginCNS: margin.toString(),
    notionalCNS: n.toString(),
    upnlCNS: str(p.upnlCNS ?? p.unrealizedPnlCNS),
    leaderAccountId: Number(p.leaderAccountId ?? 0),
  };
}

export function normalizeAccount(raw: any): MirrorAccount {
  const positions: Position[] = (raw?.positions ?? []).map(position);
  const margin = positions.reduce((s, p) => s + big(p.marginCNS), 0n);
  const equity = big(raw?.equityCNS ?? raw?.balanceCNS);
  const byLeader: LeaderAttribution[] = (raw?.pnl?.byLeader ?? raw?.pnlByLeader ?? []).map((l: any) => ({
    leaderAccountId: Number(l.leaderAccountId),
    realisedCNS: str(l.realisedCNS ?? l.realizedPnlCNS),
    unrealisedCNS: str(l.unrealisedCNS ?? l.unrealizedPnlCNS),
  }));
  const sum = (k: "realisedCNS" | "unrealisedCNS") => byLeader.reduce((s, l) => s + big(l[k]), 0n).toString();
  const policy = raw?.policy ?? null;
  const leaderId = Number(raw?.leader?.accountId ?? policy?.leaders?.[0]?.accountId ?? 0);
  const leaderAddr = raw?.leader?.address ?? leaderAddresses.get(leaderId);
  const withdrawable = raw?.withdrawableCNS ?? (positions.length ? (equity > margin ? equity - margin : 0n) : equity).toString();
  return {
    ...raw,
    account: checksum(raw?.account ?? raw?.address),
    owner: checksum(raw?.owner),
    salt: str(raw?.salt, "0x0000000000000000000000000000000000000000000000000000000000000000") as any,
    deployed: raw?.deployed !== false,
    perplAccountId: numOr(raw?.perplAccountId, null),
    balanceCNS: str(raw?.balanceCNS),
    equityCNS: equity.toString(),
    withdrawableCNS: str(withdrawable),
    marginCNS: str(raw?.marginCNS ?? margin),
    netDepositsCNS: str(raw?.netDepositsCNS),
    depositCapCNS: str(raw?.depositCapCNS ?? depositCap),
    actionNonce: str(raw?.actionNonce),
    paused: !!raw?.paused,
    expiry: Number(raw?.expiry ?? policy?.expiry ?? 0),
    policy,
    positions,
    pnl: {
      realisedCNS: str(raw?.pnl?.realisedCNS ?? (byLeader.length ? sum("realisedCNS") : "0")),
      unrealisedCNS: str(raw?.pnl?.unrealisedCNS ?? (byLeader.length ? sum("unrealisedCNS") : positions.reduce((s, p) => s + big(p.upnlCNS), 0n))),
      // Engine: equity now vs the first snapshot of the UTC day, net of deposits and withdrawals.
      todayCNS: str(raw?.pnl?.todayCNS ?? raw?.todayPnlCNS),
      byLeader,
    },
    leader: raw?.leader ?? (leaderId ? { accountId: leaderId, address: (leaderAddr ?? "") as Address, labels: leaderLabels.get(leaderId) ?? [] } : null),
    // Engine: `[{t (s), equityCNS}]` for the last 30 days; the app's {t (ms), v (raw units)}.
    equityHistory: Array.isArray(raw?.equityHistory)
      ? raw.equityHistory.map((p: any) => ({ t: ms(p.t), v: p.v !== undefined ? Number(p.v) : Number(big(p.equityCNS)) }))
      : undefined,
    stops: raw?.stops ?? { dailyLossHit: !!raw?.dailyLossHit, drawdownHit: !!raw?.drawdownHit },
    // Engine: `levels[]` from the LevelSet events (side "long" | "short"); `policy.markets[].halted` passes through.
    levels: normalizeLevels(raw?.levels),
    createdAt: ms(raw?.createdAt ?? raw?.createdTs ?? 0),
    teamRun: !!raw?.teamRun,
  };
}

/** Bare predicted accounts (not deployed yet, served for new owners) are not follows and are left out. */
export function normalizeOwnerAccounts(raw: any, owner: Address): OwnerAccounts {
  const list: any[] = Array.isArray(raw) ? raw : (raw?.accounts ?? []);
  return {
    owner: checksum(raw?.owner ?? owner),
    // Engine: `walletCNS`, the owner's AUSD balance read from the collateral token.
    walletBalanceCNS: raw?.walletBalanceCNS ?? raw?.walletCNS ?? undefined,
    accounts: list.filter((a) => a && a.deployed !== false && a.predicted !== true).map(normalizeAccount),
  };
}

// ---------------------------------------------------------------- feed
/** "Max leverage 5x", "Entry filter 1%": the rule with its number, where the Blocked event's limit is that number. */
function blockRule(reason: string, limit: unknown, data: Record<string, unknown> | undefined): string | undefined {
  const lim = big(limit);
  const p = { maxLeverageHdths: 0, maxEntryDeviationBps: 0, maxSlippageBps: 0, markets: [] as { perpId: number; maxNotionalCNS: string }[], dailyLossBps: 0, drawdownBps: 0 };
  if (reason === "LeverageTooHigh") p.maxLeverageHdths = Number(lim);
  else if (reason === "ExceedsMaxNotional") p.markets = [{ perpId: 0, maxNotionalCNS: lim.toString() }];
  else if (reason === "EntryTooFar") {
    const entry = big(data?.leaderEntryPNS ?? data?.leaderFillPNS);
    if (entry <= 0n) return undefined;
    p.maxEntryDeviationBps = Math.round((Math.abs(Number(lim - entry)) / Number(entry)) * 10_000);
  } else return undefined;
  return ruleWithLimit(reason, p);
}

export function normalizeFeedEvent(raw: any): FeedEvent {
  const kind = raw?.kind as FeedEvent["kind"];
  const data = (raw?.data ?? undefined) as Record<string, unknown> | undefined;
  const perpId = numOr(raw?.perpId, undefined) as number | undefined;
  const orderType = numOr(raw?.orderType, undefined) as FeedEvent["orderType"];
  const proof = raw?.proof ?? (data?.proof as any) ?? undefined;
  const reason = raw?.blocked?.reason ?? raw?.reason ?? undefined;
  const blocked =
    kind === "Blocked"
      ? raw?.blocked ?? {
          reason: String(reason ?? "Unknown"),
          reasonCode: Math.max(0, BLOCK_REASONS.indexOf(reason as any)),
          limit: str(raw?.limit),
          actual: str(raw?.actual),
          rule: blockRule(String(reason ?? ""), raw?.limit, data),
        }
      : undefined;
  // Closes carry fillPNS = 0 (the contract records fills for opens only): price them at the mark the
  // contract checked the close against instead of 0.
  const nz = (v: unknown) => (v === undefined || v === null || String(v) === "0" ? undefined : String(v));
  const fill = nz(proof?.fillPNS) ?? nz(proof?.markPNS) ?? raw?.pricePNS ?? (kind === "Blocked" ? (data?.markPNS as string | undefined) : undefined);
  const n = raw?.notionalCNS ?? (perpId !== undefined && kind === "Mirrored" ? notional(perpId, raw?.lotLNS, fill)?.toString() : undefined);
  let leverageHdths = numOr(raw?.leverageHdths, undefined) as number | undefined;
  if (kind === "Blocked" && leverageHdths === undefined && reason === "LeverageTooHigh") leverageHdths = Number(raw?.actual ?? 0);
  const leaderId = numOr(raw?.leaderAccountId, undefined) as number | undefined;
  return {
    ...raw,
    id: String(raw?.id ?? raw?.txHash ?? ""),
    kind,
    account: checksum(raw?.account),
    txHash: raw?.txHash ?? null,
    label: raw?.label ?? undefined,
    limit: raw?.limit ?? null,
    actual: raw?.actual ?? null,
    // The Blocked event's leaderFillPNS is the leader's onchain entry the entry filter checked against.
    data: kind === "Blocked" && data && data.leaderEntryPNS === undefined && data.leaderFillPNS !== undefined ? { ...data, leaderEntryPNS: data.leaderFillPNS } : data,
    proof: proof ?? undefined,
    leaderRef: raw?.leaderRef ?? undefined,
    block: Number(raw?.block ?? 0),
    timestamp: ms(raw?.timestamp),
    commitState: raw?.commitState ?? "proposed",
    latencyMs: numOr(raw?.latencyMs, undefined) as number | undefined,
    leaderBlock: numOr(raw?.leaderBlock, undefined) as number | undefined,
    latencyBlocks: numOr(raw?.latencyBlocks, undefined) as number | undefined,
    realisedPnlCNS: raw?.realisedPnlCNS ?? undefined,
    leaderLotLNS: raw?.leaderLotLNS ?? undefined,
    leaderLeverageHdths: numOr(raw?.leaderLeverageHdths, undefined) as number | undefined,
    leaderAccountId: leaderId,
    leaderAddress: raw?.leaderAddress ?? (leaderId ? leaderAddresses.get(leaderId) : undefined),
    perpId,
    orderType,
    lotLNS: raw?.lotLNS ?? undefined,
    pricePNS: fill ?? undefined,
    leverageHdths,
    notionalCNS: n ?? undefined,
    matchNow: !!raw?.matchNow,
    blocked,
    amountCNS: raw?.amountCNS ?? raw?.amount ?? undefined,
    paused: kind === "Paused" ? Boolean(raw?.paused ?? data?.paused) : raw?.paused,
    positionsClosed: raw?.positionsClosed ?? numOr(data?.positionsClosed, undefined),
    // StopTriggered: `keeper` is the event's caller (data.caller as a fallback).
    keeper: raw?.keeper ?? (typeof data?.caller === "string" ? data.caller : undefined),
    // Feed items don't carry the flag; the team-run accounts are named in /v1/config.
    teamRun: raw?.teamRun ?? (isTeamRunAddress(raw?.account) || undefined),
  } as FeedEvent;
}

export function normalizeFeedPage(raw: any): FeedPage {
  const list: any[] = raw?.events ?? raw?.items ?? (Array.isArray(raw) ? raw : []);
  const cursor = raw?.cursor ?? raw?.nextCursor ?? null;
  return { events: list.map(normalizeFeedEvent), cursor: cursor === null || cursor === undefined ? null : String(cursor) };
}
