import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.js';
import { depthWithinLimit, guardLabel, multipleToBps, thinBookDecision } from '../src/domain/thinbook.js';
import { CLOSE_LONG, CLOSE_SHORT, OPEN_LONG, OPEN_SHORT } from '../src/domain/types.js';
import { ThinBookGuard, type DepthSource } from '../src/services/guard.js';
import { feedJson, type FeedRow } from '../src/services/feed.js';
import { Bus } from '../src/services/bus.js';

const book = {
  bids: [{ p: 999, s: 3 }, { p: 998, s: 4 }, { p: 990, s: 10 }],
  asks: [{ p: 1001, s: 2 }, { p: 1003, s: 5 }, { p: 1010, s: 20 }],
};

describe('depthWithinLimit', () => {
  it('a buy takes asks at or below the limit', () => {
    expect(depthWithinLimit(book, OPEN_LONG, 1000n)).toBe(0n);
    expect(depthWithinLimit(book, OPEN_LONG, 1001n)).toBe(2n);
    expect(depthWithinLimit(book, OPEN_LONG, 1003n)).toBe(7n);
    expect(depthWithinLimit(book, CLOSE_SHORT, 1010n)).toBe(27n);
  });
  it('a sell takes bids at or above the limit', () => {
    expect(depthWithinLimit(book, OPEN_SHORT, 1000n)).toBe(0n);
    expect(depthWithinLimit(book, OPEN_SHORT, 999n)).toBe(3n);
    expect(depthWithinLimit(book, OPEN_SHORT, 998n)).toBe(7n);
    expect(depthWithinLimit(book, CLOSE_LONG, 1n)).toBe(17n);
  });
  it('ignores level order and empty levels', () => {
    const shuffled = { bids: [], asks: [{ p: 1010, s: 20 }, { p: 1001, s: 0 }, { p: 1003, s: 5 }] };
    expect(depthWithinLimit(shuffled, OPEN_LONG, 1005n)).toBe(5n);
  });
});

describe('thinBookDecision', () => {
  const x2 = multipleToBps(2);
  it('passes when depth >= ceil(lots x multiple)', () => {
    expect(thinBookDecision(5n, 10n, x2)).toMatchObject({ decision: 'ok', finalLots: 5n, requiredLots: 10n });
    expect(thinBookDecision(3n, 5n, multipleToBps(1.5))).toMatchObject({ decision: 'ok', requiredLots: 5n }); // ceil(4.5)
  });
  it('shrinks to floor(depth / multiple) when that is at least one lot', () => {
    expect(thinBookDecision(5n, 9n, x2)).toMatchObject({ decision: 'shrunk', reason: 'thin_book', finalLots: 4n, depthLots: 9n });
    expect(thinBookDecision(10n, 2n, x2)).toMatchObject({ decision: 'shrunk', finalLots: 1n });
  });
  it('skips when less than one lot would remain, or without a book', () => {
    expect(thinBookDecision(5n, 1n, x2)).toMatchObject({ decision: 'skipped', reason: 'thin_book', finalLots: 0n });
    expect(thinBookDecision(5n, 0n, x2)).toMatchObject({ decision: 'skipped', reason: 'thin_book' });
    expect(thinBookDecision(5n, null, x2)).toMatchObject({ decision: 'skipped', reason: 'book_unavailable', depthLots: null });
  });
  it('a 1x multiple never shrinks below depth and multiples under 1 are raised to 1', () => {
    expect(multipleToBps(0.5)).toBe(10_000);
    expect(thinBookDecision(5n, 3n, multipleToBps(1))).toMatchObject({ decision: 'shrunk', finalLots: 3n });
  });
  it('labels', () => {
    expect(guardLabel({ decision: 'shrunk', reason: 'thin_book' })).toBe('Shrunk: thin book');
    expect(guardLabel({ decision: 'skipped', reason: 'thin_book' })).toBe('Skipped: thin book');
    expect(guardLabel({ decision: 'skipped', reason: 'book_unavailable' })).toBe('Skipped: book unavailable');
  });
});

describe('ThinBookGuard', () => {
  const ACC = '0x00000000000000000000000000000000000000aa';
  const depth = (d: bigint | null): DepthSource => ({ depth: async () => ({ depthLots: d, source: d === null ? 'none' : 'ws', ageMs: 120 }) });

  it('records a shrink in guard_events and as an engine-side feed row without a tx', async () => {
    const db = new Db(':memory:');
    const bus = new Bus();
    const seen: unknown[] = [];
    bus.subscribe(ACC, (ev) => seen.push(ev));
    const g = new ThinBookGuard(db, depth(9n), bus, true, 2, 'https://x/tx/');
    const r = await g.check(1, OPEN_LONG, 5n, 1005n);
    expect(r).toMatchObject({ decision: 'shrunk', finalLots: 4n, bookSource: 'ws' });
    g.record({ account: ACC, source: 'keeper', leaderId: 7, leaderRef: '0xabc', perpId: 1, orderType: OPEN_LONG, limitPNS: 1005n, block: 100 }, r, 1_700_000_000_000);
    const ev = db.get<Record<string, unknown>>('SELECT * FROM guard_events');
    expect(ev).toMatchObject({ decision: 'shrunk', reason: 'thin_book', requested_lots: '5', final_lots: '4', depth_lots: '9', required_lots: '10', multiple_bps: 20_000, book_source: 'ws' });
    const row = db.get<FeedRow>('SELECT * FROM feed')!;
    const item = feedJson(row, 'https://x/tx/');
    expect(item).toMatchObject({ kind: 'EngineShrunk', onchain: false, label: 'Shrunk: thin book', txHash: null, txUrl: null, reason: 'ThinBook', lotLNS: '4', limit: '10', actual: '9', commitState: 'offchain' });
    expect(seen).toHaveLength(1);
  });

  it('records skips, de-duplicates repeated quotes and keeps onchain feed rows marked onchain', async () => {
    const db = new Db(':memory:');
    const g = new ThinBookGuard(db, depth(null), undefined, true, 2, 'https://x/tx/');
    const r = await g.check(1, OPEN_SHORT, 3n, 990n);
    expect(r).toMatchObject({ decision: 'skipped', reason: 'book_unavailable', bookSource: 'none' });
    const ctx = { account: ACC, source: 'quote' as const, leaderId: 7, leaderRef: null, perpId: 1, orderType: OPEN_SHORT, limitPNS: 990n, block: 0 };
    expect(g.record(ctx, r, 1_000_000)).toBeTypeOf('number');
    expect(g.record(ctx, r, 1_030_000)).toBeUndefined();
    expect(g.record(ctx, r, 1_070_000)).toBeTypeOf('number');
    expect(db.all('SELECT * FROM guard_events')).toHaveLength(2);
    const item = feedJson(db.get<FeedRow>('SELECT * FROM feed')!, 'https://x/tx/');
    expect(item).toMatchObject({ kind: 'EngineSkipped', label: 'Skipped: book unavailable', reason: 'BookUnavailable', onchain: false });
    const chain = feedJson({ ...db.get<FeedRow>('SELECT * FROM feed')!, kind: 'Blocked', tx_hash: '0xdead', data: null }, 'https://x/tx/');
    expect(chain).toMatchObject({ onchain: true, label: null, txHash: '0xdead', txUrl: 'https://x/tx/0xdead' });
  });

  it('is a no-op when disabled', async () => {
    const db = new Db(':memory:');
    const g = new ThinBookGuard(db, depth(0n), undefined, false, 2, '');
    expect(await g.check(1, OPEN_LONG, 5n, 1n)).toMatchObject({ decision: 'ok', finalLots: 5n });
  });
});
