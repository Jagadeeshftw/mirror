import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Db } from '../src/db.js';
import { LeaderService } from '../src/services/leaders.js';
import { DemoService, BLOCKED_HOLD_MS } from '../src/services/demo.js';
import { tradeStats } from '../src/domain/leaderstats.js';
import { Bus } from '../src/services/bus.js';
import { RateLimiter } from '../src/services/ratelimit.js';
import type { FollowerInfo, Registry, RegistryLike } from '../src/services/registry.js';
import type { Reads } from '../src/chain/reads.js';
import type { MarketData } from '../src/perpl/market.js';
import type { NansenSignal } from '../src/nansen/client.js';

const log = pino({ level: 'silent' });
const addr = (id: number) => `0x${id.toString(16).padStart(40, '0')}`;
const DEMO_LEADER = 12;
const now = () => Math.floor(Date.now() / 1000);

/** 7 = ordinary leader; 9 = a MirrorAccount's Perpl account; 10 = a MirrorAccount known by address; 11 = team-run EOA; 12 = demo leader. */
function setup() {
  const db = new Db(':memory:');
  const t = now() - 3_600;
  let n = 0;
  const ev = (id: number, kind: string, dt: number, lotsAfter: string, pnl: string | null, lev: number | null = 300) =>
    db.run(
      `INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, delta_pnl, leverage) VALUES (?, 0, ?, ?, ?, 1, ?, 0, ?, ?, ?)`,
      `0x${(++n).toString(16)}`, n, t + dt, id, kind, lotsAfter, pnl, lev,
    );
  for (const id of [9, 10, 11, DEMO_LEADER]) {
    ev(id, 'open', 0, '1', null);
    ev(id, 'close', 10, '0', '5');
  }
  ev(7, 'open', 100, '2', null);
  ev(7, 'close', 400, '0', '300');
  ev(7, 'open', 500, '2', null);
  ev(7, 'decrease', 600, '1', '-100');
  ev(7, 'close', 1_100, '0', '-50');
  const mirror = { perplAccountId: 9, address: addr(0xa9), leaders: new Map() } as unknown as FollowerInfo;
  const registry: RegistryLike = {
    get: (a: string) => (a.toLowerCase() === addr(10) ? mirror : undefined),
    isTeamRun: (a: string) => [addr(11), addr(DEMO_LEADER)].includes(a.toLowerCase()),
    followersOf: () => [],
    all: () => [mirror],
    leaderIds: () => new Set(),
  };
  const reads = { accountAddress: async (id: number) => addr(id), perplBalance: async () => 100_000_000n, position: async () => { throw new Error('none'); } } as unknown as Reads;
  const market = { meta: () => ({ symbol: 'BTC' }), markets: () => [] } as unknown as MarketData;
  const nansen = { get: () => undefined, mode: 'none' } as unknown as NansenSignal;
  return (indexer?: string) => new LeaderService(db, reads, market, registry, nansen, indexer, () => DEMO_LEADER, log);
}

afterEach(() => vi.unstubAllGlobals());

describe('leaderboard never lists MirrorAccounts or team-run accounts as ordinary leaders', () => {
  it('engine ranking: drops MirrorAccount Perpl ids and addresses and team-run EOAs; keeps the demo leader flagged', async () => {
    const res = await setup()().list('30d');
    const ids = res.leaders.map((l) => l.accountId).sort((a, b) => a - b);
    expect(ids).toEqual([7, DEMO_LEADER]);
    expect(res.leaders.find((l) => l.accountId === DEMO_LEADER)!.teamRun).toBe(true);
    expect(res.leaders.find((l) => l.accountId === 7)!.teamRun).toBe(false);
  });

  it('indexer ranking: the same filter applies to its rows', async () => {
    const row = (id: number) => ({ accountId: id, netPnlCNS: 1, pnlBps: 1, trades: 9, closingTrades: 5, winRateBps: 5000, avgLeverageHdths: 300, maxDrawdownBps: 0, activeDays: 3, leaderStats: { address: addr(id), teamRun: false, followers: 0, marketsTraded: [1], capitalBaseCNS: 1 } });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { LeaderWindowStats: [7, 9, 10, 11, DEMO_LEADER].map(row) } })));
    const res = await setup()('http://indexer/graphql').list('30d');
    expect(res.source).toBe('indexer');
    expect(res.leaders.map((l) => l.accountId).sort((a, b) => a - b)).toEqual([7, DEMO_LEADER]);
  });
});

describe('leader profile stats: profit factor, largest loss, average hold', () => {
  it('engine profile derives them from the stored position events', async () => {
    const p = await setup()().profile(7, '30d');
    // Profit 300, losses 100 + 50: factor 2; holds 300 s and 600 s.
    expect(p.stats).toMatchObject({ profitFactor: 2, largestLossCNS: '-100', avgHoldSec: 450, roundTrips: 2 });
  });

  it('indexer profile derives them from its PositionEvents (indexer kinds) next to its own stats', async () => {
    const t = now() - 1_000;
    const statsEvents = [
      { kind: 'CLOSE', perpId: 1, lotsAfterLNS: '0', realizedPnlCNS: '-40', timestamp: t + 120 },
      { kind: 'LIQUIDATION', perpId: 2, lotsAfterLNS: '0', realizedPnlCNS: '-60', timestamp: t + 90 },
      { kind: 'OPEN', perpId: 2, lotsAfterLNS: '1', realizedPnlCNS: '0', timestamp: t + 30 },
      { kind: 'OPEN', perpId: 1, lotsAfterLNS: '1', realizedPnlCNS: '0', timestamp: t },
    ];
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { PerplAccount_by_pk: { address: addr(7), teamRun: false, stats: { trades: 4, closingTrades: 2 }, statsEvents } } })));
    const p = await setup()('http://indexer/graphql').profile(7, '30d');
    expect(p.source).toBe('indexer');
    expect(p.stats).toMatchObject({ trades: 4, profitFactor: 0, largestLossCNS: '-60', avgHoldSec: 90, roundTrips: 2 });
  });

  it('tradeStats: invert closes one round trip and starts the next; no losses -> profit factor null', () => {
    const s = tradeStats([
      { t: 0, perpId: 1, kind: 'open', lotsAfter: 1n, pnlCNS: null },
      { t: 50, perpId: 1, kind: 'invert', lotsAfter: 2n, pnlCNS: 10n },
      { t: 150, perpId: 1, kind: 'close', lotsAfter: 0n, pnlCNS: 5n },
    ]);
    expect(s).toMatchObject({ profitFactor: null, grossProfitCNS: '15', largestLossCNS: '0', avgHoldSec: 75, roundTrips: 2 });
    expect(tradeStats([])).toMatchObject({ avgHoldSec: null, roundTrips: 0 });
  });
});

describe('demo cycles carry holdMs', () => {
  it('trade cycles hold DEMO_HOLD_MS, blocked cycles close after BLOCKED_HOLD_MS', async () => {
    const db = new Db(':memory:');
    db.run(`INSERT INTO demo_cycles (id, kind, ip, status, started_ms) VALUES ('a', 'trade', 'x', 'done', 2), ('b', 'blocked', 'x', 'done', 1)`);
    const demo = new DemoService(db, {} as Reads, undefined, addr(1) as never, { get: () => undefined } as unknown as Registry, {} as MarketData, new Bus(), new RateLimiter(), {
      perpId: 1, lots: 1, leverageHdths: 200, blockedLeverageHdths: 1000, holdMs: 15_000, slippageBps: 50, ipHourly: 3, dailyCap: 10, followerAccount: undefined,
    }, log);
    const s = await demo.state();
    expect(s.cycles.map((c) => [(c as Record<string, unknown>).id, c.holdMs])).toEqual([['a', 15_000], ['b', BLOCKED_HOLD_MS]]);
    expect(s.holdMsByKind).toEqual({ trade: 15_000, blocked: 2_000 });
  });
});
