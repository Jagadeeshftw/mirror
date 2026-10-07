// Engine-side shapes for the dev mock (docs/api.md): copy proof on feed items, engine (thin-book)
// events, adversarial flags, copy quality, backtest, and switches that put the mock into the slow /
// down / RPC-down / history-unavailable states the app has to handle.
import { leaderById, leaderCurve, txHash } from "./data.mjs";

// ---------------------------------------------------------------- switches
export const SW = { backend: "ok", rpc: "ok", backtest: "ok", demoQuiet: false };
export function setSwitches(b) {
  for (const k of Object.keys(SW)) if (b[k] !== undefined) SW[k] = b[k];
  return { ...SW };
}

// ---------------------------------------------------------------- feed enrichment
const isBuy = (t) => t === 0 || t === 3;
/** Adds what the engine now returns on every feed item: onchain, and the copy proof on Mirrored. */
export function enrich(e, opts = {}) {
  e.onchain = true;
  if (e.kind === "Mirrored") {
    const fill = BigInt(e.pricePNS);
    const devBps = opts.devBps ?? Math.round((Math.random() * 4 - 0.8) * 10) / 10; // follower-worse positive
    const f = BigInt(Math.round(devBps * 100)); // 1e-6 units
    const leaderFill = isBuy(e.orderType) ? (fill * 1_000_000n) / (1_000_000n + f) : (fill * 1_000_000n) / (1_000_000n - f);
    const open = e.orderType <= 1;
    e.latencyMs ??= 560 + Math.round(Math.random() * 120);
    e.latencyBlocks = opts.blocks ?? Math.max(1, Math.round(e.latencyMs / 300));
    e.leaderRef = txHash();
    e.leaderBlock = e.block - e.latencyBlocks;
    e.leaderLotLNS ??= (BigInt(e.lotLNS) * 500n).toString();
    e.proof = {
      leaderFillPNS: leaderFill.toString(),
      leaderEntryPNS: (open ? leaderFill : (leaderFill * 99_980n) / 100_000n).toString(),
      markPNS: ((fill + leaderFill) / 2n).toString(),
      fillPNS: fill.toString(),
      entryDeviationBps: open ? Math.max(0, Math.round(devBps)) : 0,
      // Builder 26 fee: 20 per 100,000 of the opening notional; never on closes.
      builderFeeCNS: open ? ((BigInt(e.notionalCNS ?? 0) * 20n + 99_999n) / 100_000n).toString() : "0",
    };
  }
  if (e.kind === "Blocked") {
    e.leaderRef ??= txHash();
    e.leaderBlock ??= e.block - 6;
    e.data = { leaderFillPNS: e.pricePNS, markPNS: e.pricePNS, ...(e.data ?? {}) };
  }
  return e;
}

/** Engine-side thin-book event (no transaction). */
export function engineEvent(a, kind, { perpId, orderType, requested, final, depth, multiple = 2, limitPNS, ageMs, block, leaderAccountId, leaderAddress, bookUnavailable }) {
  const required = Math.ceil(requested * multiple);
  const label = kind === "EngineShrunk" ? "Shrunk: thin book" : bookUnavailable ? "Skipped: book unavailable" : "Skipped: thin book";
  return {
    id: `${a.account.slice(2, 10).toLowerCase()}-eng-${Math.floor(Math.random() * 1e9)}`,
    kind,
    onchain: false,
    label,
    account: a.account,
    txHash: null,
    txUrl: null,
    block,
    timestamp: Date.now() - ageMs,
    commitState: "offchain",
    leaderAccountId,
    leaderAddress,
    perpId,
    orderType,
    lotLNS: String(final ?? 0),
    pricePNS: String(limitPNS),
    reason: bookUnavailable ? "BookUnavailable" : "ThinBook",
    limit: String(required),
    actual: bookUnavailable ? null : String(depth),
    data: { onchain: false, label, source: "keeper", reason: bookUnavailable ? "book_unavailable" : "thin_book", requestedLots: String(requested), finalLots: String(final ?? 0), depthLots: bookUnavailable ? null : String(depth), requiredLots: String(required), multiple, limitPNS: String(limitPNS), bookSource: "ws", bookAgeMs: 180 },
  };
}

// ---------------------------------------------------------------- adversarial
const ADV = { 1588: { exitsIntoFollowers: 2, bookMoving: 1, score: 38, flagged: true, copiedFills: 8 }, 4410: { exitsIntoFollowers: 1, bookMoving: 0, score: 9, flagged: false, copiedFills: 11 } };
export function adversarialFor(accountId) {
  const a = ADV[accountId] ?? { exitsIntoFollowers: 0, bookMoving: 0, score: 0, flagged: false, copiedFills: 0 };
  return { ...a, lastSeen: a.score ? Math.floor(Date.now() / 1000) - 5400 : 0 };
}

// ---------------------------------------------------------------- copy quality
const pct = (arr, q) => (arr.length ? [...arr].sort((x, y) => x - y)[Math.min(arr.length - 1, Math.ceil(q * arr.length) - 1)] : null);
function agg(rows, blockedRows) {
  const dev = rows.map((r) => r.deviationBps).filter((x) => x !== null);
  const ms = rows.map((r) => r.latencyMs).filter((x) => x !== null);
  const bl = rows.map((r) => r.latencyBlocks).filter((x) => x !== null);
  return {
    copies: rows.length,
    matchNowCopies: rows.filter((r) => r.matchNow).length,
    opens: rows.filter((r) => r.orderType <= 1).length,
    closes: rows.filter((r) => r.orderType >= 2).length,
    blocked: blockedRows.length,
    deviationBps: { samples: dev.length, median: pct(dev, 0.5), p90: pct(dev, 0.9), avg: dev.length ? Math.round((dev.reduce((s, x) => s + x, 0) / dev.length) * 10) / 10 : null, worseThanLeader: dev.filter((x) => x > 0).length },
    latencyMs: { samples: ms.length, median: pct(ms, 0.5), p90: pct(ms, 0.9) },
    latencyBlocks: { samples: bl.length, median: pct(bl, 0.5), p90: pct(bl, 0.9) },
  };
}
function toCopy(e) {
  const p = e.proof;
  const lf = p ? BigInt(p.leaderFillPNS) : 0n;
  const ff = p ? BigInt(p.fillPNS) : 0n;
  const dev = lf ? Math.round(Number(((isBuy(e.orderType) ? ff - lf : lf - ff) * 100_000n) / lf)) / 10 : null;
  return { txHash: e.txHash, account: e.account, leaderAccountId: e.leaderAccountId, perpId: e.perpId, orderType: e.orderType, lotLNS: e.lotLNS, leaderRef: e.leaderRef ?? null, leaderFillPNS: p?.leaderFillPNS ?? null, followerFillPNS: p?.fillPNS ?? e.pricePNS, deviationBps: dev, latencyMs: e.latencyMs ?? null, latencyBlocks: e.latencyBlocks ?? null, block: e.block, timestamp: Math.floor(e.timestamp / 1000), matchNow: !!e.matchNow };
}
export function copyQuality(accounts, period = "30d", leaderAccountId = null) {
  const since = period === "7d" ? Date.now() - 7 * 864e5 : period === "30d" ? Date.now() - 30 * 864e5 : 0;
  const pick = (team) => {
    const evs = [...accounts].filter((a) => !!a.teamRun === team).flatMap((a) => a.feed).filter((e) => e.timestamp >= since && (leaderAccountId === null || e.leaderAccountId === leaderAccountId));
    const copies = evs.filter((e) => e.kind === "Mirrored").map(toCopy);
    const blocked = evs.filter((e) => e.kind === "Blocked");
    const byReason = {};
    for (const b of blocked) byReason[b.blocked.reason] = (byReason[b.blocked.reason] ?? 0) + 1;
    return { aggregates: agg(copies, blocked), blockedByReason: byReason, copies: copies.slice(0, 50) };
  };
  const user = pick(false);
  const team = pick(true);
  return {
    source: "engine",
    period,
    since: since ? Math.floor(since / 1000) : null,
    leaderAccountId,
    excludesTeamRun: true,
    definitions: { deviationBps: "follower fill vs leader fill, positive = follower got the worse price", latencyMs: "leader log first seen (Proposed) to copy receipt, engine clock", latencyBlocks: "copy block minus leader block" },
    ...user,
    teamRun: { label: "team-run (demo leader / demo follower); excluded from every number above", ...team },
  };
}

// ---------------------------------------------------------------- backtest
const RULES = ["LeverageTooHigh", "EntryTooFar", "ExceedsMaxNotional", "MarketNotAllowed", "LeaderBudgetExceeded"];
export function backtest(leaderId, b) {
  const l = leaderById[leaderId];
  if (!l) return { status: 404, body: { error: "not_found", message: "Unknown leader" } };
  if (SW.backtest === "unavailable") return { status: 503, body: { error: "history unavailable: INDEXER_GRAPHQL_URL is not set (the engine keeps only its backfill window)" } };
  const days = Number(String(b.period ?? 30).replace("d", "")) || 30;
  const deposit = Number(b.depositCNS ?? 12_000_000);
  const curve = leaderCurve(l, days === 7 ? "7d" : days === 90 ? "90d" : "30d").points;
  const tradesTotal = Math.round(l.freq * days * 0.2) + 6;
  const lev = (b.maxLeverageHdths ?? 500) / 100;
  const blockedBy = {
    LeverageTooHigh: Math.max(0, Math.round(tradesTotal * Math.max(0, (l.peak - lev) / l.peak) * 0.45)),
    EntryTooFar: b.maxEntryDeviationBps ? Math.round(tradesTotal * (b.maxEntryDeviationBps <= 50 ? 0.12 : 0.06)) : 0,
    ExceedsMaxNotional: Math.round(tradesTotal * 0.04),
    MarketNotAllowed: Math.max(0, l.mk.length - (b.markets?.length ?? 0)) * 2,
    LeaderBudgetExceeded: Math.round(tradesTotal * 0.02),
  };
  for (const k of RULES) if (!blockedBy[k]) delete blockedBy[k];
  const blockedTotal = Object.values(blockedBy).reduce((s, x) => s + x, 0);
  const copied = Math.max(0, tradesTotal - blockedTotal);
  // follower curve: the leader's daily returns scaled by sizing, damped by blocked trades
  const exposure = (0.35 + Math.min(0.65, (b.ratioBps ?? 10) / 100)) * (copied / tradesTotal) * 0.6;
  const daysPts = curve.filter((_, i) => i % Math.max(1, Math.round(curve.length / days)) === 0);
  let eq = deposit;
  let peak = eq, maxDd = 0;
  const feeBps = 3.5;
  const out = daysPts.map((p, i) => {
    if (i > 0) eq += (eq * (p.v / daysPts[i - 1].v - 1) * exposure) - deposit * 0.00002;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
    return { day: Math.floor(p.t / 864e5), date: new Date(p.t).toISOString().slice(0, 10), equityCNS: String(Math.round(eq)) };
  });
  const fees = Math.round(copied * deposit * 0.25 * (feeBps / 1e4));
  const final = Math.round(eq) - fees;
  out[out.length - 1].equityCNS = String(final);
  const measured = { 1043: 1, 877: 2, 1588: 4 }[leaderId];
  const slippage = measured !== undefined ? { bps: measured, source: `median copy deviation measured on ${12 + leaderId % 30} real copies of this leader (indexer), floored at 0` } : { bps: 5, source: "default BACKTEST_DEFAULT_SLIPPAGE_BPS: fewer than 3 measured copies of this leader" };
  const ddFloor = b.drawdownBps ? deposit * (1 - b.drawdownBps / 1e4) : 0;
  const stops = ddFloor && Math.min(...out.map((x) => Number(x.equityCNS))) < ddFloor ? [{ t: Math.floor(Date.now() / 1000) - 5 * 86400, kind: "DrawdownStop" }] : [];
  return {
    status: 200,
    body: {
      leaderAccountId: leaderId, period: `${days}d`, from: Math.floor(curve[0].t / 1000), to: Math.floor(curve[curve.length - 1].t / 1000), source: "indexer",
      slippage, takerFeeBps: feeBps, simulation: true,
      depositCNS: String(deposit), finalEquityCNS: String(final), pnlCNS: String(final - deposit), pnlPct: Math.round(((final - deposit) / deposit) * 100000) / 1000, feesCNS: String(fees),
      maxDrawdownCNS: String(Math.round(maxDd)), maxDrawdownBps: Math.round((maxDd / Math.max(1, peak)) * 1e4), tradesCopied: copied,
      tradesBlocked: blockedBy, tradesBlockedTotal: blockedTotal, skipped: { LeaderSizeOrPriceUnknown: 1 }, stops,
      equityCurve: out, openPositions: [], trades: [], eventsReplayed: tradesTotal * 2 + 3,
      assumptions: [
        "This is a simulation of past trades, not a record of real copies. The leader can trade differently tomorrow.",
        `Fills at the leader's fill price moved against you by ${slippage.bps} bps (${measured !== undefined ? "this leader's measured median copy deviation" : "the default, too few measured copies"}), never past your slippage limit.`,
        `Perpl taker fee ${feeBps} bps on every copied order. Funding payments are not included.`,
        "Your rules are applied to each leader trade in order by the same checks the contract runs, with your budget as the starting balance.",
      ],
    },
  };
}
