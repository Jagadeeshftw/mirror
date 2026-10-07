import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { Db } from '../src/db.js';
import { EquityService } from '../src/services/equity.js';
import { Views } from '../src/services/views.js';
import { nullRegistry } from '../src/services/registry.js';
import { riskView, thin, todayPnl } from '../src/domain/risk.js';
import type { AccountState, Reads } from '../src/chain/reads.js';
import type { MarketData } from '../src/perpl/market.js';
import type { Relayer } from '../src/services/relayer.js';

const A = '0x00000000000000000000000000000000000000a1';
const OWNER = '0x00000000000000000000000000000000000000b1' as Address;
const DAY = 86_400;
const T0 = 20_000 * DAY; // a UTC midnight

function db() {
  const d = new Db(':memory:');
  d.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, created_ts, net_deposits) VALUES (?, ?, '0x0', 1, '0xc0', ?, '20000000')`, A, OWNER.toLowerCase(), T0 - 5 * DAY);
  return d;
}

describe('equity snapshots', () => {
  it('records at most one periodic snapshot per interval, but always on activity', async () => {
    const d = db();
    let eq = 20_000_000n;
    const svc = new EquityService(d, async () => eq, { intervalMs: 300_000 });
    expect(await svc.snapshot(A, 'periodic', false)).toBe(true);
    eq = 21_000_000n;
    expect(await svc.snapshot(A, 'periodic', false)).toBe(false);
    expect(await svc.snapshot(A, 'Mirrored', true)).toBe(true);
    const rows = d.all<{ reason: string; equity_cns: string; net_deposits_cns: string }>('SELECT reason, equity_cns, net_deposits_cns FROM equity_snapshots ORDER BY rowid');
    expect(rows).toEqual([
      { reason: 'periodic', equity_cns: '20000000', net_deposits_cns: '20000000' },
      { reason: 'Mirrored', equity_cns: '21000000', net_deposits_cns: '20000000' },
    ]);
    svc.noteView(A, 1n); // within the interval: not recorded
    expect(d.all('SELECT * FROM equity_snapshots')).toHaveLength(2);
  });

  it('a failed equity read records nothing', async () => {
    const d = db();
    const svc = new EquityService(d, async () => { throw new Error('rpc down'); }, { intervalMs: 1_000 });
    expect(await svc.snapshot(A, 'Deposited', true)).toBe(false);
  });

  it('history: last 30 days, oldest first, thinned to maxPoints', () => {
    const d = db();
    const svc = new EquityService(d, async () => 0n, { intervalMs: 300_000, maxPoints: 10 });
    svc.record(A, 1n, 'periodic', T0 - 40 * DAY); // older than 30 days
    for (let i = 0; i < 50; i++) svc.record(A, BigInt(100 + i), 'periodic', T0 - 20 * DAY + i * 3600);
    const h = svc.history(A, 30, T0);
    expect(h.length).toBeLessThanOrEqual(10);
    expect(h[0]).toEqual({ t: T0 - 20 * DAY, equityCNS: '100' });
    expect(h.at(-1)).toEqual({ t: T0 - 20 * DAY + 49 * 3600, equityCNS: '149' });
    expect(h.every((p, i) => i === 0 || p.t > h[i - 1]!.t)).toBe(true);
  });

  it("today's PnL: equity now vs the first snapshot of the UTC day, net of deposits and withdrawals", () => {
    const d = db();
    const svc = new EquityService(d, async () => 0n, { intervalMs: 300_000 });
    expect(svc.today(A, 1n, 0n, T0 + 100)).toBeNull();
    svc.record(A, 19_000_000n, 'periodic', T0 - 600, '20000000'); // yesterday
    expect(svc.today(A, 19_500_000n, 20_000_000n, T0 + 100)).toBe(500_000n); // falls back to the last one before today
    svc.record(A, 19_200_000n, 'periodic', T0 + 60, '20000000'); // first of today
    svc.record(A, 24_200_000n, 'Deposited', T0 + 120, '25000000'); // +5 AUSD deposited
    // Equity 24.0 with 25.0 net deposits: -1.0 now vs -0.8 at the day's start = -0.2 today.
    expect(svc.today(A, 24_000_000n, 25_000_000n, T0 + 200)).toBe(-200_000n);
    expect(todayPnl(1n, 0n, undefined)).toBeNull();
  });
});

describe('loss stops against current equity (MirrorAccount._checkLossStops)', () => {
  const today = Math.floor(T0 / DAY);
  const base = { riskDay: today, dayStartEquity: 20_000_000n, highWaterEquity: 25_000_000n, dailyLossBps: 1_000, drawdownBps: 2_000 };
  it('daily loss below the day floor, drawdown below the high-water floor', () => {
    expect(riskView({ ...base, equity: 18_500_000n }, T0 + 10)).toMatchObject({ dailyLossHit: false, drawdownHit: true, dailyLossFloorCNS: '18000000', drawdownFloorCNS: '20000000' });
    expect(riskView({ ...base, equity: 17_000_000n }, T0 + 10)).toMatchObject({ dailyLossHit: true, drawdownHit: true });
    expect(riskView({ ...base, equity: 21_000_000n }, T0 + 10)).toMatchObject({ dailyLossHit: false, drawdownHit: false });
  });
  it('a new UTC day restarts the day at current equity; rules at 0 are off', () => {
    expect(riskView({ ...base, riskDay: today - 1, equity: 17_000_000n }, T0 + 10)).toMatchObject({ dailyLossHit: false, dayStartEquityCNS: '17000000' });
    expect(riskView({ ...base, dailyLossBps: 0, drawdownBps: 0, equity: 1n }, T0 + 10)).toMatchObject({ dailyLossHit: false, drawdownHit: false, dailyLossFloorCNS: null, drawdownFloorCNS: null });
  });
  it('thin keeps short series as they are', () => {
    const pts = [{ t: 1 }, { t: 2 }];
    expect(thin(pts, 10)).toBe(pts);
  });
});

describe('account and owner views', () => {
  const state = (equity: bigint): AccountState => ({
    equity, riskDay: Math.floor(Date.now() / 1000 / DAY), dayStartEquity: 20_000_000n, highWaterEquity: 22_000_000n, dailyLossBps: 500, drawdownBps: 1_000,
  }) as unknown as AccountState;
  const reads = (equity: bigint, wallet = 7_000_000n) => ({
    account: async () => state(equity),
    tokenBalance: vi.fn(async (a: string) => (a.toLowerCase() === OWNER.toLowerCase() ? wallet : 0n)),
  }) as unknown as Reads;

  it('/v1/accounts/:account: equityHistory, todayPnlCNS, dailyLossHit / drawdownHit, createdAt', async () => {
    const d = db();
    const eqSvc = new EquityService(d, async () => 0n, { intervalMs: 300_000 });
    const now = Math.floor(Date.now() / 1000);
    eqSvc.record(A, 20_000_000n, 'Deposited', Math.floor(now / DAY) * DAY, '20000000');
    const views = new Views(d, reads(18_900_000n), {} as MarketData, nullRegistry(new Set()), undefined, 'https://x/tx/', eqSvc);
    const a = (await views.account(A))!;
    expect(a).toMatchObject({ todayPnlCNS: '-1100000', dailyLossHit: true, drawdownHit: true });
    expect(a.createdAt).toBe(T0 - 5 * DAY);
    expect(a.risk).toMatchObject({ dailyLossFloorCNS: '19000000', drawdownFloorCNS: '19800000' });
    expect(a.equityHistory.length).toBeGreaterThanOrEqual(1);
    expect(a.equityHistory[0]).toMatchObject({ equityCNS: '20000000' });
  });

  it('without chain reads the flags are false and today is null', async () => {
    const d = db();
    const offline = { account: async () => { throw new Error('offline'); }, tokenBalance: async () => 0n } as unknown as Reads;
    const a = (await new Views(d, offline, {} as MarketData, nullRegistry(new Set()), undefined, 'https://x/tx/', new EquityService(d, async () => 0n, { intervalMs: 1 })).account(A))!;
    expect(a).toMatchObject({ todayPnlCNS: null, dailyLossHit: false, drawdownHit: false, risk: null, equityHistory: [] });
  });

  it("/v1/owners/:owner/accounts carries the owner's wallet AUSD balance (walletCNS)", async () => {
    const d = db();
    const r = reads(20_000_000n, 7_000_000n);
    const res = await new Views(d, r, {} as MarketData, nullRegistry(new Set()), undefined, 'https://x/tx/').ownerAccounts(OWNER);
    expect(res.walletCNS).toBe('7000000');
    expect(res.accounts).toHaveLength(1);
    const fresh = '0x00000000000000000000000000000000000000b2' as Address;
    const relayer = { predict: async () => '0x00000000000000000000000000000000000000c1' } as unknown as Relayer;
    const none = await new Views(d, { tokenBalance: async () => { throw new Error('x'); } } as unknown as Reads, {} as MarketData, nullRegistry(new Set()), relayer, '').ownerAccounts(fresh);
    expect(none).toMatchObject({ walletCNS: null, accounts: [{ predicted: true }] });
  });
});
