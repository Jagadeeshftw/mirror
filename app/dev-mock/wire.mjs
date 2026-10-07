// The engine's wire shapes (engine/src/services/views.ts, feed.ts, demo.ts, quote.ts, leaders.ts; docs/api.md).
// The mock keeps its state in the app's own types and converts at the HTTP and SSE boundary, so the app reads
// exactly what the engine serves and its adapters (src/lib/engineShape.ts, engineDemo.ts, leaderShape.ts)
// are exercised by every screen in dev. Fields the engine does not serve are dropped here on purpose.
const S = (v) => (v === null || v === undefined ? null : String(v));
const lower = (a) => (a ? String(a).toLowerCase() : a);
const ORDER_TYPE_NAMES = ["OpenLong", "OpenShort", "CloseLong", "CloseShort"];
// MirrorAccount.BlockReason, in enum order.
const BLOCK_REASONS = ["None", "Paused", "Expired", "LeaderNotAllowed", "LeaderSideMismatch", "MarketNotAllowed", "LeverageTooHigh", "SlippageTooHigh", "FlipNotAllowed", "StaleMark", "ExceedsLeaderTarget", "ExceedsMaxNotional", "DailyLossStop", "DrawdownStop", "LeverageTooLow", "EntryTooFar", "MarketHeldByOtherLeader", "LeaderBudgetExceeded", "LeaderLossStop", "MarketHalted", "CloseBelowTarget", "BuilderFeeTooHigh", "LeaderDetached"];

// ---------------------------------------------------------------- accounts (Views.account)
export function wireAccount(a) {
  if (!a) return a;
  return {
    address: a.account,
    owner: a.owner,
    deployed: a.deployed !== false,
    predicted: false,
    salt: a.salt,
    teamRun: !!a.teamRun,
    perplAccountId: a.perplAccountId ?? null,
    createdBlock: 0,
    createdTx: null,
    balanceCNS: S(a.balanceCNS),
    equityCNS: S(a.equityCNS),
    netDepositsCNS: S(a.netDepositsCNS),
    pnlCNS: (BigInt(a.equityCNS ?? 0) - BigInt(a.netDepositsCNS ?? 0)).toString(),
    builderFeesCNS: "0",
    paused: !!a.paused,
    // Views.account: MirrorAccount.leaderDetached per leader ("stop following, keep my positions").
    detachedLeaders: [...(a.detachedLeaders ?? [])],
    expiry: a.expiry ?? null,
    policy: a.policy ? { ...a.policy, leaders: a.policy.leaders.map((l) => ({ ...l, stopped: (a.stoppedLeaders ?? []).includes(l.accountId), detached: (a.detachedLeaders ?? []).includes(l.accountId) })), markets: a.policy.markets.map((m) => ({ ...m, halted: (a.halted ?? []).includes(m.perpId) })) } : null,
    levels: (a.levels ?? []).map((l) => ({ perpId: l.perpId, side: l.side, stopLossPNS: S(l.stopLossPNS), takeProfitPNS: S(l.takeProfitPNS), slippageBps: l.slippageBps })),
    positions: (a.positions ?? []).map((p) => ({
      perpId: p.perpId, symbol: null, side: p.side, lotLNS: S(p.lotLNS), entryPricePNS: S(p.entryPNS), markPNS: S(p.markPNS),
      depositCNS: S(p.marginCNS), unrealizedPnlCNS: S(p.upnlCNS), leaderAccountId: p.leaderAccountId ?? null,
    })),
    // Views.account: equity now minus the UTC day's first snapshot, and 30 days of snapshots {t (unix s), equityCNS}.
    todayPnlCNS: a.pnl?.todayCNS !== undefined ? S(a.pnl.todayCNS) : null,
    equityHistory: (a.equityHistory ?? []).map((p) => ({ t: Math.floor(Number(p.t) / 1000), equityCNS: String(p.v) })),
    pnlByLeader: (a.pnl?.byLeader ?? []).map((l) => ({
      leaderAccountId: l.leaderAccountId, unrealizedPnlCNS: S(l.unrealisedCNS), realizedPnlCNS: S(l.realisedCNS), marginCNS: S(l.marginCNS ?? "0"), budgetCNS: S(l.budgetCNS ?? "0"), stopped: !!l.stopped,
      detached: (a.detachedLeaders ?? []).includes(Number(l.leaderAccountId)),
    })),
  };
}

/** Views.ownerAccounts: deployed accounts, or the bare predicted one for an owner with none. */
export function wireOwnerAccounts(owner, list, predicted) {
  const accounts = list.map(wireAccount);
  if (!accounts.length && predicted) accounts.push({ address: predicted, owner, deployed: false, predicted: true, salt: "0x" + "0".repeat(64), teamRun: false });
  return { owner, accounts };
}

// ---------------------------------------------------------------- feed (feedJson)
let nextId = 1;
const ids = new Map();
const numericId = (id) => (/^\d+$/.test(String(id)) ? Number(id) : ids.get(id) ?? (ids.set(id, nextId++), ids.get(id)));

export function wireFeedEvent(e, explorerTx = "https://monadvision.com/tx/") {
  if (!e) return e;
  // 'Detached' rows are from the retired engine-held detach; LeaderDetached rows are onchain LeaderDetachedSet.
  const engine = String(e.kind).startsWith("Engine") || e.kind === "Detached";
  const b = e.blocked;
  let data = e.data ?? null;
  if (e.kind === "Mirrored") data = { lotsBefore: null, lotsAfter: null, proof: e.proof ?? null };
  if (e.kind === "Blocked") data = { leaderFillPNS: S(e.data?.leaderEntryPNS ?? e.proof?.leaderFillPNS ?? e.pricePNS ?? "0"), markPNS: S(b?.reason === "EntryTooFar" ? b.actual : e.pricePNS ?? "0") };
  if (e.kind === "Deposited" || e.kind === "Withdrawn") data = { netDeposits: null };
  if (e.kind === "ClosedAll") data = { slippageBps: 300, positionsClosed: e.positionsClosed ?? 0 };
  if (e.kind === "Paused") data = { paused: !!e.paused };
  return {
    id: numericId(e.id),
    account: lower(e.account),
    kind: e.kind === "Followed" ? "PolicyUpdated" : e.kind,
    onchain: !engine,
    label: engine ? (e.label ?? e.kind) : null,
    txHash: engine ? null : e.txHash,
    txUrl: engine ? null : explorerTx + e.txHash,
    logIndex: 0,
    block: e.block,
    timestamp: Math.floor(Number(e.timestamp) / 1000),
    commitState: engine ? "offchain" : e.commitState,
    leaderAccountId: e.leaderAccountId ?? null,
    perpId: e.perpId ?? null,
    orderType: e.orderType ?? null,
    orderTypeName: e.orderType !== undefined && e.orderType !== null ? ORDER_TYPE_NAMES[e.orderType] : null,
    lotLNS: e.lotLNS ?? null,
    pricePNS: e.kind === "Blocked" ? null : (e.pricePNS ?? null),
    leverageHdths: e.kind === "Blocked" ? null : (e.leverageHdths ?? null),
    reason: b?.reason ?? e.reason ?? null,
    limit: b?.limit ?? e.limit ?? null,
    actual: b?.actual ?? e.actual ?? null,
    leaderRef: e.leaderRef ?? null,
    matchNow: !!e.matchNow,
    keeper: e.keeper ?? null,
    amount: e.amountCNS ?? null,
    latencyMs: e.latencyMs ?? null,
    proof: e.kind === "Mirrored" ? (e.proof ?? null) : null,
    data,
  };
}

export const wireFeedPage = (events, cursor) => ({ items: events.map((e) => wireFeedEvent(e)), nextCursor: cursor === null || cursor === undefined ? null : Number(cursor) });

// ---------------------------------------------------------------- demo (Demo.state, step events)
const STEP_EVENTS = { leader_open: ["leader_opening", "leader_opened"], copy_open: [null, "copy_executed"], copy_blocked: [null, "copy_blocked"], leader_close: ["leader_closing", "leader_closed"], copy_close: [null, "copy_closed"] };

/** A cycle with step statuses -> the engine's step log ({type: "demo", cycleId, step, at, ...}). */
export function cycleEvents(cy) {
  const out = [];
  const ev = (step, s, extra = {}) => out.push({ type: "demo", cycleId: cy.id, step, at: s?.at ?? cy.startedAt, ...extra });
  for (const s of cy.steps) {
    const [start, end] = STEP_EVENTS[s.key] ?? [null, null];
    if (s.status === "pending") continue;
    if (s.key === "leader_open") ev("leader_opening", s, { kind: cy.kind, perpId: 1, lots: "1", leverageHdths: cy.kind === "blocked" ? 1200 : 300 });
    else if (start) ev(start, s);
    if (s.status === "done" || s.status === "blocked") {
      const step = s.status === "blocked" ? "copy_blocked" : end;
      if (step) ev(step, s, { txHash: s.txHash ?? null, ...(s.key.startsWith("copy") ? { latencyMs: s.latencyMs ?? null, reason: s.status === "blocked" ? "LeverageTooHigh" : null } : {}) });
    } else if (s.status === "failed") ev("failed", s, { error: s.detail ?? "failed" });
  }
  if (cy.status === "done") ev("done", null, { at: cy.steps.at(-1)?.at ?? cy.startedAt });
  return out;
}

export function wireCycle(cy) {
  return { id: cy.id, kind: cy.kind, ip: "127.0.0.1", status: cy.status, started_ms: cy.startedAt, ended_ms: cy.status === "running" ? null : (cy.steps.at(-1)?.at ?? null), open_tx: null, close_tx: null, copy_tx: null, copy_close_tx: null, error: null, steps: cycleEvents(cy) };
}

export function wireDemo(d) {
  const f = d.follower;
  const pos = f?.positions?.[0];
  const running = d.cycles.find((c) => c.status === "running");
  return {
    enabled: true,
    running: running ? running.id : null,
    perpId: 1, lots: 1, leverageHdths: 300, blockedLeverageHdths: 1200,
    limits: { perIpHourly: d.limits.perIpPerHour, dailyCap: d.limits.dailyCap, usedToday: d.limits.dailyCap - d.limits.dailyRemaining },
    leader: { address: d.leader.address, accountId: d.leader.accountId, teamRun: true, position: null },
    follower: {
      account: f?.account ?? null, teamRun: true, perplAccountId: f?.perplAccountId ?? null, maxLeverageHdths: f?.policy?.maxLeverageHdths ?? null,
      following: (f?.policy?.leaders ?? []).map((l) => ({ ...l, stopped: false })),
      position: pos ? { side: pos.side === "short" ? 1 : 0, lotLNS: pos.lotLNS } : null,
    },
    cycles: d.cycles.map(wireCycle),
  };
}

// ---------------------------------------------------------------- SSE frames
const sentSteps = new Map();
/** App-shaped SSE payload -> the engine frames for it (zero or more). */
export function wireStream(event, data) {
  if (event === "feed") return [["feed", { type: "feed", item: wireFeedEvent(data) }]];
  if (event === "commit") return [["commit", { type: "commit", id: numericId(data.id), txHash: data.txHash, block: data.block ?? null, kind: data.kind ?? null, commitState: data.commitState }]];
  if (event === "demo") {
    const evs = cycleEvents(data);
    const sent = sentSteps.get(data.id) ?? 0;
    sentSteps.set(data.id, evs.length);
    return evs.slice(sent).map((e) => ["demo", e]);
  }
  return [[event, data]];
}

// ---------------------------------------------------------------- quotes, markets
export function wireQuote(q, owner) {
  if (!q || q.error) return q;
  return {
    owner, account: null, deployed: false, funded: false, leaderAccountId: q.leaderAccountId, simulation: "replay", simulationError: null,
    quotes: (q.rows ?? []).map((r) => ({ ...r, symbol: null, orderTypeName: ORDER_TYPE_NAMES[r.orderType], perplMarkPNS: null, perplMarkSource: null, expectedFillLots: null, bookSource: null, leaderLeverageHdths: r.leverageHdths, leaderLotLNS: r.leaderLotLNS ?? "0", leaderEntryPNS: "0", entryBoundPNS: null, thinBook: r.thinBook ?? null, engineSkip: r.engineSkip ?? null })),
    builderFee: q.builderFee ?? { id: 26, feePer100K: 20, estimateCNS: "0", appliesTo: "opening size only" },
    matchOrders: q.orders ?? [],
    encodedMatchOrders: q.ordersEncoded ?? "0x",
    followActionData: null,
  };
}

export const wireMarkets = (list) => ({ source: { config: "mock", live: "mock" }, markets: list.map((m) => ({ perpId: m.perpId, symbol: m.symbol, markPNS: S(m.markPNS), oraclePNS: S(m.oraclePNS), bestBidPNS: S(m.bestBidPNS), bestAskPNS: S(m.bestAskPNS), fundingRatePct100k: null, openInterestLNS: S(m.openInterestLNS) })) });
export { BLOCK_REASONS };
