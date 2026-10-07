// Engine demo state, demo cycles (an event log of steps), SSE envelopes, follow quotes and markets mapped
// onto the app's types (engine/src/services/demo.ts, quote.ts, api/server.ts). See engineShape.ts.
import { checksum, learnLeader, marketMeta, normalizeAccount, normalizeFeedEvent } from "./engineShape";
import { leverage as fmtLev } from "./format";
import type { DemoCycle, DemoState, DemoStep, FollowQuote, MarketState, QuoteRow } from "./types";
import type { SseMessage } from "./sse";

type StepEv = { step: string; at?: number; txHash?: string; latencyMs?: number | null; reason?: string | null; error?: string; kind?: string; perpId?: number; lots?: string; leverageHdths?: number };

const TEMPLATE: Record<"trade" | "blocked", [string, string][]> = {
  trade: [["leader_open", "Demo leader opens"], ["copy_open", "Copy lands in the team-run demo account"], ["leader_close", "Demo leader closes"], ["copy_close", "Copy close follows"]],
  blocked: [["leader_open", "Demo leader opens"], ["copy_blocked", "Copy blocked onchain"], ["leader_close", "Demo leader closes again"]],
};
// Engine step name -> [template key, status].
const MAP: Record<string, [string, DemoStep["status"]]> = {
  leader_opening: ["leader_open", "running"], leader_opened: ["leader_open", "done"],
  copy_executed: ["copy_open", "done"], copy_timeout: ["copy_open", "failed"],
  holding: ["leader_close", "pending"], leader_closing: ["leader_close", "running"], leader_closed: ["leader_close", "done"],
  copy_closed: ["copy_close", "done"], copy_close_timeout: ["copy_close", "failed"],
};

/** A cycle from the engine's row ({id, kind, status, started_ms, steps: [step events]}) or the app's shape. */
export function normalizeCycle(raw: any, followerMaxLevHdths?: number | null): DemoCycle {
  const kind: "trade" | "blocked" = raw?.kind === "blocked" ? "blocked" : "trade";
  const evs: any[] = Array.isArray(raw?.steps) ? raw.steps : [];
  if (evs.length && evs.every((s) => typeof s?.key === "string" && typeof s?.status === "string")) {
    return { id: String(raw.id), kind, startedAt: Number(raw.startedAt ?? raw.started_ms ?? 0), status: raw.status ?? "running", steps: evs };
  }
  const open = evs.find((e: StepEv) => e.step === "leader_opening") as StepEv | undefined;
  const sym = marketMeta(open?.perpId)?.symbol ?? "BTC";
  const lev = open?.leverageHdths ? ` at ${fmtLev(open.leverageHdths)}` : "";
  const steps: DemoStep[] = TEMPLATE[kind].map(([key, label]) => ({
    key,
    label: key === "leader_open" ? `${label} ${open?.lots ?? 1} lot ${sym} long${lev}` : key === "copy_blocked" && followerMaxLevHdths ? `${label}: max leverage ${fmtLev(followerMaxLevHdths)}` : label,
    status: "pending",
  }));
  const byKey = (k: string) => steps.find((s) => s.key === k);
  for (const e of evs as StepEv[]) {
    let target: DemoStep | undefined;
    let status: DemoStep["status"] | undefined;
    if (e.step === "copy_blocked") [target, status] = [byKey(kind === "blocked" ? "copy_blocked" : "copy_open"), "blocked"];
    else if (e.step === "copy_executed" && kind === "blocked") [target, status] = [byKey("copy_blocked"), "done"];
    else if (MAP[e.step]) [target, status] = [byKey(MAP[e.step][0]), MAP[e.step][1]];
    else if (e.step === "failed") [target, status] = [steps.find((s) => s.status === "running") ?? steps.find((s) => s.status === "pending"), "failed"];
    if (!target || !status) continue;
    target.status = status;
    if (e.txHash) target.txHash = e.txHash as any;
    if (e.latencyMs !== null && e.latencyMs !== undefined) target.latencyMs = e.latencyMs;
    if (e.at) target.at = e.at;
    if (e.error) target.detail = e.error;
    if (status === "done" || status === "blocked") target.commitState = "finalized";
    // The next step is under way once this one is done.
    const i = steps.indexOf(target);
    if ((status === "done" || status === "blocked") && steps[i + 1]?.status === "pending" && raw?.status === "running") steps[i + 1].status = "running";
  }
  const status = raw?.status === "done" || raw?.status === "failed" ? raw.status : evs.some((e) => e.step === "done") ? "done" : evs.some((e) => e.step === "failed") ? "failed" : "running";
  return { id: String(raw?.id ?? raw?.cycleId ?? ""), kind, startedAt: Number(raw?.startedAt ?? raw?.started_ms ?? open?.at ?? 0), status, steps };
}

/** GET /v1/demo, plus the demo follower's own account view (equity, policy, positions) when fetched. */
export function normalizeDemo(raw: any, followerAccount?: any): DemoState {
  const f = raw?.follower ?? {};
  learnLeader(raw?.leader?.accountId, raw?.leader?.address);
  const base = followerAccount ?? (f.account || f.address ? { ...f, address: f.account ?? f.address } : null);
  const follower = base ? normalizeAccount({ teamRun: true, ...base }) : (null as any);
  if (follower && !follower.policy && f.maxLeverageHdths) {
    follower.policy = { maxLeverageHdths: f.maxLeverageHdths, maxSlippageBps: 0, dailyLossBps: 0, drawdownBps: 0, expiry: 0, maxEntryDeviationBps: 0, stopSlippageBps: 0, flattenOnStop: false, maxBuilderFeePer100K: 0, leaders: f.following ?? [], markets: [] };
  }
  const maxLev = follower?.policy?.maxLeverageHdths ?? f.maxLeverageHdths ?? null;
  const cycles = (raw?.cycles ?? []).map((c: any) => normalizeCycle(c, maxLev));
  const l = raw?.limits ?? {};
  const cap = Number(l.dailyCap ?? 0);
  return {
    ...raw,
    leader: { accountId: Number(raw?.leader?.accountId ?? 0), address: checksum(raw?.leader?.address), teamRun: true },
    follower,
    cycles,
    busy: raw?.busy ?? (!!raw?.running || cycles.some((c: DemoCycle) => c.status === "running")),
    limits: { perIpPerHour: Number(l.perIpPerHour ?? l.perIpHourly ?? 0), dailyCap: cap, dailyRemaining: Number(l.dailyRemaining ?? Math.max(0, cap - Number(l.usedToday ?? 0))) },
  };
}

// ---------------------------------------------------------------- SSE envelopes
const liveCycles = new Map<string, { kind?: string; status: string; started_ms?: number; steps: any[] }>();

/** Engine frames carry {type, ...}: `feed` wraps the item, `demo` is one step of a cycle, `copy` is keeper-internal. */
export function normalizeStreamMessage(m: SseMessage): SseMessage | null {
  let d: any;
  try {
    d = JSON.parse(m.data);
  } catch {
    return m;
  }
  if (m.event === "feed") return { ...m, data: JSON.stringify(normalizeFeedEvent(d?.item ?? d)) };
  if (m.event === "commit") return { ...m, data: JSON.stringify({ ...d, id: String(d?.id) }) };
  if (m.event === "demo") {
    if (Array.isArray(d?.steps)) return { ...m, data: JSON.stringify(normalizeCycle(d)) };
    const id = String(d?.cycleId ?? "");
    if (!id) return null;
    const c = liveCycles.get(id) ?? { status: "running", steps: [] };
    c.steps.push(d);
    if (d.step === "leader_opening") [c.kind, c.started_ms] = [d.kind, d.at];
    if (d.step === "done" || d.step === "failed") c.status = d.step;
    liveCycles.set(id, c);
    if (liveCycles.size > 20) liveCycles.delete(liveCycles.keys().next().value as string);
    return { ...m, data: JSON.stringify(normalizeCycle({ id, ...c })) };
  }
  if (m.event === "copy" || m.event === "stop" || m.event === "account") return null;
  return m;
}

// ---------------------------------------------------------------- quotes, markets
export function normalizeQuote(raw: any, leaderAccountId: number): FollowQuote {
  const lines: any[] = raw?.rows ?? raw?.quotes ?? [];
  const rows: QuoteRow[] = lines.map((r) => ({
    ...r,
    perpId: Number(r.perpId),
    orderType: (Number(r.orderType) === 1 ? 1 : 0) as 0 | 1,
    lotLNS: String(r.lotLNS ?? "0"),
    sizeDisplay: String(r.sizeDisplay ?? ""),
    markPNS: String(r.markPNS ?? "0"),
    pricePNS: String(r.pricePNS ?? "0"),
    expectedFillPNS: String(r.expectedFillPNS ?? r.pricePNS ?? "0"),
    notionalCNS: String(r.notionalCNS ?? "0"),
    marginCNS: String(r.marginCNS ?? "0"),
    leverageHdths: Number(r.leverageHdths ?? 0),
    wouldBlock: r.wouldBlock ?? null,
  }));
  return {
    ...raw,
    leaderAccountId: Number(raw?.leaderAccountId ?? leaderAccountId),
    rows,
    orders: raw?.orders ?? raw?.matchOrders ?? [],
    ordersEncoded: raw?.ordersEncoded ?? raw?.encodedMatchOrders,
    quotedAt: raw?.quotedAt ?? Date.now(),
  };
}

export function normalizeMarkets(raw: any): MarketState[] {
  const list: any[] = Array.isArray(raw) ? raw : (raw?.markets ?? []);
  return list.map((m) => ({
    ...m,
    perpId: Number(m.perpId),
    symbol: String(m.symbol ?? ""),
    markPNS: String(m.markPNS ?? "0"),
    oraclePNS: String(m.oraclePNS ?? "0"),
    fundingRateBps: Number(m.fundingRateBps ?? (m.fundingRatePct100k ?? 0) / 10),
    openInterestLNS: String(m.openInterestLNS ?? "0"),
    bestBidPNS: String(m.bestBidPNS ?? "0"),
    bestAskPNS: String(m.bestAskPNS ?? "0"),
  }));
}
