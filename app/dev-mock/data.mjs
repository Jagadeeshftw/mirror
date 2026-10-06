// Static, realistic seed data for the dev mock (leaders, markets, curves).
import { createHash } from "node:crypto";
import shared from "../src/lib/shared-config.json" with { type: "json" };

export const MAINNET = shared.networks.mainnet;
export const AUSD = MAINNET.collateral;

let seed = 7;
export const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
export const reseed = (s) => {
  seed = s;
};
export const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
export const txHash = () => `0x${hex(64)}`;

// Marks in price units (PNS) and Perpl max leverage per market.
const MARKS = {
  BTC: { mark: 118402.5, maxLev: 15 },
  MON: { mark: 0.0418, maxLev: 5 },
  ETH: { mark: 4312.8, maxLev: 15 },
  SOL: { mark: 212.44, maxLev: 10 },
  HYPE: { mark: 46.92, maxLev: 10 },
  ZEC: { mark: 284.1, maxLev: 5 },
  LIT: { mark: 0.8214, maxLev: 5 },
  VVV: { mark: 3.125, maxLev: 5 },
  PUMP: { mark: 0.004812, maxLev: 5 },
  NEAR: { mark: 3.041, maxLev: 5 },
  UNI: { mark: 9.812, maxLev: 5 },
};

export const markets = MAINNET.markets.map((m) => ({
  ...m,
  markPNS: BigInt(Math.round(MARKS[m.symbol].mark * 10 ** m.priceDecimals)),
  maxLeverage: MARKS[m.symbol].maxLev,
  minOrderLotLNS: "1",
}));
export const bySymbol = Object.fromEntries(markets.map((m) => [m.symbol, m]));
export const byPerp = Object.fromEntries(markets.map((m) => [m.perpId, m]));

/** price (float) -> PNS for a market */
export const pns = (sym, p) => BigInt(Math.round(p * 10 ** bySymbol[sym].priceDecimals));
/** lots (float) -> LNS */
export const lns = (sym, l) => BigInt(Math.round(l * 10 ** bySymbol[sym].lotDecimals));
export const notional = (perpId, lots, price) => {
  const m = byPerp[perpId];
  return (lots * price * 10n ** 6n) / 10n ** BigInt(m.lotDecimals + m.priceDecimals);
};

function fullAddr(short) {
  // keep the design's short forms (0x7a3f…c91e) and fill the middle deterministically
  const [h, t] = short.replace("0x", "").split("…");
  const mid = createHash("sha256").update(short).digest("hex").slice(0, 40 - h.length - t.length);
  return `0x${h}${mid}${t}`;
}

function buildSeries(points, perDay, noise) {
  const out = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [d0, v0] = points[k];
    const [d1, v1] = points[k + 1];
    const steps = (d1 - d0) * perDay;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const e = t * t * (3 - 2 * t);
      const base = v0 + (v1 - v0) * e;
      out.push(i === 0 ? v0 : base * (1 + (rnd() - 0.5) * noise));
    }
  }
  out.push(points[points.length - 1][1]);
  return out;
}

const L = (o) => ({ ...o, address: fullAddr(o.short) });
export const LEADERS = [
  L({ key: "a", short: "0x7a3f…c91e", accountId: 1043, labels: ["Smart Trader", "30D Smart Trader"], r30: 38.4, r7: 6.2, r90: 71.9, dd: 9.2, win: 61, lev: 4.1, peak: 8, mk: ["BTC", "SOL", "ETH"], freq: 14.2, score: 92, fol: 212, trades: 426, since: "Jun 2026", eq0: 41200 }),
  L({ key: "b", short: "0x19be…04d2", accountId: 877, labels: ["Fund"], r30: 24.1, r7: 3.9, r90: 48.2, dd: 6.8, win: 57, lev: 2.8, peak: 5, mk: ["BTC", "ETH"], freq: 3.1, score: 89, fol: 148, trades: 93, since: "May 2026", eq0: 812000 }),
  L({ key: "e", short: "0xe8a9…33c6", accountId: 2210, labels: [], r30: 15.2, r7: 2.4, r90: 29.0, dd: 4.1, win: 66, lev: 2.1, peak: 4, mk: ["ZEC", "ETH"], freq: 5.6, score: 84, fol: 61, trades: 168, since: "Jul 2026", eq0: 22800 }),
  L({ key: "c", short: "0xc4e0…7b13", accountId: 1588, labels: ["Smart Trader", "Whale"], r30: 51.7, r7: 9.8, r90: 64.3, dd: 22.5, win: 48, lev: 9.6, peak: 15, mk: ["HYPE", "SOL", "MON", "BTC"], freq: 9.4, score: 81, fol: 97, trades: 212, since: "Jul 2026", eq0: 93400 }),
  L({ key: "d", short: "0x5d21…a8f0", accountId: 3021, labels: ["Whale"], r30: 17.9, r7: -1.3, r90: 22.4, dd: 11.3, win: 54, lev: 5.2, peak: 10, mk: ["BTC", "ETH", "ZEC"], freq: 6.8, score: 78, fol: 54, trades: 204, since: "Jun 2026", eq0: 1240000 }),
  L({ key: "f", short: "0x2f70…d5a4", accountId: 4410, labels: [], r30: 12.6, r7: 4.4, r90: 9.8, dd: 14.0, win: 52, lev: 3.4, peak: 5, mk: ["SOL", "MON", "PUMP"], freq: 11.0, score: 74, fol: 23, trades: 330, since: "Aug 2026", eq0: 8600 }),
];
export const leaderById = Object.fromEntries(LEADERS.map((l) => [l.accountId, l]));

export const DEMO_LEADER = { accountId: 9001, address: "0xde30b5a1c0ffee00000000000000000000009001", teamRun: true };
export const DEMO_FOLLOWER = "0xde30f011000000000000000000000000000000a1";

// Leaders' current open positions (what match-now would copy).
export const LEADER_POSITIONS = {
  1043: [
    { sym: "BTC", side: "long", lots: 2.1, entry: 117880.0, lev: 400 },
    { sym: "SOL", side: "long", lots: 46.7, entry: 198.1, lev: 300 },
    { sym: "ETH", side: "short", lots: 1.39, entry: 4350.0, lev: 300 },
  ],
  877: [
    { sym: "BTC", side: "long", lots: 3.4, entry: 116950.0, lev: 200 },
    { sym: "ETH", side: "short", lots: 22.0, entry: 4351.2, lev: 300 },
  ],
  2210: [
    { sym: "ZEC", side: "long", lots: 61.0, entry: 279.4, lev: 200 },
    { sym: "ETH", side: "long", lots: 4.2, entry: 4281.0, lev: 200 },
  ],
  1588: [
    { sym: "HYPE", side: "long", lots: 2400, entry: 45.42, lev: 500 },
    { sym: "SOL", side: "long", lots: 310, entry: 198.1, lev: 300 },
    { sym: "BTC", side: "long", lots: 1.5, entry: 118390.0, lev: 1200 },
    { sym: "MON", side: "short", lots: 2200000, entry: 0.0431, lev: 300 },
  ],
  3021: [
    { sym: "BTC", side: "short", lots: 6.0, entry: 119210.0, lev: 500 },
    { sym: "ZEC", side: "long", lots: 400, entry: 271.0, lev: 400 },
  ],
  4410: [
    { sym: "SOL", side: "long", lots: 22.0, entry: 205.3, lev: 300 },
    { sym: "PUMP", side: "long", lots: 410000, entry: 0.004712, lev: 300 },
  ],
};

const DAY = 86400000;
export function leaderCurve(l, window = "30d") {
  const days = window === "7d" ? 7 : window === "90d" ? 90 : 30;
  const ret = window === "7d" ? l.r7 : window === "90d" ? l.r90 : l.r30;
  reseed(100 + l.accountId);
  const v0 = l.eq0;
  let pts;
  if (l.key === "c" && window === "30d") {
    pts = [[0, 93400], [5, 103200], [10, 118600], [16, 91900], [22, 111800], [27, 129500], [30, 141700]];
  } else {
    const ddDay = Math.round(days * 0.45);
    const pre = v0 * (1 + ((ret / 100) * 0.55));
    pts = [
      [0, v0],
      [Math.max(1, Math.round(days * 0.2)), v0 * (1 + (ret / 100) * 0.25)],
      [ddDay, pre],
      [Math.round(days * 0.6), pre * (1 - l.dd / 100)],
      [Math.round(days * 0.85), v0 * (1 + (ret / 100) * 0.8)],
      [days, v0 * (1 + ret / 100)],
    ];
    // dedupe equal day indices
    pts = pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0]);
  }
  const perDay = days > 30 ? 1 : 4;
  const series = buildSeries(pts, perDay, 0.012);
  const end = Date.UTC(2026, 9, 6);
  const start = end - days * DAY;
  const pointsT = series.map((v, i) => ({ t: Math.round(start + (i / (series.length - 1)) * days * DAY), v: Math.round(v * 100) / 100 }));
  // drawdown
  let peak = series[0], peakI = 0, dd = 0, ddPeakI = 0, ddTroughI = 0;
  series.forEach((v, i) => {
    if (v > peak) { peak = v; peakI = i; }
    const d = (peak - v) / peak;
    if (d > dd) { dd = d; ddPeakI = peakI; ddTroughI = i; }
  });
  return {
    points: pointsT,
    ret: (series.at(-1) / series[0] - 1) * 100,
    pnl: series.at(-1) - series[0],
    drawdown: { fromT: pointsT[ddPeakI].t, toT: pointsT[ddTroughI].t, pct: Math.round(dd * 1000) / 10, days: Math.round((pointsT[ddTroughI].t - pointsT[ddPeakI].t) / DAY) },
  };
}

export function spark(l) {
  reseed(11 + l.accountId);
  const pts = [[0, 100]];
  for (let i = 1; i <= 5; i++) pts.push([i * 6, 100 + (l.r30 * i) / 5 + (i < 5 ? (rnd() - 0.45) * l.r30 * 0.5 : 0)]);
  return buildSeries(pts, 1, 0.02).map((v) => Math.round(v * 100) / 100);
}

export const NANSEN = {
  1588: {
    notes: [
      { label: "Smart Trader", text: "Top PnL cohort across tracked perps venues" },
      { label: "Whale", text: "Holds over $1M across linked wallets" },
    ],
    venues: [
      { venue: "Hyperliquid", since: "Mar 2024", realisedPnlUsd: 212400 },
      { venue: "dYdX", since: "Nov 2023", realisedPnlUsd: 18900 },
      { venue: "GMX", since: "Feb 2023", realisedPnlUsd: -7200 },
      { venue: "Perpl", since: "Jul 2026", realisedPnlUsd: 61000 },
    ],
  },
  1043: {
    notes: [
      { label: "Smart Trader", text: "Top PnL cohort across tracked perps venues" },
      { label: "30D Smart Trader", text: "Top PnL cohort over the last 30 days" },
    ],
    venues: [
      { venue: "Hyperliquid", since: "Jan 2025", realisedPnlUsd: 48300 },
      { venue: "Perpl", since: "Jun 2026", realisedPnlUsd: 15800 },
    ],
  },
  877: {
    notes: [{ label: "Fund", text: "Wallet linked to a known trading fund" }],
    venues: [
      { venue: "Hyperliquid", since: "Aug 2024", realisedPnlUsd: 1204000 },
      { venue: "Aevo", since: "Jan 2024", realisedPnlUsd: 96000 },
      { venue: "Perpl", since: "May 2026", realisedPnlUsd: 195700 },
    ],
  },
};
