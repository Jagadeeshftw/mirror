import { z } from 'zod';
import { LONG, SHORT } from '../domain/types.js';
import { backtestAssumptions, runBacktest } from '../domain/backtest-run.js';
import type { BtEvent, BtKind, BtMarket, BtParams } from '../domain/backtest-types.js';
import type { IndexerClient } from './indexer.js';
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
}

/** POST /v1/leaders/:id/backtest: history from the indexer's PositionEvent, replay in domain/backtest. */
export class BacktestService {
  constructor(
    private readonly indexer: IndexerClient,
    private readonly quality: CopyQualityService,
    private readonly opts: BacktestOptions,
  ) {}

  async history(leaderId: number, since: number): Promise<{ events: BtEvent[]; markets: BtMarket[]; truncated: boolean }> {
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
      ...result,
      simulation: true as const,
      trades: result.trades.slice(-200),
      assumptions,
    };
  }
}
