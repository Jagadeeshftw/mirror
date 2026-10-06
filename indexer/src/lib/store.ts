/**
 * Entity helpers shared by the handlers: get-or-create, scope (global / team-run) counters, and the
 * per-account performance aggregation (LeaderStats, DailyAccountStats, EquityPoint, windows).
 */
import { createEffect, S, type Entity, type EvmOnEventContext } from "envio";
import { createPublicClient, getAddress, http, zeroAddress } from "viem";

import { MARKETS, PERPL_EXCHANGE, SCOPE_GLOBAL, SCOPE_TEAM_RUN, WINDOWS } from "./constants.js";
import { isTeamRun, resolveAddressesEnabled, rpcUrl } from "./env.js";
import {
  avgLeverageHdths,
  dateOf,
  dayOf,
  drawdownBps,
  max,
  min,
  ratioBps,
  winRateBps,
} from "./math.js";
import { addSample, percentile, sampleCount, type Histogram } from "./quality.js";
import { applyDelta, computeWindow, type DayRow, type TradeDelta, type WindowAgg } from "./windows.js";

export type Ctx = EvmOnEventContext;
export type PerplAccount = Entity<"PerplAccount">;
export type Market = Entity<"Market">;
export type LeaderStats = Entity<"LeaderStats">;
export type MirrorAccount = Entity<"MirrorAccount">;
export type ScopeStats = Entity<"GlobalStats">;
export type DailyStats = Entity<"DailyStats">;
export type CopyQualityStats = Entity<"CopyQualityStats">;

export type Meta = {
  block: number;
  timestamp: number;
  txHash: string;
  logIndex: number;
  srcAddress: string;
};

export function metaOf(event: {
  block: { number: number; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
  srcAddress: string;
}): Meta {
  return {
    block: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    srcAddress: getAddress(event.srcAddress),
  };
}

/** EIP-55 checksum, used for every address stored or used as an entity id. */
export function checksum(address: string): string {
  return getAddress(address);
}

export function eventId(m: Meta): string {
  return `${m.txHash}-${m.logIndex}`;
}

// -------------------------------------------------------------------------------------------------
// Perpl account address lookup (only for accounts first seen without their AccountCreated event,
// i.e. when the indexer starts after the Perpl deploy block).
// -------------------------------------------------------------------------------------------------

const GET_ACCOUNT_BY_ID_ABI = [
  {
    type: "function",
    name: "getAccountById",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "uint256" }],
    outputs: [
      {
        name: "accountInfo",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "balanceCNS", type: "uint256" },
          { name: "lockedBalanceCNS", type: "uint256" },
          { name: "frozen", type: "uint8" },
          { name: "accountAddr", type: "address" },
          {
            name: "positions",
            type: "tuple",
            components: [
              { name: "bank1", type: "uint256" },
              { name: "bank2", type: "uint256" },
              { name: "bank3", type: "uint256" },
              { name: "bank4", type: "uint256" },
            ],
          },
        ],
      },
    ],
  },
] as const;

let rpcClient: ReturnType<typeof createPublicClient> | undefined;

/** Address and current collateral balance of a Perpl account, via getAccountById. */
export const getPerplAccountInfo = createEffect(
  {
    name: "getPerplAccountInfo",
    input: S.string,
    output: S.union([S.schema({ address: S.string, balanceCNS: S.string }), null]),
    cache: true,
    rateLimit: { calls: 15, per: "second" },
  },
  async ({ input }) => {
    rpcClient ??= createPublicClient({ transport: http(rpcUrl(), { batch: true }) });
    try {
      const info = await rpcClient.readContract({
        address: PERPL_EXCHANGE,
        abi: GET_ACCOUNT_BY_ID_ABI,
        functionName: "getAccountById",
        args: [BigInt(input)],
      });
      if (info.accountAddr === zeroAddress) return null;
      return { address: getAddress(info.accountAddr), balanceCNS: info.balanceCNS.toString() };
    } catch {
      return null;
    }
  },
);

// -------------------------------------------------------------------------------------------------
// Markets and accounts
// -------------------------------------------------------------------------------------------------

export async function loadMarket(ctx: Ctx, perpId: number): Promise<Market> {
  const existing = await ctx.Market.get(String(perpId));
  if (existing) return existing;
  const info = MARKETS[perpId];
  return {
    id: String(perpId),
    perpId,
    symbol: info?.symbol ?? `PERP-${perpId}`,
    lotDecimals: info?.lotDecimals ?? 0,
    priceDecimals: info?.priceDecimals ?? 0,
    decimalsKnown: info !== undefined,
    lastPricePNS: 0n,
    lastTradeAt: 0,
    volumeCNS: 0n,
    trades: 0,
    longLotsLNS: 0n,
    shortLotsLNS: 0n,
    fundingEvents: 0,
    lastFundingRatePct100k: 0n,
    lastFundingAt: 0,
  };
}

/**
 * Load or create a Perpl account. New accounts are persisted immediately and counted in the scope
 * stats. `knownAddress` comes from AccountCreated / MirrorAccount; otherwise the address is looked
 * up with an eth_call when ENVIO_RESOLVE_PERPL_ADDRESSES is not "false".
 */
export async function ensureAccount(ctx: Ctx, accountId: bigint, m: Meta, knownAddress?: string): Promise<PerplAccount> {
  const id = accountId.toString();
  const existing = await ctx.PerplAccount.get(id);
  if (existing) {
    if (knownAddress && !existing.address) {
      const updated: PerplAccount = {
        ...existing,
        address: getAddress(knownAddress),
        teamRun: existing.teamRun || isTeamRun({ addresses: [knownAddress], accountId }),
      };
      ctx.PerplAccount.set(updated);
      return updated;
    }
    return existing;
  }
  let address: string | undefined = knownAddress ? getAddress(knownAddress) : undefined;
  // Seen without its AccountCreated event (sync started after the account was created): look up the
  // address, and use the current collateral balance as the capital base for return/drawdown ratios.
  let balance = 0n;
  if (!address && resolveAddressesEnabled()) {
    const info = await ctx.effect(getPerplAccountInfo, id);
    address = info?.address;
    balance = info ? BigInt(info.balanceCNS) : 0n;
  }
  const account: PerplAccount = {
    id,
    accountId,
    address,
    isMirrorAccount: false,
    mirrorAccount_id: undefined,
    teamRun: isTeamRun({ addresses: [address], accountId }),
    balanceCNS: balance,
    totalDepositedCNS: 0n,
    totalWithdrawnCNS: 0n,
    netDepositedCNS: 0n,
    createdAt: undefined,
    createdBlock: undefined,
    stats_id: id,
  };
  ctx.PerplAccount.set(account);
  await bumpScope(ctx, account.teamRun, m, (s) => ({ ...s, perplAccounts: s.perplAccounts + 1 }));
  return account;
}

export function newLeaderStats(account: PerplAccount): LeaderStats {
  return {
    id: account.id,
    account_id: account.id,
    accountId: account.accountId,
    address: account.address,
    isMirrorAccount: account.isMirrorAccount,
    teamRun: account.teamRun,
    trades: 0,
    openingTrades: 0,
    closingTrades: 0,
    wins: 0,
    losses: 0,
    winRateBps: 0,
    liquidations: 0,
    realizedPnlCNS: 0n,
    fundingCNS: 0n,
    feesCNS: 0n,
    netPnlCNS: 0n,
    volumeCNS: 0n,
    openingNotionalCNS: 0n,
    leverageNotionalSum: 0n,
    avgLeverageHdths: 0,
    peakNetPnlCNS: 0n,
    maxDrawdownCNS: 0n,
    maxDrawdownBps: 0,
    capitalBaseCNS: max(account.netDepositedCNS, account.createdAt === undefined ? account.balanceCNS : 0n),
    pnlBps: 0,
    marketsTraded: [],
    marketCount: 0,
    openPositions: 0,
    firstTradeAt: 0,
    lastTradeAt: 0,
    lastTradeBlock: 0,
    lastTradeDay: 0,
    followers: 0,
    copiesExecuted: 0,
    copiesBlocked: 0,
    copiedNotionalCNS: 0n,
    followerPnlCNS: 0n,
    followerLeaderStops: 0,
  };
}

export async function loadLeaderStats(ctx: Ctx, account: PerplAccount): Promise<LeaderStats> {
  const s = (await ctx.LeaderStats.get(account.id)) ?? newLeaderStats(account);
  // keep the denormalised flags in sync with the account
  return {
    ...s,
    address: account.address ?? s.address,
    isMirrorAccount: account.isMirrorAccount,
    teamRun: account.teamRun,
  };
}

/** Leader stats of a leader referenced by a Mirror event (the leader may never have traded yet). */
export async function updateLeaderStats(
  ctx: Ctx,
  leaderAccountId: bigint,
  m: Meta,
  fn: (s: LeaderStats) => LeaderStats,
): Promise<void> {
  const account = await ensureAccount(ctx, leaderAccountId, m);
  const s = await loadLeaderStats(ctx, account);
  ctx.LeaderStats.set(fn(s));
}

// -------------------------------------------------------------------------------------------------
// Scope stats (GlobalStats excludes team-run; TeamRunStats counts only team-run)
// -------------------------------------------------------------------------------------------------

function emptyScope(id: string): ScopeStats {
  return {
    id,
    mirrorAccounts: 0,
    fundedAccounts: 0,
    pausedAccounts: 0,
    netDepositsCNS: 0n,
    totalDepositedCNS: 0n,
    totalWithdrawnCNS: 0n,
    copiesExecuted: 0,
    copiesBlocked: 0,
    matchNowCopies: 0,
    copiedNotionalCNS: 0n,
    followerRealizedPnlCNS: 0n,
    closeAllCount: 0,
    policyUpdates: 0,
    stopsTriggered: 0,
    leaderStops: 0,
    perplAccounts: 0,
    perplTrades: 0,
    perplVolumeCNS: 0n,
    lastUpdatedAt: 0,
    lastBlock: 0,
  };
}

export function scopeName(teamRun: boolean): string {
  return teamRun ? SCOPE_TEAM_RUN : SCOPE_GLOBAL;
}

export async function bumpScope(ctx: Ctx, teamRun: boolean, m: Meta, fn: (s: ScopeStats) => ScopeStats): Promise<void> {
  // GlobalStats and TeamRunStats have identical fields.
  const store = (teamRun ? ctx.TeamRunStats : ctx.GlobalStats) as unknown as Ctx["GlobalStats"];
  const id = scopeName(teamRun);
  const s = (await store.get(id)) ?? emptyScope(id);
  store.set({ ...fn(s), lastUpdatedAt: Math.max(s.lastUpdatedAt, m.timestamp), lastBlock: Math.max(s.lastBlock, m.block) });
}

export async function bumpDaily(ctx: Ctx, teamRun: boolean, m: Meta, fn: (d: DailyStats) => DailyStats): Promise<void> {
  const scope = scopeName(teamRun);
  const day = dayOf(m.timestamp);
  const id = `${scope}-${day}`;
  const d: DailyStats = (await ctx.DailyStats.get(id)) ?? {
    id,
    scope,
    day,
    date: dateOf(day),
    newMirrorAccounts: 0,
    copiesExecuted: 0,
    copiesBlocked: 0,
    matchNowCopies: 0,
    copiedNotionalCNS: 0n,
    depositsCNS: 0n,
    withdrawalsCNS: 0n,
    perplTrades: 0,
    perplVolumeCNS: 0n,
  };
  ctx.DailyStats.set(fn(d));
}

// -------------------------------------------------------------------------------------------------
// Per-account performance aggregation
// -------------------------------------------------------------------------------------------------

export type TradeInput = TradeDelta & {
  perpId: number;
  block: number;
  liquidations: number;
  openingTrades: number;
  openPositionsDelta: number;
};

function windowEntity(
  account: PerplAccount,
  stats: LeaderStats,
  window: (typeof WINDOWS)[number],
  asOfDay: number,
  w: WindowAgg,
): Entity<"LeaderWindowStats"> {
  return {
    id: `${account.id}-${window.window}`,
    account_id: account.id,
    leaderStats_id: account.id,
    accountId: account.accountId,
    window: window.window,
    days: window.days,
    asOfDay,
    isMirrorAccount: account.isMirrorAccount,
    teamRun: account.teamRun,
    trades: w.trades,
    closingTrades: w.closingTrades,
    wins: w.wins,
    losses: w.losses,
    winRateBps: winRateBps(w.wins, w.losses),
    realizedPnlCNS: w.realizedPnlCNS,
    fundingCNS: w.fundingCNS,
    feesCNS: w.feesCNS,
    netPnlCNS: w.netPnlCNS,
    volumeCNS: w.volumeCNS,
    openingNotionalCNS: w.openingNotionalCNS,
    leverageNotionalSum: w.leverageNotionalSum,
    avgLeverageHdths: avgLeverageHdths(w.leverageNotionalSum, w.openingNotionalCNS),
    startCumPnlCNS: w.startCumPnlCNS,
    peakCumPnlCNS: w.peakCumPnlCNS,
    maxDrawdownCNS: w.maxDrawdownCNS,
    maxDrawdownBps: drawdownBps(w.maxDrawdownCNS, stats.capitalBaseCNS, w.peakCumPnlCNS),
    pnlBps: ratioBps(w.netPnlCNS, stats.capitalBaseCNS),
    activeDays: w.activeDays,
    lastTradeAt: w.lastTradeAt,
  };
}

function windowAggOf(e: Entity<"LeaderWindowStats">): WindowAgg {
  return {
    trades: e.trades,
    closingTrades: e.closingTrades,
    wins: e.wins,
    losses: e.losses,
    realizedPnlCNS: e.realizedPnlCNS,
    fundingCNS: e.fundingCNS,
    feesCNS: e.feesCNS,
    netPnlCNS: e.netPnlCNS,
    volumeCNS: e.volumeCNS,
    openingNotionalCNS: e.openingNotionalCNS,
    leverageNotionalSum: e.leverageNotionalSum,
    startCumPnlCNS: e.startCumPnlCNS,
    peakCumPnlCNS: e.peakCumPnlCNS,
    maxDrawdownCNS: e.maxDrawdownCNS,
    activeDays: e.activeDays,
    lastTradeAt: e.lastTradeAt,
  };
}

async function loadDayRows(ctx: Ctx, accountId: string, fromDay: number): Promise<Entity<"DailyAccountStats">[]> {
  return ctx.DailyAccountStats.getWhere({ account_id: { _eq: accountId }, day: { _gte: fromDay } });
}

/** Fold one position event into LeaderStats, the day row, the equity point and the 3 windows. */
export async function recordTrade(ctx: Ctx, account: PerplAccount, t: TradeInput): Promise<LeaderStats> {
  const day = dayOf(t.timestamp);
  const dayId = `${account.id}-${day}`;
  const windowIds = WINDOWS.map((w) => `${account.id}-${w.window}`);
  const [statsRaw, dayRow, windows] = await Promise.all([
    loadLeaderStats(ctx, account),
    ctx.DailyAccountStats.get(dayId),
    Promise.all(windowIds.map((id) => ctx.LeaderWindowStats.get(id))),
  ]);
  const needsRecompute = windows.some((w) => !w || w.asOfDay !== day);
  const rows = needsRecompute ? await loadDayRows(ctx, account.id, day - 89) : [];

  // ---- LeaderStats
  const cumBefore = statsRaw.netPnlCNS;
  const cumAfter = cumBefore + t.netPnlCNS;
  const peak = max(statsRaw.peakNetPnlCNS, cumAfter);
  const dd = peak - cumAfter;
  const capitalBase = max(statsRaw.capitalBaseCNS, account.netDepositedCNS);
  const wins = statsRaw.wins + t.wins;
  const losses = statsRaw.losses + t.losses;
  const openingNotional = statsRaw.openingNotionalCNS + t.openingNotionalCNS;
  const levSum = statsRaw.leverageNotionalSum + t.leverageNotionalSum;
  const markets = statsRaw.marketsTraded.includes(t.perpId)
    ? statsRaw.marketsTraded
    : [...statsRaw.marketsTraded, t.perpId].sort((a, b) => a - b);
  const stats: LeaderStats = {
    ...statsRaw,
    trades: statsRaw.trades + t.trades,
    openingTrades: statsRaw.openingTrades + t.openingTrades,
    closingTrades: statsRaw.closingTrades + t.closingTrades,
    wins,
    losses,
    winRateBps: winRateBps(wins, losses),
    liquidations: statsRaw.liquidations + t.liquidations,
    realizedPnlCNS: statsRaw.realizedPnlCNS + t.realizedPnlCNS,
    fundingCNS: statsRaw.fundingCNS + t.fundingCNS,
    feesCNS: statsRaw.feesCNS + t.feesCNS,
    netPnlCNS: cumAfter,
    volumeCNS: statsRaw.volumeCNS + t.volumeCNS,
    openingNotionalCNS: openingNotional,
    leverageNotionalSum: levSum,
    avgLeverageHdths: avgLeverageHdths(levSum, openingNotional),
    peakNetPnlCNS: peak,
    maxDrawdownCNS: max(statsRaw.maxDrawdownCNS, dd),
    maxDrawdownBps: Math.max(statsRaw.maxDrawdownBps, drawdownBps(dd, capitalBase, peak)),
    capitalBaseCNS: capitalBase,
    pnlBps: ratioBps(cumAfter, capitalBase),
    marketsTraded: markets,
    marketCount: markets.length,
    openPositions: Math.max(0, statsRaw.openPositions + t.openPositionsDelta),
    firstTradeAt: statsRaw.firstTradeAt === 0 ? t.timestamp : statsRaw.firstTradeAt,
    lastTradeAt: Math.max(statsRaw.lastTradeAt, t.timestamp),
    lastTradeBlock: Math.max(statsRaw.lastTradeBlock, t.block),
    lastTradeDay: Math.max(statsRaw.lastTradeDay, day),
  };
  ctx.LeaderStats.set(stats);

  // ---- DailyAccountStats
  const base: Entity<"DailyAccountStats"> = dayRow ?? {
    id: dayId,
    account_id: account.id,
    accountId: account.accountId,
    day,
    date: dateOf(day),
    trades: 0,
    openingTrades: 0,
    closingTrades: 0,
    wins: 0,
    losses: 0,
    realizedPnlCNS: 0n,
    fundingCNS: 0n,
    feesCNS: 0n,
    netPnlCNS: 0n,
    volumeCNS: 0n,
    openingNotionalCNS: 0n,
    leverageNotionalSum: 0n,
    startCumPnlCNS: cumBefore,
    endCumPnlCNS: cumBefore,
    highCumPnlCNS: cumBefore,
    lowCumPnlCNS: cumBefore,
    maxIntradayDrawdownCNS: 0n,
    marketsTraded: [],
    lastTradeAt: 0,
  };
  const updatedDay: Entity<"DailyAccountStats"> = {
    ...base,
    trades: base.trades + t.trades,
    openingTrades: base.openingTrades + t.openingTrades,
    closingTrades: base.closingTrades + t.closingTrades,
    wins: base.wins + t.wins,
    losses: base.losses + t.losses,
    realizedPnlCNS: base.realizedPnlCNS + t.realizedPnlCNS,
    fundingCNS: base.fundingCNS + t.fundingCNS,
    feesCNS: base.feesCNS + t.feesCNS,
    netPnlCNS: base.netPnlCNS + t.netPnlCNS,
    volumeCNS: base.volumeCNS + t.volumeCNS,
    openingNotionalCNS: base.openingNotionalCNS + t.openingNotionalCNS,
    leverageNotionalSum: base.leverageNotionalSum + t.leverageNotionalSum,
    endCumPnlCNS: cumAfter,
    highCumPnlCNS: max(base.highCumPnlCNS, cumAfter),
    lowCumPnlCNS: min(base.lowCumPnlCNS, cumAfter),
    maxIntradayDrawdownCNS: max(base.maxIntradayDrawdownCNS, base.highCumPnlCNS - cumAfter),
    marketsTraded: base.marketsTraded.includes(t.perpId) ? base.marketsTraded : [...base.marketsTraded, t.perpId],
    lastTradeAt: Math.max(base.lastTradeAt, t.timestamp),
  };
  ctx.DailyAccountStats.set(updatedDay);

  // ---- EquityPoint (end-of-day values)
  ctx.EquityPoint.set({
    id: dayId,
    account_id: account.id,
    accountId: account.accountId,
    day,
    date: updatedDay.date,
    timestamp: day * 86_400,
    cumulativeNetPnlCNS: cumAfter,
    peakNetPnlCNS: peak,
    drawdownCNS: dd,
    netDepositedCNS: account.netDepositedCNS,
    equityCNS: account.netDepositedCNS + cumAfter,
    trades: updatedDay.trades,
  });

  // ---- Windows
  const allRows: DayRow[] = needsRecompute ? [...rows.filter((r) => r.day !== day), updatedDay] : [];
  WINDOWS.forEach((w, i) => {
    const current = windows[i];
    const agg =
      current && current.asOfDay === day
        ? applyDelta(windowAggOf(current), t, cumAfter, dayRow === undefined)
        : computeWindow(allRows, day, w.days, cumAfter);
    ctx.LeaderWindowStats.set(windowEntity(account, stats, w, day, agg));
  });

  return stats;
}

/**
 * Roll stale windows forward to `today` for accounts that stopped trading. Called by the hourly
 * block handler once the indexer is at the chain head.
 */
export async function refreshStaleWindows(ctx: Ctx, today: number): Promise<number> {
  const stale = await ctx.LeaderWindowStats.getWhere({ asOfDay: { _lt: today }, trades: { _gt: 0 } });
  const accountIds = [...new Set(stale.map((w) => w.account_id))];
  for (const accountId of accountIds) {
    const [account, statsRaw, rows] = await Promise.all([
      ctx.PerplAccount.get(accountId),
      ctx.LeaderStats.get(accountId),
      loadDayRows(ctx, accountId, today - 89),
    ]);
    if (!account || !statsRaw) continue;
    for (const w of WINDOWS) {
      const agg = computeWindow(rows, today, w.days, statsRaw.netPnlCNS);
      ctx.LeaderWindowStats.set(windowEntity(account, statsRaw, w, today, agg));
    }
  }
  return accountIds.length;
}

// -------------------------------------------------------------------------------------------------
// Copy-quality aggregates (CopyQualityStats + BlockReasonStats)
//
// Every copy or block updates four rows in its scope: all leaders / its leader x all time / its UTC
// day. The scope is "teamRun" when the follower or the leader is team-run, "global" otherwise.
// -------------------------------------------------------------------------------------------------

type QualityKey = { id: string; leaderAccountId: bigint | undefined; day: number | undefined };

function qualityKeys(scope: string, leaderAccountId: bigint, day: number): QualityKey[] {
  const keys: QualityKey[] = [];
  for (const leader of [undefined, leaderAccountId]) {
    for (const d of [undefined, day]) {
      keys.push({ id: `${scope}-${leader ?? "all"}-${d ?? "all"}`, leaderAccountId: leader, day: d });
    }
  }
  return keys;
}

function emptyQuality(scope: string, k: QualityKey): CopyQualityStats {
  return {
    id: k.id,
    scope,
    leaderAccountId: k.leaderAccountId,
    leader_id: k.leaderAccountId?.toString(),
    period: k.day === undefined ? "ALL_TIME" : "DAY",
    day: k.day,
    date: k.day === undefined ? undefined : dateOf(k.day),
    copies: 0,
    matchNowCopies: 0,
    opens: 0,
    closes: 0,
    copiedNotionalCNS: 0n,
    blocked: 0,
    deviationSamples: 0,
    deviationSamplesActual: 0,
    deviationSumBps: 0n,
    avgDeviationBps: undefined,
    medianDeviationBps: undefined,
    p90DeviationBps: undefined,
    worseThanLeader: 0,
    latencySamples: 0,
    medianLatencyBlocks: undefined,
    p90LatencyBlocks: undefined,
    medianLatencySeconds: undefined,
    p90LatencySeconds: undefined,
    leaderFillVerified: 0,
    leaderFillMismatches: 0,
    updatedAt: 0,
  };
}

export type CopySample = {
  isMatchNow: boolean;
  isOpen: boolean;
  notionalCNS: bigint;
  /** null = no deviation sample */
  deviationBps: number | null;
  deviationActual: boolean;
  latencyBlocks: number | null;
  latencySeconds: number | null;
  leaderFillVerified: boolean;
  leaderFillMismatch: boolean;
};

function hist(values: readonly number[], counts: readonly number[]): Histogram {
  return { values: [...values], counts: [...counts] };
}

/** Fold one executed copy into the four quality rows of its scope. */
export async function recordCopyQuality(
  ctx: Ctx,
  excluded: boolean,
  leaderAccountId: bigint,
  m: Meta,
  c: CopySample,
): Promise<void> {
  const scope = scopeName(excluded);
  for (const k of qualityKeys(scope, leaderAccountId, dayOf(m.timestamp))) {
    const [row, h] = await Promise.all([ctx.CopyQualityStats.get(k.id), ctx.CopyQualityHistogram.get(k.id)]);
    const cur = row ?? emptyQuality(scope, k);
    let dev = hist(h?.deviationValues ?? [], h?.deviationCounts ?? []);
    let latB = hist(h?.latencyBlockValues ?? [], h?.latencyBlockCounts ?? []);
    let latS = hist(h?.latencySecondValues ?? [], h?.latencySecondCounts ?? []);
    if (c.deviationBps !== null) dev = addSample(dev, c.deviationBps);
    if (c.latencyBlocks !== null) latB = addSample(latB, c.latencyBlocks);
    if (c.latencySeconds !== null) latS = addSample(latS, c.latencySeconds);
    const devSum = cur.deviationSumBps + BigInt(c.deviationBps ?? 0);
    const devN = sampleCount(dev);
    ctx.CopyQualityHistogram.set({
      id: k.id,
      deviationValues: dev.values,
      deviationCounts: dev.counts,
      latencyBlockValues: latB.values,
      latencyBlockCounts: latB.counts,
      latencySecondValues: latS.values,
      latencySecondCounts: latS.counts,
    });
    ctx.CopyQualityStats.set({
      ...cur,
      copies: cur.copies + 1,
      matchNowCopies: cur.matchNowCopies + (c.isMatchNow ? 1 : 0),
      opens: cur.opens + (c.isOpen ? 1 : 0),
      closes: cur.closes + (c.isOpen ? 0 : 1),
      copiedNotionalCNS: cur.copiedNotionalCNS + c.notionalCNS,
      deviationSamples: devN,
      deviationSamplesActual: cur.deviationSamplesActual + (c.deviationBps !== null && c.deviationActual ? 1 : 0),
      deviationSumBps: devSum,
      avgDeviationBps: devN > 0 ? Math.round(Number(devSum) / devN) : undefined,
      medianDeviationBps: percentile(dev, 50) ?? undefined,
      p90DeviationBps: percentile(dev, 90) ?? undefined,
      worseThanLeader: cur.worseThanLeader + (c.deviationBps !== null && c.deviationBps > 0 ? 1 : 0),
      latencySamples: sampleCount(latB),
      medianLatencyBlocks: percentile(latB, 50) ?? undefined,
      p90LatencyBlocks: percentile(latB, 90) ?? undefined,
      medianLatencySeconds: percentile(latS, 50) ?? undefined,
      p90LatencySeconds: percentile(latS, 90) ?? undefined,
      leaderFillVerified: cur.leaderFillVerified + (c.leaderFillVerified ? 1 : 0),
      leaderFillMismatches: cur.leaderFillMismatches + (c.leaderFillMismatch ? 1 : 0),
      updatedAt: m.timestamp,
    });
  }
}

/** Fold one blocked copy into the quality rows and the per-reason rows of its scope. */
export async function recordBlockQuality(
  ctx: Ctx,
  excluded: boolean,
  leaderAccountId: bigint,
  reason: Entity<"BlockReasonStats">["reason"],
  m: Meta,
): Promise<void> {
  const scope = scopeName(excluded);
  for (const k of qualityKeys(scope, leaderAccountId, dayOf(m.timestamp))) {
    const cur = (await ctx.CopyQualityStats.get(k.id)) ?? emptyQuality(scope, k);
    ctx.CopyQualityStats.set({ ...cur, blocked: cur.blocked + 1, updatedAt: m.timestamp });
    const reasonId = `${k.id}-${reason}`;
    const r = await ctx.BlockReasonStats.get(reasonId);
    ctx.BlockReasonStats.set({
      id: reasonId,
      scope,
      leaderAccountId: k.leaderAccountId,
      leader_id: k.leaderAccountId?.toString(),
      period: cur.period,
      day: k.day,
      date: cur.date,
      reason,
      count: (r?.count ?? 0) + 1,
    });
  }
}
