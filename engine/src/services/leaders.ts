import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import type { Reads } from '../chain/reads.js';
import type { MarketData } from '../perpl/market.js';
import { nansenAdjust, type NansenProfile, type NansenSignal } from '../nansen/client.js';
import type { RegistryLike } from './registry.js';

export const WINDOWS: Record<string, number> = { '7d': 7 * 86_400, '30d': 30 * 86_400, '90d': 90 * 86_400 };

type EventRow = {
  account_id: number;
  perp_id: number;
  kind: string;
  ts: number;
  block: number;
  tx_hash: string;
  position_type: number;
  lots_after: string | null;
  lots_before: string | null;
  price: string | null;
  delta_pnl: string | null;
  leverage: number | null;
};

const REALIZING = new Set(['decrease', 'close', 'invert', 'liquidate', 'deleverage']);
const OPENING = new Set(['open', 'increase', 'invert']);

export interface LeaderStats {
  accountId: number;
  pnlCNS: bigint;
  trades: number;
  wins: number;
  closes: number;
  levSum: number;
  levN: number;
  markets: Set<number>;
  liquidations: number;
  curve: Array<{ t: number; pnlCNS: bigint }>;
  lastTs: number;
}

/** Aggregates Perpl position events (as stored by the watcher) into per-account stats. */
export function aggregate(rows: EventRow[]): Map<number, LeaderStats> {
  const out = new Map<number, LeaderStats>();
  for (const r of rows) {
    let s = out.get(r.account_id);
    if (!s) {
      s = { accountId: r.account_id, pnlCNS: 0n, trades: 0, wins: 0, closes: 0, levSum: 0, levN: 0, markets: new Set(), liquidations: 0, curve: [], lastTs: 0 };
      out.set(r.account_id, s);
    }
    s.trades += 1;
    s.markets.add(r.perp_id);
    s.lastTs = Math.max(s.lastTs, r.ts);
    if (OPENING.has(r.kind) && r.leverage) {
      s.levSum += r.leverage;
      s.levN += 1;
    }
    if (r.kind === 'liquidate') s.liquidations += 1;
    if (REALIZING.has(r.kind) && r.delta_pnl !== null) {
      const pnl = BigInt(r.delta_pnl);
      s.pnlCNS += pnl;
      s.closes += 1;
      if (pnl > 0n) s.wins += 1;
      s.curve.push({ t: r.ts, pnlCNS: s.pnlCNS });
    }
  }
  return out;
}

/** Max drawdown of a cumulative PnL curve on top of a starting equity, in percent. */
export function maxDrawdownPct(curve: Array<{ pnlCNS: bigint }>, startEquity: bigint): number {
  let peak = startEquity;
  let maxDd = 0;
  for (const p of curve) {
    const eq = startEquity + p.pnlCNS;
    if (eq > peak) peak = eq;
    if (peak > 0n) maxDd = Math.max(maxDd, Number(((peak - eq) * 10_000n) / peak) / 100);
  }
  return maxDd;
}

/** score = pnl% - 0.5 x drawdown% + 20 x (winRate - 0.5) + log2(trades) + Nansen adjustment. */
export function score(pnlPct: number, ddPct: number, winRate: number, trades: number, nansenBonus: number) {
  return Math.round((pnlPct - 0.5 * ddPct + 20 * (winRate - 0.5) + Math.log2(1 + trades) + nansenBonus) * 100) / 100;
}

const INDEXER_WINDOW: Record<string, string> = { '7d': 'D7', '30d': 'D30', '90d': 'D90' };

// Operations from indexer/queries/engine.graphql (Envio HyperIndex behind Hasura).
const LEADERBOARD_QUERY = `query Leaderboard($window: statswindow!, $minTrades: Int! = 5, $limit: Int! = 200) {
  LeaderWindowStats(where: {window: {_eq: $window}, teamRun: {_eq: false}, isMirrorAccount: {_eq: false}, trades: {_gte: $minTrades}},
    order_by: [{netPnlCNS: desc}, {volumeCNS: desc}], limit: $limit) {
    accountId window asOfDay netPnlCNS realizedPnlCNS fundingCNS feesCNS pnlBps volumeCNS trades closingTrades wins losses winRateBps
    avgLeverageHdths maxDrawdownCNS maxDrawdownBps activeDays lastTradeAt
    leaderStats { address teamRun followers marketsTraded openPositions capitalBaseCNS netPnlCNS maxDrawdownBps winRateBps trades firstTradeAt copiesExecuted followerPnlCNS }
  }
}`;

const PROFILE_QUERY = `query LeaderProfile($id: String!, $sinceDay: Int!, $trades: Int! = 50) {
  PerplAccount_by_pk(id: $id) {
    id accountId address teamRun isMirrorAccount balanceCNS netDepositedCNS createdAt
    stats { trades openingTrades closingTrades wins losses winRateBps liquidations realizedPnlCNS fundingCNS feesCNS netPnlCNS pnlBps volumeCNS
      avgLeverageHdths peakNetPnlCNS maxDrawdownCNS maxDrawdownBps capitalBaseCNS marketsTraded openPositions firstTradeAt lastTradeAt followers
      copiesExecuted copiesBlocked copiedNotionalCNS followerPnlCNS }
    windows(order_by: {days: asc}) { window asOfDay netPnlCNS pnlBps volumeCNS trades winRateBps avgLeverageHdths maxDrawdownCNS maxDrawdownBps activeDays }
    equityCurve(where: {day: {_gte: $sinceDay}}, order_by: {day: asc}) { day date cumulativeNetPnlCNS peakNetPnlCNS drawdownCNS equityCNS trades }
    positions(where: {isOpen: {_eq: true}}, order_by: {updatedAt: desc}) { perpId side lotsLNS entryPricePNS depositCNS leverageHdths openedAt realizedPnlCNS
      market { symbol lotDecimals priceDecimals lastPricePNS } }
    events(order_by: [{blockNumber: desc}, {logIndex: desc}], limit: $trades) { kind perpId side lotsBeforeLNS lotsAfterLNS lotsTradedLNS pricePNS priceSource
      notionalCNS realizedPnlCNS fundingCNS feeCNS leverageHdths blockNumber timestamp txHash }
  }
}`;

type Num = string | number;
interface IndexerLeaderRow {
  accountId: Num;
  netPnlCNS: Num;
  pnlBps: Num;
  trades: Num;
  closingTrades: Num;
  winRateBps: Num;
  avgLeverageHdths: Num;
  maxDrawdownBps: Num;
  activeDays: Num;
  leaderStats?: { address: string; teamRun: boolean; followers: Num; marketsTraded: Num[]; capitalBaseCNS: Num } | null;
}
interface IndexerProfile {
  address: string;
  teamRun: boolean;
  stats: (Record<string, Num> & { marketsTraded?: Num[] }) | null;
  windows?: Array<{ window: string; netPnlCNS: Num; pnlBps: Num; trades: Num; winRateBps: Num; avgLeverageHdths: Num; maxDrawdownBps: Num; activeDays: Num }>;
  equityCurve?: Array<{ day: Num; cumulativeNetPnlCNS: string; equityCNS: string; drawdownCNS: string }>;
  positions?: Array<{ perpId: Num; side: string; lotsLNS: string; entryPricePNS: string; depositCNS: string; leverageHdths: Num; market?: { symbol: string; lotDecimals: number; priceDecimals: number } }>;
  events?: Array<{ kind: string; perpId: Num; side: string; lotsAfterLNS: string; pricePNS: string; realizedPnlCNS: string; leverageHdths: Num; blockNumber: Num; timestamp: Num; txHash: string }>;
}

/**
 * Score for indexer rows, as suggested in docs/indexer.md:
 * clamp(pnlBps / (1 + maxDrawdownBps/1000)) x min(1, closingTrades/20) x min(1, activeDays/(days/3)),
 * halved above 20x average leverage; in percent points.
 */
export function indexerScore(r: Pick<IndexerLeaderRow, 'pnlBps' | 'maxDrawdownBps' | 'closingTrades' | 'activeDays' | 'avgLeverageHdths'>, days: number) {
  const raw = Number(r.pnlBps) / (1 + Number(r.maxDrawdownBps) / 1000);
  const clamped = Math.max(-10_000, Math.min(10_000, raw));
  let s = (clamped / 100) * Math.min(1, Number(r.closingTrades) / 20) * Math.min(1, Number(r.activeDays) / (days / 3));
  if (Number(r.avgLeverageHdths) > 2000) s *= 0.5;
  return Math.round(s * 100) / 100;
}

/**
 * Leader ranking. With INDEXER_GRAPHQL_URL set, proxies to the Envio indexer; otherwise ranks on the fly from
 * Perpl position events the engine has stored (watcher live feed + LEADER_BACKFILL_BLOCKS of history), with
 * equity from the Exchange contract. Nansen enrichment comes through NansenSignal: API key, x402, or none (the
 * score then has no Nansen term).
 */
export class LeaderService {
  private addrCache = new Map<number, string | null>();
  private statusCache?: { ms: number; v: { progressBlock: number; sourceBlock: number; isReady: boolean } | null };

  constructor(
    private readonly db: Db,
    private readonly reads: Reads,
    private readonly market: MarketData,
    private readonly registry: RegistryLike,
    private readonly nansen: NansenSignal,
    private readonly indexerUrl: string | undefined,
    private readonly teamRunLeaderId: () => number,
    private readonly log: Logger,
  ) {}

  private async address(id: number): Promise<string | null> {
    if (!this.addrCache.has(id)) this.addrCache.set(id, (await this.reads.accountAddress(id)) ?? null);
    return this.addrCache.get(id) ?? null;
  }

  private symbol(perpId: number) {
    return this.market.meta(perpId)?.symbol ?? String(perpId);
  }

  private followers(id: number) {
    return this.registry.followersOf(id).length;
  }

  private async fromIndexer(query: string, variables: Record<string, unknown>): Promise<unknown | undefined> {
    if (!this.indexerUrl) return undefined;
    try {
      const res = await fetch(this.indexerUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(5_000) });
      const j = (await res.json()) as { data?: unknown; errors?: unknown };
      if (!res.ok || j.errors) throw new Error(JSON.stringify(j.errors ?? res.status));
      return j.data;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'indexer query failed; computing leaders locally');
      return undefined;
    }
  }

  async list(window = '30d', sort = 'score', marketSymbol?: string, limit = 50) {
    const indexed = await this.fromIndexer(LEADERBOARD_QUERY, { window: INDEXER_WINDOW[window] ?? 'D30', minTrades: 5, limit: 200 });
    const lw = (indexed as { LeaderWindowStats?: IndexerLeaderRow[] } | undefined)?.LeaderWindowStats;
    if (lw) {
      const days = (WINDOWS[window] ?? WINDOWS['30d']!) / 86_400;
      const perpFilter = marketSymbol ? this.market.markets().find((m) => m.symbol.toLowerCase() === marketSymbol.toLowerCase())?.perpId : undefined;
      const rows = lw
        .filter((r) => perpFilter === undefined || (r.leaderStats?.marketsTraded ?? []).map(Number).includes(perpFilter))
        .map((r) => {
          const nansen = r.leaderStats?.address ? (this.nansen.get(r.leaderStats.address) ?? null) : null;
          const adj = nansenAdjust(nansen);
          return {
            accountId: Number(r.accountId),
            address: r.leaderStats?.address ?? null,
            score: indexerScore(r, days) + adj.bonus,
            pnlUsd: Number(r.netPnlCNS) / 1e6,
            pnlPct: Number(r.pnlBps) / 100,
            maxDrawdownPct: Number(r.maxDrawdownBps) / 100,
            winRate: Number(r.winRateBps) / 10_000,
            avgLeverage: Number(r.avgLeverageHdths) / 100,
            trades: Number(r.trades),
            markets: (r.leaderStats?.marketsTraded ?? []).map((m) => this.symbol(Number(m))),
            followers: Number(r.leaderStats?.followers ?? 0),
            nansen: this.nansenView(nansen),
            riskFlags: adj.flags,
            teamRun: Boolean(r.leaderStats?.teamRun) || Number(r.accountId) === this.teamRunLeaderId(),
          };
        })
        .sort((a, b) => (sort === 'pnl' ? b.pnlUsd - a.pnlUsd : sort === 'drawdown' ? a.maxDrawdownPct - b.maxDrawdownPct : b.score - a.score))
        .slice(0, limit);
      return { source: 'indexer', nansenSource: this.nansen.mode, window, sort, leaders: rows };
    }

    const since = Math.floor(Date.now() / 1000) - (WINDOWS[window] ?? WINDOWS['30d']!);
    const perpFilter = marketSymbol ? this.market.markets().find((m) => m.symbol.toLowerCase() === marketSymbol.toLowerCase())?.perpId : undefined;
    const rows = this.db.all<EventRow>(
      `SELECT * FROM perpl_events WHERE ts >= ? ${perpFilter !== undefined ? 'AND perp_id = ?' : ''} ORDER BY block, log_index`,
      ...(perpFilter !== undefined ? [since, perpFilter] : [since]),
    );
    const stats = [...aggregate(rows).values()];
    // Pre-rank by realized PnL and activity, then fetch onchain equity for the top candidates only.
    const candidates = stats.filter((s) => s.closes > 0 || s.trades >= 2).sort((a, b) => Number(b.pnlCNS - a.pnlCNS)).slice(0, Math.max(limit * 2, 50));
    const out = await Promise.all(candidates.map((s) => this.view(s)));
    const sorted = out.sort((a, b) => (sort === 'pnl' ? b.pnlUsd - a.pnlUsd : sort === 'drawdown' ? a.maxDrawdownPct - b.maxDrawdownPct : b.score - a.score));
    return { source: 'engine', nansenSource: this.nansen.mode, window, sort, eventsConsidered: rows.length, leaders: sorted.slice(0, limit) };
  }

  private async fromIndexerProfile(id: number, window: string, pa: IndexerProfile) {
    const st = pa.stats;
    const win = pa.windows?.find((w) => w.window === (INDEXER_WINDOW[window] ?? 'D30'));
    const nansen = pa.address ? (this.nansen.get(pa.address) ?? null) : null;
    const adj = nansenAdjust(nansen);
    const positions = await Promise.all(
      (pa.positions ?? []).map(async (p) => {
        const mark = await this.market.mark(Number(p.perpId)).catch(() => undefined);
        const lots = BigInt(p.lotsLNS);
        const entry = BigInt(p.entryPricePNS);
        const dec = (p.market?.lotDecimals ?? 0) + (p.market?.priceDecimals ?? 0);
        const sign = String(p.side).toUpperCase().startsWith('S') ? -1n : 1n;
        const upnl = mark ? (sign * (mark.markPNS - entry) * lots * 1_000_000n) / 10n ** BigInt(dec) : null;
        return { perpId: Number(p.perpId), symbol: p.market?.symbol ?? this.symbol(Number(p.perpId)), side: String(p.side).toLowerCase(), lotLNS: p.lotsLNS, entryPricePNS: p.entryPricePNS, markPNS: mark?.markPNS.toString() ?? null, depositCNS: p.depositCNS, leverageHdths: p.leverageHdths, unrealizedPnlCNS: upnl?.toString() ?? null };
      }),
    );
    const flags = [...adj.flags];
    if (st && Number(st.avgLeverageHdths) > 1000) flags.push('high_leverage');
    if (st && Number(st.trades) < 5) flags.push('few_trades');
    if (st && Number(st.maxDrawdownBps) > 3000) flags.push('large_drawdown');
    if (st && Number(st.liquidations) > 0) flags.push('liquidated');
    if (st && (st.marketsTraded ?? []).length === 1) flags.push('single_market');
    return {
      source: 'indexer',
      window,
      accountId: id,
      address: pa.address,
      teamRun: Boolean(pa.teamRun) || id === this.teamRunLeaderId(),
      score: win ? indexerScore({ ...win, closingTrades: st?.closingTrades ?? '0' }, (WINDOWS[window] ?? WINDOWS['30d']!) / 86_400) + adj.bonus : null,
      pnlUsd: win ? Number(win.netPnlCNS) / 1e6 : null,
      pnlPct: win ? Number(win.pnlBps) / 100 : null,
      maxDrawdownPct: win ? Number(win.maxDrawdownBps) / 100 : null,
      winRate: win ? Number(win.winRateBps) / 10_000 : null,
      avgLeverage: win ? Number(win.avgLeverageHdths) / 100 : null,
      trades: win ? Number(win.trades) : 0,
      markets: (st?.marketsTraded ?? []).map((m) => this.symbol(Number(m))),
      followers: Number(st?.followers ?? 0),
      stats: st ?? null,
      windows: pa.windows ?? [],
      equityCurve: (pa.equityCurve ?? []).map((e) => ({ t: Number(e.day) * 86_400, pnlCNS: e.cumulativeNetPnlCNS, equityCNS: e.equityCNS, drawdownCNS: e.drawdownCNS })),
      openPositions: positions,
      recentTrades: (pa.events ?? []).map((e) => ({ txHash: e.txHash, block: Number(e.blockNumber), t: Number(e.timestamp), perpId: Number(e.perpId), symbol: this.symbol(Number(e.perpId)), kind: String(e.kind).toLowerCase(), side: String(e.side).toLowerCase(), lotsAfter: e.lotsAfterLNS, pricePNS: e.pricePNS, realizedPnlCNS: e.realizedPnlCNS, leverageHdths: e.leverageHdths })),
      nansen: this.nansenView(nansen),
      riskFlags: flags,
      notes: nansen?.crossVenue ? [`Also trades on ${nansen.crossVenue.venue}: ${nansen.crossVenue.positions} open positions, account value $${nansen.crossVenue.accountValueUsd.toFixed(0)}`] : [],
    };
  }

  async indexerStatus(): Promise<{ progressBlock: number; sourceBlock: number; isReady: boolean } | null> {
    if (!this.indexerUrl) return null;
    const now = Date.now();
    if (this.statusCache && now - this.statusCache.ms < 10_000) return this.statusCache.v;
    const d = (await this.fromIndexer('query IndexerStatus { _meta { progressBlock sourceBlock isReady } }', {})) as { _meta?: Array<{ progressBlock: number; sourceBlock: number; isReady: boolean }> | { progressBlock: number; sourceBlock: number; isReady: boolean } } | undefined;
    const m = Array.isArray(d?._meta) ? d?._meta[0] : d?._meta;
    this.statusCache = { ms: now, v: m ? { progressBlock: Number(m.progressBlock), sourceBlock: Number(m.sourceBlock), isReady: Boolean(m.isReady) } : null };
    return this.statusCache.v;
  }

  private nansenView(p: NansenProfile | null) {
    return p ? { labels: p.labels, monad: p.monad, crossVenue: p.crossVenue, fetchedAt: p.fetchedMs } : { labels: [], monad: null, crossVenue: null, fetchedAt: null };
  }

  private async view(s: LeaderStats) {
    const address = await this.address(s.accountId);
    const balance = await this.reads.perplBalance(s.accountId).catch(() => 0n);
    const start = balance - s.pnlCNS > 0n ? balance - s.pnlCNS : balance > 0n ? balance : 1n;
    const pnlPct = Number((s.pnlCNS * 10_000n) / start) / 100;
    const dd = maxDrawdownPct(s.curve, start);
    const winRate = s.closes ? s.wins / s.closes : 0;
    const nansen = address ? (this.nansen.get(address) ?? null) : null;
    const adj = nansenAdjust(nansen);
    return {
      accountId: s.accountId,
      address,
      score: score(pnlPct, dd, winRate, s.trades, adj.bonus),
      pnlUsd: Number(s.pnlCNS) / 1e6,
      pnlPct,
      maxDrawdownPct: dd,
      winRate: Math.round(winRate * 1000) / 1000,
      avgLeverage: s.levN ? Math.round(s.levSum / s.levN) / 100 : null,
      trades: s.trades,
      markets: [...s.markets].map((m) => this.symbol(m)),
      followers: this.followers(s.accountId),
      nansen: this.nansenView(nansen),
      riskFlags: adj.flags,
      teamRun: s.accountId === this.teamRunLeaderId(),
    };
  }

  async profile(id: number, window = '30d') {
    const sinceDay = Math.floor(Date.now() / 86_400_000) - (WINDOWS[window] ?? WINDOWS['30d']!) / 86_400;
    const indexed = await this.fromIndexer(PROFILE_QUERY, { id: String(id), sinceDay, trades: 50 });
    const pa = (indexed as { PerplAccount_by_pk?: IndexerProfile | null } | undefined)?.PerplAccount_by_pk;
    if (pa) return this.fromIndexerProfile(id, window, pa);
    const since = Math.floor(Date.now() / 1000) - (WINDOWS[window] ?? WINDOWS['30d']!);
    const rows = this.db.all<EventRow>('SELECT * FROM perpl_events WHERE account_id = ? AND ts >= ? ORDER BY block, log_index', id, since);
    const s = aggregate(rows).get(id) ?? { accountId: id, pnlCNS: 0n, trades: 0, wins: 0, closes: 0, levSum: 0, levN: 0, markets: new Set<number>(), liquidations: 0, curve: [], lastTs: 0 };
    const base = await this.view(s);
    const positions = (
      await Promise.all(
        this.market.markets().map(async (m) => {
          const p = await this.reads.position(m.perpId, id).catch(() => undefined);
          return p && p.lots > 0n
            ? { perpId: m.perpId, symbol: m.symbol, side: p.side === 0 ? 'long' : 'short', lotLNS: p.lots.toString(), entryPricePNS: p.entryPricePNS.toString(), markPNS: p.mark.toString(), depositCNS: p.depositCNS.toString(), unrealizedPnlCNS: p.pnlCNS.toString() }
            : undefined;
        }),
      )
    ).filter(Boolean);
    const flags = [...base.riskFlags];
    if (base.avgLeverage !== null && base.avgLeverage > 10) flags.push('high_leverage');
    if (s.trades < 5) flags.push('few_trades');
    if (base.maxDrawdownPct > 30) flags.push('large_drawdown');
    if (s.liquidations > 0) flags.push('liquidated_in_window');
    if (s.markets.size === 1 && s.trades > 0) flags.push('single_market');
    return {
      ...base,
      source: 'engine',
      window,
      equityCurve: s.curve.map((p) => ({ t: p.t, pnlCNS: p.pnlCNS.toString() })),
      openPositions: positions,
      recentTrades: rows.slice(-50).reverse().map((r) => ({ txHash: r.tx_hash, block: r.block, t: r.ts, perpId: r.perp_id, symbol: this.symbol(r.perp_id), kind: r.kind, side: r.position_type === 0 ? 'long' : 'short', lotsAfter: r.lots_after, pricePNS: r.price, realizedPnlCNS: r.delta_pnl, leverageHdths: r.leverage })),
      riskFlags: flags,
      notes: base.nansen.crossVenue ? [`Also trades on ${base.nansen.crossVenue.venue}: ${base.nansen.crossVenue.positions} open positions, account value $${base.nansen.crossVenue.accountValueUsd.toFixed(0)}`] : [],
    };
  }
}
