import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Db } from '../src/db.js';
import { runBacktest, maxDrawdown, dailyCurve } from '../src/domain/backtest-run.js';
import type { BtEvent, BtMarket, BtParams } from '../src/domain/backtest-types.js';
import { LONG, SHORT } from '../src/domain/types.js';
import { BacktestBody, BacktestService } from '../src/services/backtest.js';
import { IndexerClient } from '../src/services/indexer.js';
import { CopyQualityService } from '../src/services/quality.js';

/*
 * Hand-computed scenario. Two markets with lotDecimals 0 and priceDecimals 2, so notional(lots, P) = lots x P x 1e4
 * collateral units (P = 10_000 is $100). Follower: ratio 50%, max 10x, slippage 1%, entry filter 50 bps, budget $250,
 * leader loss stop 10% of budget ($25), take-profit 3%, deposit $10,000. Fills: leader price moved 10 bps against the
 * follower; fee 10 bps. The keeper's safety margin is 5 bps.
 *
 * E1 perp1 OPEN long 10 @10_000 (5x): copy 5 lots. Limit min(10_000 x 1.0095, 10_000 x 1.005) = 10_050; fill 10_010.
 *    fee 500_500; margin ceil(500_500_000 x 100 / 500) = 100_100_000.
 * E2 perp1 INCREASE to 20 @10_200, leader entry 10_100: entry bound 10_150 < mark 10_200 -> EntryTooFar.
 * E3 perp1 INCREASE to 30 @10_100 (2x): 10 more lots need margin ceil(10 x 10_150 x 1e4 x 100 / 200) = 507_500_000;
 *    100_100_000 + 507_500_000 > 250_000_000 -> LeaderBudgetExceeded.
 * E4 perp1 DECREASE to 24 @10_400: take-profit at 10_010 x 1.03 = 10_310 (floored) is reached first: close 5 @10_389
 *    (10_400 x 0.999), pnl 379 x 5 x 1e4 = 18_950_000, fee 519_450; perp1 halted. Realized 17_930_050.
 * E5 perp2 OPEN short 40 @5_000 (10x): copy 20 lots, limit max(4_953, 4_975) = 4_975, fill 4_995; fee 999_000,
 *    margin 99_900_000. Realized 16_931_050.
 * E6 perp2 INCREASE to 50 @5_250, entry 5_050: budget ok (126_150_000) but leader PnL 16_931_050 - 255 x 20 x 1e4
 *    = -34_068_950 < -25_000_000 -> LeaderLossStop (latched).
 * E7 perp2 CLOSE @5_100: close 20 @5_105, pnl -22_000_000, fee 1_021_000. Realized -6_089_950.
 * E8 perp2 OPEN short: LeaderLossStop (latched). E9 perp1 INCREASE: MarketHalted.
 * E10 perp3 (not in policy) and E11 (size unknown) are skipped.
 * Equity after each event: 9_998_999_500, 10_008_999_500, 10_003_999_500, 10_017_930_050 (peak), 10_015_931_050,
 * 9_965_931_050 (trough), 9_993_910_050 ... -> max drawdown 51_999_000 (51 bps of the peak).
 */
const DAY = 86_400;
const t0 = 100 * DAY;
const ev = (block: number, t: number, perpId: number, kind: BtEvent['kind'], side: 0 | 1, lotsAfter: number, price: number, entry: number, lev: number, lotsKnown = true): BtEvent => ({
  perpId, kind, side, lotsAfter: BigInt(lotsAfter), lotsKnown, pricePNS: BigInt(price), entryPricePNS: BigInt(entry), leverageHdths: lev, timestamp: t, block,
});
const events: BtEvent[] = [
  ev(1, t0 + 100, 1, 'OPEN', LONG, 10, 10_000, 10_000, 500),
  ev(2, t0 + 200, 1, 'INCREASE', LONG, 20, 10_200, 10_100, 500),
  ev(3, t0 + 300, 1, 'INCREASE', LONG, 30, 10_100, 10_100, 200),
  ev(4, t0 + DAY + 100, 1, 'DECREASE', LONG, 24, 10_400, 10_100, 200),
  ev(5, t0 + DAY + 200, 2, 'OPEN', SHORT, 40, 5_000, 5_000, 1000),
  ev(6, t0 + 2 * DAY + 100, 2, 'INCREASE', SHORT, 50, 5_250, 5_050, 1000),
  ev(7, t0 + 2 * DAY + 200, 2, 'CLOSE', SHORT, 0, 5_100, 0, 1000),
  ev(8, t0 + 3 * DAY + 100, 2, 'OPEN', SHORT, 10, 5_000, 5_000, 1000),
  ev(9, t0 + 3 * DAY + 200, 1, 'INCREASE', LONG, 30, 10_000, 10_000, 200),
  ev(10, t0 + 3 * DAY + 300, 3, 'OPEN', LONG, 10, 100, 100, 200),
  ev(11, t0 + 3 * DAY + 400, 1, 'INCREASE', LONG, 40, 10_000, 10_000, 200, false),
];
const markets: BtMarket[] = [1, 2, 3].map((perpId) => ({ perpId, lotDecimals: 0, priceDecimals: 2, lastPricePNS: null }));
const params: BtParams = {
  leaderAccountId: 7, ratioBps: 5_000, maxLeverageHdths: 1_000, maxSlippageBps: 100, maxEntryDeviationBps: 50,
  markets: [{ perpId: 1, maxNotionalCNS: 5_000_000_000n }, { perpId: 2, maxNotionalCNS: 5_000_000_000n }],
  budgetCNS: 250_000_000n, lossStopBps: 1_000, dailyLossBps: 0, drawdownBps: 0, takeProfitPct: 3, flattenOnStop: false,
  depositCNS: 10_000_000_000n, slippageBps: 10, takerFeeBps: 10, safetyBps: 5, startTs: t0, endTs: t0 + 4 * DAY - 1,
};

describe('backtest replay (hand-computed)', () => {
  const r = runBacktest(events, markets, params);

  it('copies, blocks and stops exactly as computed by hand', () => {
    expect(r.simulation).toBe(true);
    expect(r.tradesCopied).toBe(3);
    expect(r.tradesBlocked).toEqual({ EntryTooFar: 1, LeaderBudgetExceeded: 1, LeaderLossStop: 2, MarketHalted: 1 });
    expect(r.tradesBlockedTotal).toBe(5);
    expect(r.skipped).toEqual({ MarketNotInPolicy: 1, LeaderSizeOrPriceUnknown: 1 });
    expect(r.stops).toEqual([{ t: t0 + DAY + 100, kind: 'TakeProfit', perpId: 1 }]);
    expect(r.trades.map((t) => [t.action, t.perpId, t.side, t.lots, t.fillPNS, t.feeCNS, t.pnlCNS])).toEqual([
      ['open', 1, 'long', '5', '10010', '500500', '-500500'],
      ['stop', 1, 'long', '5', '10389', '519450', String(18_950_000 - 519_450)],
      ['open', 2, 'short', '20', '4995', '999000', '-999000'],
      ['close', 2, 'short', '20', '5105', '1021000', String(-22_000_000 - 1_021_000)],
    ]);
  });

  it('final PnL, fees, drawdown and the daily equity curve', () => {
    expect(r.finalEquityCNS).toBe('9993910050');
    expect(r.pnlCNS).toBe('-6089950');
    expect(r.feesCNS).toBe(String(500_500 + 519_450 + 999_000 + 1_021_000));
    expect(r.maxDrawdownCNS).toBe('51999000');
    expect(r.maxDrawdownBps).toBe(51);
    expect(r.pnlPct).toBe(-0.0608);
    expect(r.openPositions).toEqual([]);
    expect(r.eventsReplayed).toBe(11);
    expect(r.equityCurve).toEqual([
      { day: 100, date: '1970-04-11', equityCNS: '10003999500' },
      { day: 101, date: '1970-04-12', equityCNS: '10015931050' },
      { day: 102, date: '1970-04-13', equityCNS: '9993910050' },
      { day: 103, date: '1970-04-14', equityCNS: '9993910050' },
    ]);
  });

  it('is deterministic and independent of input order', () => {
    const again = runBacktest([...events].reverse(), markets, params);
    expect(again).toEqual(r);
  });

  it('flattenOnStop closes everything when the leader loss stop is hit', () => {
    const f = runBacktest(events, markets, { ...params, flattenOnStop: true });
    // At E6 the stop executor flattens before the copy: 20 lots closed @5_255 (5_250 x 1.001).
    expect(f.stops.map((s) => s.kind)).toEqual(['TakeProfit', 'LeaderLoss']);
    expect(f.trades[3]).toMatchObject({ action: 'stop', perpId: 2, lots: '20', fillPNS: '5255', note: 'LeaderLoss' });
    expect(f.tradesCopied).toBe(2);
  });

  it('helpers: drawdown and the daily curve', () => {
    expect(maxDrawdown(100n, [120n, 90n, 130n, 117n])).toEqual({ cns: 30n, bps: 2500 });
    expect(dailyCurve(5n, [], 0, DAY)).toEqual([{ day: 0, date: '1970-01-01', equityCNS: '5' }, { day: 1, date: '1970-01-02', equityCNS: '5' }]);
  });
});

describe('BacktestService', () => {
  const log = pino({ level: 'silent' });
  afterEach(() => vi.unstubAllGlobals());
  const body = BacktestBody.parse({ ratioBps: 5000, maxLeverageHdths: 1000, markets: [{ perpId: 1, maxNotionalCNS: '5000000000' }], budgetCNS: '250000000', depositCNS: '10000000000', period: '7d' });

  it('returns 503 history unavailable without an indexer', async () => {
    const db = new Db(':memory:');
    const svc = new BacktestService(new IndexerClient(undefined, log), new CopyQualityService(db, new IndexerClient(undefined, log), () => false), { defaultSlippageBps: 5, takerFeeBps: 3.5, safetyBps: 5, maxEvents: 1000 });
    await expect(svc.run(7, body)).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('history unavailable') });
  });

  it('replays indexer PositionEvent rows with the default slippage and lists assumptions', async () => {
    const now = 1_000 * DAY;
    const row = (b: number, kind: string, lots: string, price: string) => ({ perpId: 1, kind, side: 'LONG', lotsAfterLNS: lots, lotsKnown: true, pricePNS: price, entryPricePNS: '10000', leverageHdths: 500, blockNumber: b, timestamp: now - DAY + b, market: { lotDecimals: 0, priceDecimals: 2, lastPricePNS: '10000' } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const q = JSON.parse(init.body) as { query: string; variables: { accountId: number } };
      if (q.query.includes('PositionEvent')) return new Response(JSON.stringify({ data: { PositionEvent: [row(1, 'OPEN', '10', '10000'), row(2, 'CLOSE', '0', '10100')] } }));
      return new Response(JSON.stringify({ errors: ['no quality'] }));
    }));
    const db = new Db(':memory:');
    const idx = new IndexerClient('http://indexer/v1/graphql', log);
    const svc = new BacktestService(idx, new CopyQualityService(db, idx, () => false), { defaultSlippageBps: 5, takerFeeBps: 3.5, safetyBps: 5, maxEvents: 1000 });
    const r = await svc.run(7, body, now);
    expect(r).toMatchObject({ simulation: true, source: 'indexer', period: '7d', tradesCopied: 2, slippage: { bps: 5 }, takerFeeBps: 3.5 });
    // open 5 @10_005, close 5 @10_094 (10_100 x 0.9995 floored): pnl 89 x 5 x 1e4 = 4_450_000; fees 175_087 + 176_645.
    expect(r.pnlCNS).toBe(String(4_450_000 - 175_087 - 176_645));
    expect(r.assumptions.length).toBeGreaterThan(5);
    expect(r.assumptions.join(' ')).toContain('Funding payments are ignored');
  });
});
