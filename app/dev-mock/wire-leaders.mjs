// Leaderboard and leader profile in the engine's indexer-backed shape (engine/src/services/leaders.ts:
// list() and fromIndexerProfile()). The mock's curated leaders are kept in app shape and converted here.
const DAY = 86_400_000;
const FLAG = { "High leverage": "high_leverage", "Deep drawdown": "large_drawdown", Liquidated: "liquidated" };

export function wireLeaderSummary(s) {
  return {
    accountId: s.accountId,
    address: s.address,
    score: s.score,
    pnlUsd: s.pnlUsd,
    pnlPct: s.pnlPct,
    maxDrawdownPct: s.maxDrawdownPct,
    winRate: s.winRate,
    avgLeverage: s.avgLeverage,
    trades: s.trades,
    markets: s.markets,
    followers: s.followers,
    nansen: { labels: s.nansen?.labels ?? [], monad: null, crossVenue: null, fetchedAt: null },
    riskFlags: [],
    teamRun: !!s.teamRun,
    adversarial: s.adversarial ?? null,
  };
}

const SEC = (ms) => Math.floor(ms / 1000);

export function wireLeaderProfile(p, window = "30d", symbolOf = (id) => String(id)) {
  const pts = p.equityCurve ?? [];
  const v0 = pts[0]?.v ?? 0;
  let peak = -Infinity;
  const equityCurve = pts.map((x) => {
    peak = Math.max(peak, x.v);
    return { t: SEC(x.t), pnlCNS: String(Math.round((x.v - v0) * 1e6)), equityCNS: String(Math.round(x.v * 1e6)), drawdownCNS: String(Math.round((peak - x.v) * 1e6)) };
  });
  // Trades over the window, spread like the mock's per-day counts (the engine lists the latest 50 events).
  const trades = [];
  for (const d of (p.tradesPerDay ?? []).slice(-30)) for (let i = 0; i < Math.min(d.n, 2) && trades.length < 50; i++) {
    const share = p.marketShare?.[(trades.length + i) % Math.max(1, p.marketShare.length)];
    const pos = p.positions?.[0];
    trades.push({ txHash: null, block: 0, t: SEC(d.t + (i + 1) * 3600e3), perpId: pos?.perpId ?? 1, symbol: share?.symbol ?? symbolOf(pos?.perpId ?? 1), kind: i % 2 ? "decrease" : "increase", side: pos?.side ?? "long", lotsAfter: pos?.lotLNS ?? "1", pricePNS: pos?.entryPNS ?? "0", realizedPnlCNS: i % 2 ? String(Math.round(((trades.length % 3 === 0 ? -1 : 2) * Math.abs(p.pnlUsd) / 30) * 1e6)) : "0", leverageHdths: Math.round((p.avgLeverage ?? 1) * 100) });
  }
  const peakLev = p.stats?.peakLeverage;
  if (peakLev && trades[0]) trades[0].leverageHdths = Math.round(peakLev * 100);
  const first = p.since ? Date.parse(`1 ${p.since}`) : NaN;
  return {
    source: "indexer",
    window,
    ...wireLeaderSummary(p),
    stats: {
      trades: String(p.trades), winRateBps: String(Math.round(p.winRate * 10_000)), avgLeverageHdths: String(Math.round(p.avgLeverage * 100)),
      maxDrawdownBps: String(Math.round(p.maxDrawdownPct * 100)), marketsTraded: [], followers: String(p.followers), firstTradeAt: Number.isFinite(first) ? String(SEC(first)) : null,
    },
    windows: [{ window: { "7d": "D7", "30d": "D30", "90d": "D90" }[window] ?? "D30", asOfDay: Math.floor(Date.now() / DAY), netPnlCNS: String(Math.round(p.pnlUsd * 1e6)), pnlBps: String(Math.round(p.pnlPct * 100)), volumeCNS: "0", trades: String(p.trades), winRateBps: String(Math.round(p.winRate * 10_000)), avgLeverageHdths: String(Math.round(p.avgLeverage * 100)), maxDrawdownCNS: "0", maxDrawdownBps: String(Math.round(p.maxDrawdownPct * 100)), activeDays: String(Math.max(1, Math.round(p.trades / Math.max(0.1, p.stats?.tradesPerDay ?? 1)))) }],
    equityCurve,
    openPositions: (p.positions ?? []).map((x) => ({ perpId: x.perpId, symbol: symbolOf(x.perpId), side: x.side, lotLNS: x.lotLNS, entryPricePNS: x.entryPNS, markPNS: x.markPNS, depositCNS: null, leverageHdths: x.leverageHdths, unrealizedPnlCNS: String(Math.round(x.pnlUsd * 1e6)) })),
    recentTrades: trades,
    riskFlags: (p.riskFlags ?? []).map((f) => FLAG[f.title]).filter(Boolean),
    notes: (p.nansen?.notes ?? []).map((n) => `${n.label}: ${n.text}`),
    nansen: { labels: p.nansen?.labels ?? [], monad: null, crossVenue: null, fetchedAt: null },
  };
}

export { DAY };
