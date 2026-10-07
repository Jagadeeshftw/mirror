import { z } from 'zod';
import { LONG, SHORT } from '../domain/types.js';
import { backtestAssumptions, runBacktest } from '../domain/backtest-run.js';
import type { BtEvent, BtKind, BtMarket, BtParams } from '../domain/backtest-types.js';
import type { IndexerClient } from './indexer.js';
import type { Db } from '../db.js';
import type { MarketMeta } from '../config.js';
import type { CopyQualityService } from './quality.js';

const u = z.union([z.string(), z.number()]).transform((v) => BigInt(v));

export const BacktestBody = z.object({
  ratioBps: z.coerce.number().int().min(1).max(10_000),
  maxLeverageHdths: z.coerce.number().int().min(100).max(10_000),
  maxSlippageBps: z.coerce.number().int().min(1).max(1_000).default(100),
  markets: z.array(z.object({ perpId: z.coerce.number().int(), maxNotionalCNS: u })).min(1).max(16),
  maxEntryDeviationBps: z.coerce.number().int().min(0).max(5_000).default(0),
  budgetCNS: u.refine((v) => v > 0n, 'budgetCNS must be > 0'),
  lossStopBps: z.coerce.number().int().min(0).max(10_000).default(0),
  dailyLossBps: z.coerce.number().int().min(0).max(10_000).default(0),
  drawdownBps: z.coerce.number().int().min(0).max(10_000).default(0),
  stopLossPct: z.coerce.number().positive().max(100).optional(),
  takeProfitPct: z.coerce.number().positive().max(1_000).optional(),
  flattenOnStop: z.boolean().default(false),
  depositCNS: u.refine((v) => v > 0n, 'depositCNS must be > 0'),
  period: z.union([z.literal(7), z.literal(30), z.literal(90), z.enum(['7', '30', '90', '7d', '30d', '90d'])]).default(30).transform((v) => Number(String(v).replace('d', '')) as 7 | 30 | 90),
  /** Owner's max builder fee (per 100,000); defaults to the deployment's fee, so it never blocks. */
  maxBuilderFeePer100K: z.coerce.number().int().min(0).max(1_000).optional(),
  /** Override the follower slippage assumption (bps). */
  slippageBps: z.coerce.number().min(0).max(1_000).optional(),
});

const HISTORY_QUERY = `query LeaderTradeHistory($accountId: numeric!, $since: Int! = 0, $limit: Int! = 1000, $offset: Int! = 0) {
  PositionEvent(where: { accountId: { _eq: $accountId }, timestamp: { _gte: $since } }, order_by: [{ blockNumber: asc }, { logIndex: asc }],
    limit: $limit, offset: $offset) {
    perpId kind side lotsAfterLNS lotsKnown pricePNS priceSource entryPricePNS leverageHdths blockNumber timestamp logIndex
    market { symbol lotDecimals priceDecimals lastPricePNS }
  }
}`;

type Row = {
  perpId: number | string;
  kind: string;
  side: string;
  lotsAfterLNS: string;
  lotsKnown: boolean;
  pricePNS: string;
  entryPricePNS: string;
  leverageHdths: number | string;
  blockNumber: number | string;
  timestamp: number | string;
  market?: { lotDecimals: number; priceDecimals: number; lastPricePNS: string | null } | null;
};

const PAGE = 1_000;
const err = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });

export interface BacktestOptions {
  defaultSlippageBps: number;
  takerFeeBps: number;
  safetyBps: number;
  maxEvents: number;
  /** MirrorAccount.BUILDER_FEE_PER_100K (read once from chain); none = no builder fee. */
  builder?: () => Promise<{ id: number; feePer100K: number }>;
}

/** POST /v1/leaders/:id/backtest: history from the indexer's PositionEvent, replay in domain/backtest. */
export class BacktestService {
  constructor(
    private readonly indexer: IndexerClient,
    private readonly quality: CopyQualityService,
    private readonly opts: BacktestOptions,
    /** Without an indexer: the leader events the engine itself recorded (perpl_events), e.g. on a localnet. */
    private readonly local?: { db: Db; markets: MarketMeta[] },
  ) {}

  async history(leaderId: number, since: number): Promise<{ events: BtEvent[]; markets: BtMarket[]; truncated: boolean }> {
    if (!this.indexer.enabled && this.local) return this.localHistory(leaderId, since);
    if (!this.indexer.enabled) throw err(503, 'history unavailable: no indexer configured (INDEXER_GRAPHQL_URL) and no Perpl REST history client');
    const events: BtEvent[] = [];
    const markets = new Map<number, BtMarket>();
    for (let offset = 0; offset < this.opts.maxEvents; offset += PAGE) {
      const d = await this.indexer.query<{ PositionEvent: Row[] }>(HISTORY_QUERY, { accountId: leaderId, since, limit: PAGE, offset }, 'leader trade history');
      if (!d) throw err(503, 'history unavailable: indexer query failed');
      for (const r of d.PositionEvent) {
        const perpId = Number(r.perpId);
        if (r.market && !markets.has(perpId)) {
          markets.set(perpId, { perpId, lotDecimals: Number(r.market.lotDecimals), priceDecimals: Number(r.market.priceDecimals), lastPricePNS: r.market.lastPricePNS ? BigInt(r.market.lastPricePNS) : null });
        }
        events.push({
          perpId,
          kind: String(r.kind).toUpperCase() as BtKind,
          side: String(r.side).toUpperCase() === 'SHORT' ? SHORT : LONG,
          lotsAfter: BigInt(r.lotsAfterLNS),
          lotsKnown: Boolean(r.lotsKnown),
          pricePNS: BigInt(r.pricePNS),
          entryPricePNS: BigInt(r.entryPricePNS),
          leverageHdths: Number(r.leverageHdths),
          timestamp: Number(r.timestamp),
          block: Number(r.blockNumber),
        });
      }
      if (d.PositionEvent.length < PAGE) return { events, markets: [...markets.values()], truncated: false };
    }
    return { events, markets: [...markets.values()], truncated: true };
  }

  /**
   * History from the engine's own perpl_events. Average entry is rebuilt from the fills; a decrease carries no
   * price in Perpl's event, so its price is the market's last recorded trade before it (else the entry).
   */
  private localHistory(leaderId: number, since: number): { events: BtEvent[]; markets: BtMarket[]; truncated: boolean } {
    const { db, markets } = this.local!;
    type LRow = { perp_id: number; kind: string; position_type: number | null; lots_after: string | null; lots_before: string | null; price: string | null; leverage: number | null; ts: number | null; block: number };
    const rows = db.all<LRow>(
      `SELECT perp_id, kind, position_type, lots_after, lots_before, price, leverage, ts, block FROM perpl_events
       WHERE account_id = ? AND (ts IS NULL OR ts >= ?) ORDER BY block, log_index LIMIT ?`,
      leaderId, since, this.opts.maxEvents,
    );
    const entry = new Map<number, bigint>();
    const events: BtEvent[] = [];
    for (const r of rows) {
      const kind = r.kind.toUpperCase() as BtKind;
      const before = r.lots_before != null ? BigInt(r.lots_before) : 0n;
      const after = r.lots_after != null ? BigInt(r.lots_after) : 0n;
      let price = r.price != null ? BigInt(r.price) : undefined;
      if (price === undefined) {
        const last = db.get<{ price: string }>(
          'SELECT price FROM perpl_events WHERE perp_id = ? AND price IS NOT NULL AND block <= ? ORDER BY block DESC, log_index DESC LIMIT 1',
          r.perp_id, r.block,
        );
        price = last ? BigInt(last.price) : entry.get(r.perp_id) ?? 0n;
      }
      const prev = entry.get(r.perp_id) ?? 0n;
      if (kind === 'OPEN' || kind === 'INVERT' || prev === 0n) entry.set(r.perp_id, price);
      else if (kind === 'INCREASE' && after > before) entry.set(r.perp_id, (prev * before + price * (after - before)) / after);
      if (price === 0n) continue;
      events.push({
        perpId: r.perp_id,
        kind,
        side: r.position_type === SHORT ? SHORT : LONG,
        lotsAfter: after,
        lotsKnown: r.lots_after != null,
        pricePNS: price,
        entryPricePNS: entry.get(r.perp_id) ?? price,
        leverageHdths: r.leverage ?? 0,
        timestamp: r.ts ?? 0,
        block: r.block,
      });
      if (after === 0n) entry.delete(r.perp_id);
    }
    const ms: BtMarket[] = markets.map((m) => ({ perpId: m.perpId, lotDecimals: m.lotDecimals, priceDecimals: m.priceDecimals, lastPricePNS: null }));
    return { events, markets: ms, truncated: rows.length >= this.opts.maxEvents };
  }

  async run(leaderId: number, b: z.infer<typeof BacktestBody>, nowSec = Math.floor(Date.now() / 1000)) {
    const startTs = nowSec - b.period * 86_400;
    const { events, markets, truncated } = await this.history(leaderId, startTs);
    let slippage: { bps: number; source: string };
    if (b.slippageBps !== undefined) slippage = { bps: b.slippageBps, source: 'set in the request' };
    else {
      const measured = await this.quality.leaderMedianSlippageBps(leaderId).catch(() => null);
      slippage = measured
        ? { bps: Math.max(0, measured.bps), source: `median copy deviation measured on ${measured.samples} real copies of this leader (${measured.source}), floored at 0` }
        : { bps: this.opts.defaultSlippageBps, source: 'default assumption; not enough measured copies of this leader' };
    }
    const builder = this.opts.builder ? await this.opts.builder().catch(() => undefined) : undefined;
    const params: BtParams = {
      leaderAccountId: leaderId,
      ratioBps: b.ratioBps,
      maxLeverageHdths: b.maxLeverageHdths,
      maxSlippageBps: b.maxSlippageBps,
      maxEntryDeviationBps: b.maxEntryDeviationBps,
      markets: b.markets,
      budgetCNS: b.budgetCNS,
      lossStopBps: b.lossStopBps,
      dailyLossBps: b.dailyLossBps,
      drawdownBps: b.drawdownBps,
      stopLossPct: b.stopLossPct,
      takeProfitPct: b.takeProfitPct,
      flattenOnStop: b.flattenOnStop,
      depositCNS: b.depositCNS,
      slippageBps: slippage.bps,
      takerFeeBps: this.opts.takerFeeBps,
      builderFeePer100K: builder?.feePer100K ?? 0,
      maxBuilderFeePer100K: b.maxBuilderFeePer100K,
      safetyBps: this.opts.safetyBps,
      startTs,
      endTs: nowSec,
    };
    const result = runBacktest(events, markets, params);
    const assumptions = backtestAssumptions(params, slippage.source);
    if (truncated) assumptions.push(`Only the first ${events.length} leader events of the period were replayed.`);
    return {
      leaderAccountId: leaderId,
      period: `${b.period}d`,
      from: startTs,
      to: nowSec,
      source: 'indexer',
      slippage,
      takerFeeBps: this.opts.takerFeeBps,
      builderFee: builder ? { id: builder.id, feePer100K: builder.feePer100K, appliesTo: 'opening size only' } : null,
      ...result,
      simulation: true as const,
      trades: result.trades.slice(-200),
      assumptions,
    };
  }
}
