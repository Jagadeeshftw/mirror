// The engine's /v1/leaders and /v1/leaders/:id (docs/api.md) answer with nullable stats, `openPositions`,
// `equityCurve: {t, pnlCNS}` and string risk flags; the screens use the LeaderSummary / LeaderProfile shape
// (which the dev mock serves directly). These map either shape onto the app's, without throwing on nulls.
import { isTeamRunAddress, learnLeader } from "./engineShape";
import type { LeaderPosition, LeaderProfile, LeaderSummary, LeaderTrade, RiskFlag } from "./types";

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const side = (v: unknown): "long" | "short" => (String(v ?? "").toLowerCase().startsWith("s") ? "short" : "long");

const FLAG_TEXT: Record<string, { kind: RiskFlag["kind"]; title: string; detail: string }> = {
  few_trades: { kind: "info", title: "Few trades", detail: "Not many trades in this window, so the numbers say little yet." },
  high_leverage: { kind: "warn", title: "High leverage", detail: "Average leverage above 10x." },
  large_drawdown: { kind: "warn", title: "Large drawdown", detail: "Fell more than 30% from a peak in this window." },
  liquidated_in_window: { kind: "warn", title: "Liquidated", detail: "Had a position liquidated in this window." },
  liquidated: { kind: "warn", title: "Liquidated", detail: "Had a position liquidated in this window." },
  single_market: { kind: "info", title: "One market", detail: "Trades a single market." },
  nansen_risk_label: { kind: "warn", title: "Nansen risk label", detail: "Nansen labels this wallet with a risk label." },
  cross_venue_drawdown: { kind: "warn", title: "Losing elsewhere", detail: "Down more than 20% on another venue right now." },
};

function flag(f: unknown): RiskFlag {
  if (f && typeof f === "object" && "title" in (f as any)) return f as RiskFlag;
  const k = String(f);
  return FLAG_TEXT[k] ?? { kind: "info", title: k.replace(/_/g, " "), detail: "" };
}

/** Win rate as a percent: the engine sends a 0..1 fraction; values above 1 are taken as percent already. */
export function winRatePct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? Math.round(n * 1000) / 10 : n;
}

export function normalizeLeaderSummary(raw: any): LeaderSummary {
  learnLeader(raw?.accountId, raw?.address, raw?.nansen?.labels);
  return {
    ...raw,
    accountId: num(raw?.accountId),
    address: raw?.address ?? "0x0000000000000000000000000000000000000000",
    score: num(raw?.score),
    pnlUsd: num(raw?.pnlUsd),
    pnlPct: num(raw?.pnlPct),
    maxDrawdownPct: num(raw?.maxDrawdownPct),
    // The engine sends a fraction (0.61); the app displays percent.
    winRate: winRatePct(raw?.winRate),
    avgLeverage: num(raw?.avgLeverage),
    trades: num(raw?.trades),
    markets: Array.isArray(raw?.markets) ? raw.markets.map(String) : [],
    followers: num(raw?.followers),
    nansen: { ...(raw?.nansen ?? {}), labels: Array.isArray(raw?.nansen?.labels) ? raw.nansen.labels : [] },
    teamRun: !!raw?.teamRun || isTeamRunAddress(raw?.address),
  };
}

const DAY = 86_400_000;
const monthYear = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export function normalizeLeaderProfile(raw: any): LeaderProfile {
  const base = normalizeLeaderSummary(raw);
  const positions: LeaderPosition[] = (raw?.positions ?? raw?.openPositions ?? []).map((p: any) => ({
    perpId: num(p.perpId),
    side: side(p.side),
    lotLNS: String(p.lotLNS ?? p.lotsLNS ?? "0"),
    entryPNS: String(p.entryPNS ?? p.entryPricePNS ?? "0"),
    markPNS: String(p.markPNS ?? p.entryPNS ?? p.entryPricePNS ?? "0"),
    leverageHdths: num(p.leverageHdths),
    pnlUsd: p.pnlUsd !== undefined ? num(p.pnlUsd) : num(p.unrealizedPnlCNS) / 1e6,
  }));
  const rawTrades: any[] = raw?.recentTrades ?? [];
  const recentTrades: LeaderTrade[] = rawTrades.map((t: any) => ({
    perpId: num(t.perpId),
    side: side(t.side),
    action: t.action ?? (/close|decrease|liquidat/i.test(String(t.kind ?? "")) ? "close" : "open"),
    lotLNS: String(t.lotLNS ?? t.lotsAfter ?? "0"),
    pricePNS: String(t.pricePNS ?? "0"),
    leverageHdths: num(t.leverageHdths),
    timestamp: t.timestamp ?? num(t.t) * 1000,
    txHash: t.txHash,
  }));
  const now = Date.now();
  // Equity curve: the app's {t, v} points, or the engine's {t (s), equityCNS | pnlCNS}; at least two points.
  const rawCurve: any[] = raw?.equityCurve ?? [];
  let curve: { t: number; v: number }[] = rawCurve.map((p: any) => ({ t: p.t > 1e12 ? p.t : num(p.t) * 1000, v: p.v !== undefined ? num(p.v) : num(p.equityCNS ?? p.pnlCNS) / 1e6 }));
  // Max drawdown window from the engine's per-point drawdownCNS: the deepest point and the peak before it.
  let drawdown: LeaderProfile["drawdown"] = raw?.drawdown ?? null;
  if (!drawdown && rawCurve.some((p) => num(p.drawdownCNS) > 0)) {
    let to = 0;
    rawCurve.forEach((p, i) => { if (num(p.drawdownCNS) > num(rawCurve[to].drawdownCNS)) to = i; });
    let from = to;
    while (from > 0 && num(rawCurve[from].drawdownCNS) > 0) from--;
    const fromT = curve[from].t;
    const toT = curve[to].t;
    drawdown = { fromT, toT, pct: base.maxDrawdownPct, days: Math.max(1, Math.round((toT - fromT) / DAY)) };
  }
  if (curve.length < 2) {
    const v = curve[0]?.v ?? 0;
    curve = [{ t: now - 30 * DAY, v }, { t: now, v }];
  }
  // Trades per day over the last 30 days, from the trades the engine lists when it doesn't serve the series.
  let perDay: { t: number; n: number }[] = Array.isArray(raw?.tradesPerDay) ? raw.tradesPerDay : [];
  if (perDay.length < 2) {
    const d0 = Math.floor(now / DAY) * DAY - 29 * DAY;
    perDay = Array.from({ length: 30 }, (_, i) => ({ t: d0 + i * DAY, n: 0 }));
    for (const t of recentTrades) {
      const i = Math.floor((t.timestamp - d0) / DAY);
      if (i >= 0 && i < 30) perDay[i].n++;
    }
  }
  let share: { symbol: string; pct: number }[] = Array.isArray(raw?.marketShare) ? raw.marketShare : [];
  if (!share.length && rawTrades.length) {
    const by = new Map<string, number>();
    for (const t of rawTrades) {
      const sym = String(t.symbol ?? t.perpId);
      by.set(sym, (by.get(sym) ?? 0) + 1);
    }
    share = [...by].map(([symbol, n]) => ({ symbol, pct: Math.round((n / rawTrades.length) * 100) }));
  }
  const pnls = rawTrades.map((t) => num(t.realizedPnlCNS ?? t.realisedPnlCNS) / 1e6).filter((v) => v !== 0);
  const wins = pnls.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const losses = -pnls.filter((v) => v < 0).reduce((a, b) => a + b, 0);
  const st = raw?.stats ?? {};
  const win = (raw?.windows ?? []).find((w: any) => w.window === ({ "7d": "D7", "30d": "D30", "90d": "D90" } as Record<string, string>)[String(raw?.window ?? "30d")]);
  const peak = Math.max(0, ...positions.map((p) => p.leverageHdths / 100), ...recentTrades.map((t) => t.leverageHdths / 100));
  const first = num(st.firstTradeAt) * 1000 || (recentTrades.length ? Math.min(...recentTrades.map((t) => t.timestamp)) : 0);
  const cross = raw?.nansen?.crossVenue;
  return {
    ...raw,
    ...base,
    nansen: {
      ...base.nansen,
      notes: raw?.nansen?.notes ?? (Array.isArray(raw?.notes) ? raw.notes.map((text: string) => ({ label: "Note", text: String(text) })) : []),
      venues: raw?.nansen?.venues ?? (cross?.venue ? [{ venue: String(cross.venue), since: String(cross.since ?? ""), realisedPnlUsd: num(cross.realisedPnlUsd) }] : []),
    },
    since: raw?.since ?? (first ? monthYear(first) : ""),
    equityCurve: curve,
    drawdown,
    stats: {
      profitFactor: num(st.profitFactor, losses > 0 ? Math.round((wins / losses) * 100) / 100 : 0),
      largestLossUsd: num(st.largestLossUsd, st.largestLossCNS !== undefined && st.largestLossCNS !== null ? num(st.largestLossCNS) / 1e6 : pnls.length ? Math.min(0, ...pnls) : 0),
      peakLeverage: num(st.peakLeverage, Math.round(peak * 10) / 10),
      tradesPerDay: num(st.tradesPerDay, win && num(win.activeDays) > 0 ? Math.round((num(win.trades) / num(win.activeDays)) * 10) / 10 : Math.round((perDay.reduce((s, x) => s + x.n, 0) / perDay.length) * 10) / 10),
      // Engine: avgHoldSec from the leader's position events (flat to flat, per market).
      avgHoldMinutes: num(st.avgHoldMinutes, st.avgHoldSec !== undefined && st.avgHoldSec !== null ? Math.round(num(st.avgHoldSec) / 60) : 0),
    },
    marketShare: share,
    tradesPerDay: perDay,
    positions,
    recentTrades,
    riskFlags: (raw?.riskFlags ?? []).map(flag),
    updatedAt: raw?.updatedAt ?? now,
  };
}
