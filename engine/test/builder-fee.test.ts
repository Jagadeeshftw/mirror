import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Address, PublicClient } from 'viem';
import { Db } from '../src/db.js';
import { runBacktest, backtestAssumptions } from '../src/domain/backtest-run.js';
import type { BtEvent, BtMarket, BtParams } from '../src/domain/backtest-types.js';
import { LONG, SHORT } from '../src/domain/types.js';
import type { Reads } from '../src/chain/reads.js';
import type { MarketData } from '../src/perpl/market.js';
import type { Relayer } from '../src/services/relayer.js';
import { PolicyBody, QuoteBody, QuoteService } from '../src/services/quote.js';
import { Views } from '../src/services/views.js';
import { nullRegistry } from '../src/services/registry.js';
import { CopyQualityService } from '../src/services/quality.js';
import { IndexerClient } from '../src/services/indexer.js';
import { MATCH_NOW_REF } from '../src/services/constants.js';

const log = pino({ level: 'silent' });
const OWNER = '0x00000000000000000000000000000000000000b1' as Address;
const PREDICTED = '0x00000000000000000000000000000000000000c1' as Address;

/** Leader 7 long 100 lots at mark 1_000_000 (5 lot decimals, 1 price decimal: 1 lot = 1_000_000 CNS notional). */
function quoteService() {
  const reads = {
    builder: async () => ({ id: 26, feePer100K: 20 }),
    position: async () => ({ side: LONG, lots: 100n, mark: 1_000_000n, markValid: true, depositCNS: 50_000_000n, entryPricePNS: 1_000_000n, pnlCNS: 0n }),
  } as unknown as Reads;
  const market = {
    meta: () => ({ symbol: 'BTC', lotDecimals: 5, priceDecimals: 1 }),
    mark: async () => { throw new Error('no ws'); },
    expectedFill: async () => { throw new Error('no book'); },
  } as unknown as MarketData;
  const relayer = { predict: async () => PREDICTED, isAccount: async () => false } as unknown as Relayer;
  return new QuoteService({} as PublicClient, reads, market, relayer, 5, 100);
}

const body = (policy: Record<string, unknown> = {}) =>
  QuoteBody.parse({
    owner: OWNER,
    leaderAccountId: 7,
    policy: {
      maxLeverageHdths: 1_000, maxSlippageBps: 80, expiry: 4_000_000_000, stopSlippageBps: 100,
      leaders: [{ accountId: 7, ratioBps: 500, budgetCNS: '100000000' }], markets: [{ perpId: 1, maxNotionalCNS: '100000000' }], ...policy,
    },
  });

describe('quote builder fee', () => {
  it('defaults maxBuilderFeePer100K to 20 and caps it at 1000', () => {
    const base = { maxLeverageHdths: 1, maxSlippageBps: 1, expiry: 1, stopSlippageBps: 1, leaders: [{ accountId: 1, ratioBps: 1, budgetCNS: 1 }], markets: [{ perpId: 1, maxNotionalCNS: 1 }] };
    expect(PolicyBody.parse(base).maxBuilderFeePer100K).toBe(20);
    expect(PolicyBody.safeParse({ ...base, maxBuilderFeePer100K: 1_001 }).success).toBe(false);
  });

  it('estimates the fee on the planned opening size (notional x fee, rounded up)', async () => {
    const q = await quoteService().quote(body());
    // Target 5% of 100 lots = 5 lots -> notional 5_000_000 CNS; x 20 / 100,000 = 1_000.
    expect(q.quotes[0]).toMatchObject({ lotLNS: '5', notionalCNS: '5000000', builderFeeCNS: '1000', wouldBlock: null });
    expect(q.builderFee).toEqual({ id: 26, feePer100K: 20, estimateCNS: '1000', appliesTo: 'opening size only' });
    expect(q.matchOrders).toHaveLength(1);
  });

  it('a max below the fee would block the opening copy (BuilderFeeTooHigh) and drops it from the estimate', async () => {
    const q = await quoteService().quote(body({ maxBuilderFeePer100K: 10 }));
    expect(q.quotes[0]!.wouldBlock).toEqual({ reason: 'BuilderFeeTooHigh', limit: '10', actual: '20' });
    expect(q.builderFee.estimateCNS).toBe('0');
    expect(q.matchOrders).toHaveLength(0);
  });
});

const USER = '0x00000000000000000000000000000000000000a1';
const TEAM = '0x00000000000000000000000000000000000000d0';

function seed(db: Db) {
  for (const a of [USER, TEAM]) {
    db.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, max_leverage_hdths, max_builder_fee_per_100k) VALUES (?, ?, '0', 1, '0x', 300, 20)`, a, a);
  }
  let n = 0;
  const mirrored = (account: string, fee: string, opts: { ref?: string; orderType?: number; ts?: number } = {}) => {
    n += 1;
    db.run(
      `INSERT INTO feed (account, kind, tx_hash, log_index, block, ts, leader_id, perp_id, order_type, lots, leader_ref, data, builder_fee_cns) VALUES (?, 'Mirrored', ?, 0, ?, ?, 7, 1, ?, '1', ?, ?, ?)`,
      account, `0x${n.toString(16).padStart(4, '0')}`, n, opts.ts ?? 1_000 + n, opts.orderType ?? 0, opts.ref ?? `0xref${n}`,
      JSON.stringify({ proof: { leaderFillPNS: '0', fillPNS: '0', builderFeeCNS: fee } }), fee,
    );
  };
  mirrored(USER, '1000');
  mirrored(USER, '0', { orderType: 2 }); // close: never pays a builder fee
  mirrored(USER, '250', { ref: MATCH_NOW_REF });
  mirrored(TEAM, '7777');
}

describe('builder fee totals (team-run excluded)', () => {
  const reads = { account: async () => { throw new Error('offline'); }, tokenBalance: async () => 0n } as unknown as Reads;

  it('/v1/stats sums proof.builderFeeCNS for users and reports team-run separately', () => {
    const db = new Db(':memory:');
    seed(db);
    const views = new Views(db, reads, {} as MarketData, nullRegistry(new Set([TEAM])), undefined, 'https://x/tx/');
    const s = views.stats();
    expect(s).toMatchObject({ builderFeesCNS: '1250', builderFeesCopiesCNS: '1000', builderFeesMatchNowCNS: '250' });
    expect(s.teamRun).toMatchObject({ builderFeesCNS: '7777' });
  });

  it("/v1/stats leaves the team's own test accounts out of the user numbers and lists them separately", () => {
    const db = new Db(':memory:');
    seed(db);
    const views = new Views(db, reads, {} as MarketData, nullRegistry(new Set([TEAM])), undefined, 'https://x/tx/', undefined, new Set([USER]));
    const s = views.stats();
    expect(s).toMatchObject({ accountsCreated: 0, fundedAccounts: 0, copiesExecuted: 0, builderFeesCNS: '0' });
    expect(s.teamTest).toMatchObject({ accounts: [USER], accountsCreated: 1, copiesExecuted: 2, builderFeesCNS: '1250' });
    expect(s.teamRun).toMatchObject({ accounts: [TEAM], builderFeesCNS: '7777' });
  });

  it('account view sums its own copies and shows the signed max in the policy', async () => {
    const db = new Db(':memory:');
    seed(db);
    const views = new Views(db, reads, {} as MarketData, nullRegistry(new Set([TEAM])), undefined, 'https://x/tx/');
    const a = (await views.account(USER))!;
    expect(a.builderFeesCNS).toBe('1250');
    expect(a.policy).toMatchObject({ maxBuilderFeePer100K: 20 });
    expect(views.feed(USER).items[0]!.proof).toMatchObject({ builderFeeCNS: '250' });
  });

  it('/v1/stats/copy-quality totals builder fees per scope', async () => {
    const db = new Db(':memory:');
    seed(db);
    const svc = new CopyQualityService(db, new IndexerClient(undefined, log), (account) => account === TEAM);
    const r = await svc.report('all', undefined, 10_000);
    expect(r.aggregates.builderFeesCNS).toBe('1250');
    expect(r.teamRun.aggregates.builderFeesCNS).toBe('7777');
    expect(r.copies.find((c) => c.builderFeeCNS === '1000')).toBeDefined();
  });
});

describe('backtest builder fee on opening fills', () => {
  const DAY = 86_400;
  const t0 = 100 * DAY;
  const ev = (block: number, kind: BtEvent['kind'], side: 0 | 1, lotsAfter: number, price: number): BtEvent => ({
    perpId: 1, kind, side, lotsAfter: BigInt(lotsAfter), lotsKnown: true, pricePNS: BigInt(price), entryPricePNS: BigInt(price), leverageHdths: 500, timestamp: t0 + block, block,
  });
  // Lot decimals 0, price decimals 2: notional(lots, P) = lots x P x 1e4.
  const events = [ev(1, 'OPEN', LONG, 10, 10_000), ev(2, 'CLOSE', LONG, 0, 10_000), ev(3, 'OPEN', SHORT, 10, 10_000)];
  const markets: BtMarket[] = [{ perpId: 1, lotDecimals: 0, priceDecimals: 2, lastPricePNS: null }];
  const params: BtParams = {
    leaderAccountId: 7, ratioBps: 5_000, maxLeverageHdths: 1_000, maxSlippageBps: 100, maxEntryDeviationBps: 0,
    markets: [{ perpId: 1, maxNotionalCNS: 5_000_000_000n }], budgetCNS: 1_000_000_000n, lossStopBps: 0, dailyLossBps: 0, drawdownBps: 0,
    flattenOnStop: false, depositCNS: 10_000_000_000n, slippageBps: 0, takerFeeBps: 0, safetyBps: 5, startTs: t0, endTs: t0 + DAY,
  };

  it('charges notional x fee on opens only, rounded up', () => {
    const r = runBacktest(events, markets, { ...params, builderFeePer100K: 20 });
    // Two opens of 5 lots at 10_000: notional 500_000_000 each -> 100_000 each; the close pays none.
    expect(r.tradesCopied).toBe(3);
    expect(r.builderFeesCNS).toBe('200000');
    expect(r.feesCNS).toBe('200000');
    expect(r.trades.filter((t) => t.action === 'close').every((t) => t.feeCNS === '0')).toBe(true);
    expect(runBacktest(events, markets, params).builderFeesCNS).toBe('0');
  });

  it('blocks opens when the max is below the fee, and the assumptions mention the fee', () => {
    const r = runBacktest(events, markets, { ...params, builderFeePer100K: 20, maxBuilderFeePer100K: 10 });
    expect(r.tradesCopied).toBe(0);
    expect(Object.keys(r.tradesBlocked)).toEqual(['BuilderFeeTooHigh']);
    expect(backtestAssumptions({ ...params, builderFeePer100K: 20 }, 'x').some((a) => a.includes('builder fee of 20 per 100,000'))).toBe(true);
  });
});
