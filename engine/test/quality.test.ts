import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Db } from '../src/db.js';
import { aggregateScope, buildQuality, deviationBps, nearestRank, type CopySample } from '../src/domain/quality.js';
import { CLOSE_LONG, CLOSE_SHORT, OPEN_LONG, OPEN_SHORT } from '../src/domain/types.js';
import { CopyQualityService } from '../src/services/quality.js';
import { IndexerClient } from '../src/services/indexer.js';
import { MATCH_NOW_REF } from '../src/services/constants.js';

const log = pino({ level: 'silent' });

describe('deviationBps (positive = follower worse)', () => {
  it('buys: paying more is worse; sells: receiving less is worse', () => {
    expect(deviationBps(OPEN_LONG, 10_000n, 10_010n)).toBe(10);
    expect(deviationBps(CLOSE_SHORT, 10_000n, 9_990n)).toBe(-10);
    expect(deviationBps(OPEN_SHORT, 10_000n, 9_980n)).toBe(20);
    expect(deviationBps(CLOSE_LONG, 10_000n, 10_005n)).toBe(-5);
  });
  it('is null without both prices', () => {
    expect(deviationBps(OPEN_LONG, null, 1n)).toBeNull();
    expect(deviationBps(OPEN_LONG, 1n, 0n)).toBeNull();
  });
});

describe('nearestRank', () => {
  it('uses the ceil(p x n)-th smallest value', () => {
    expect(nearestRank([], 0.5)).toBeNull();
    expect(nearestRank([5], 0.9)).toBe(5);
    expect(nearestRank([4, 1, 3, 2], 0.5)).toBe(2);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9)).toBe(10);
  });
});

const sample = (o: Partial<CopySample>): CopySample => ({
  txHash: '0x1', account: '0xa', leaderAccountId: 1, perpId: 1, orderType: OPEN_LONG, lotLNS: '1', leaderRef: '0xl', leaderFillPNS: 100n,
  followerFillPNS: 100n, deviationBps: 0, latencyMs: 1000, latencyBlocks: 2, block: 1, timestamp: 1, matchNow: false, teamRun: false, ...o,
});

describe('aggregation and team-run exclusion', () => {
  it('aggregates keeper copies only and keeps team-run out of the public scope', () => {
    const copies = [
      sample({ deviationBps: 10, latencyMs: 900, latencyBlocks: 2, block: 1 }),
      sample({ deviationBps: -4, latencyMs: 1500, latencyBlocks: 4, orderType: CLOSE_LONG, block: 2 }),
      sample({ deviationBps: 30, latencyMs: 1200, latencyBlocks: 3, block: 3 }),
      sample({ deviationBps: null, latencyMs: null, latencyBlocks: null, matchNow: true, block: 4 }),
      sample({ deviationBps: 500, latencyMs: 99_999, latencyBlocks: 99, teamRun: true, block: 5 }),
    ];
    const blocks = [
      { reason: 'LeverageTooHigh', leaderAccountId: 1, timestamp: 1, matchNow: false, teamRun: false },
      { reason: 'LeverageTooHigh', leaderAccountId: 1, timestamp: 1, matchNow: false, teamRun: false },
      { reason: 'EntryTooFar', leaderAccountId: 1, timestamp: 1, matchNow: false, teamRun: false },
      { reason: 'LeverageTooHigh', leaderAccountId: 9, timestamp: 1, matchNow: false, teamRun: true },
    ];
    const q = buildQuality(copies, blocks);
    expect(q.global.aggregates).toEqual({
      copies: 3, matchNowCopies: 1, opens: 2, closes: 1, blocked: 3,
      deviationBps: { samples: 3, median: 10, p90: 30, avg: 12, worseThanLeader: 2 },
      latencyMs: { samples: 3, median: 1200, p90: 1500 },
      latencyBlocks: { samples: 3, median: 3, p90: 4 },
    });
    expect(q.global.blockedByReason).toEqual({ LeverageTooHigh: 2, EntryTooFar: 1 });
    expect(q.global.copies.map((c) => c.block)).toEqual([4, 3, 2, 1]);
    expect(q.teamRun.aggregates).toMatchObject({ copies: 1, blocked: 1, deviationBps: { median: 500 }, latencyMs: { median: 99_999 } });
    expect(q.teamRun.blockedByReason).toEqual({ LeverageTooHigh: 1 });
    expect(aggregateScope([], []).deviationBps).toEqual({ samples: 0, median: null, p90: null, avg: null, worseThanLeader: 0 });
  });
});

const USER = '0x00000000000000000000000000000000000000a1';
const TEAM = '0x00000000000000000000000000000000000000d0';

function seed(db: Db) {
  db.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, perpl_account_id) VALUES (?, ?, '0', 1, '0x', 501)`, USER, '0x00000000000000000000000000000000000000b1');
  db.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, perpl_account_id) VALUES (?, ?, '0', 1, '0x', 502)`, TEAM, '0x00000000000000000000000000000000000000b2');
  const feed = (account: string, kind: string, tx: string, block: number, ts: number, leader: number, orderType: number, extra: { reason?: string; ref?: string; data?: unknown } = {}) =>
    db.run(`INSERT INTO feed (account, kind, tx_hash, log_index, block, ts, leader_id, perp_id, order_type, lots, reason, leader_ref, data) VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, '2', ?, ?, ?)`,
      account, kind, tx, block, ts, leader, orderType, extra.reason ?? null, extra.ref ?? `0xl${tx}`, extra.data ? JSON.stringify(extra.data) : null);
  // Open copy priced by the proof: leader 10_000, follower 10_015 -> 15 bps worse; 1200 ms, 3 blocks.
  feed(USER, 'Mirrored', '0xc1', 103, 1_000, 7, OPEN_LONG, { data: { proof: { leaderFillPNS: '10000', fillPNS: '10015' } } });
  db.run(`INSERT INTO copies (dedupe, account, leader_ref, leader_id, perp_id, order_type, lots, price, leverage, expected, status, created_ms, tx_hash, latency_ms) VALUES ('a', ?, '0xl0xc1', 7, 1, 0, '2', '0', 0, 'executed', 'mined', 0, '0xc1', 1200)`, USER);
  db.run(`INSERT INTO leader_fills (leader_ref, leader_id, perp_id, kind, block, observed_ms, price) VALUES ('0xl0xc1', 7, 1, 'open', 100, 0, '10000')`);
  // Close copy: no proof fill; the follower's own Perpl event in the copy tx prices it (sold at 10_190 vs leader 10_200 -> 9 bps worse).
  feed(USER, 'Mirrored', '0xc2', 210, 2_000, 7, CLOSE_LONG, { data: { proof: { leaderFillPNS: '10200', fillPNS: '0' } } });
  db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, account_id, perp_id, kind, price) VALUES ('0xc2', 3, 210, 501, 1, 'close', '10190')`);
  db.run(`INSERT INTO leader_fills (leader_ref, leader_id, perp_id, kind, block, observed_ms, price) VALUES ('0xl0xc2', 7, 1, 'close', 208, 0, '10200')`);
  feed(USER, 'Mirrored', '0xc3', 300, 3_000, 7, OPEN_LONG, { ref: MATCH_NOW_REF, data: { proof: { leaderFillPNS: '0', fillPNS: '10100' } } });
  feed(USER, 'Blocked', '0xb1', 400, 4_000, 7, OPEN_LONG, { reason: 'EntryTooFar' });
  // Team-run follower: huge deviation that must not reach the public numbers.
  feed(TEAM, 'Mirrored', '0xt1', 500, 5_000, 8, OPEN_SHORT, { data: { proof: { leaderFillPNS: '10000', fillPNS: '9000' } } });
  feed(TEAM, 'Blocked', '0xt2', 501, 5_001, 8, OPEN_LONG, { reason: 'LeverageTooHigh' });
}

describe('CopyQualityService (engine DB)', () => {
  const teamRun = (account: string) => account === TEAM;

  it('computes per-copy rows and aggregates from the DB and reports team-run separately', async () => {
    const db = new Db(':memory:');
    seed(db);
    const svc = new CopyQualityService(db, new IndexerClient(undefined, log), teamRun);
    const r = await svc.report('all', undefined, 10_000);
    expect(r.source).toBe('engine');
    expect(r.aggregates).toMatchObject({ copies: 2, matchNowCopies: 1, opens: 1, closes: 1, blocked: 1, deviationBps: { samples: 2, median: 9, p90: 15 }, latencyMs: { samples: 1, median: 1200 }, latencyBlocks: { samples: 2, median: 2, p90: 3 } });
    expect(r.blockedByReason).toEqual({ EntryTooFar: 1 });
    const c2 = r.copies.find((c) => c.txHash === '0xc2')!;
    expect(c2).toMatchObject({ leaderFillPNS: '10200', followerFillPNS: '10190', deviationBps: 9, latencyBlocks: 2 });
    expect(r.teamRun.aggregates).toMatchObject({ copies: 1, blocked: 1, deviationBps: { median: 1000 } });
    expect(r.teamRun.blockedByReason).toEqual({ LeverageTooHigh: 1 });
    // Period and leader filters.
    expect((await svc.report('7d', undefined, 1_000 + 7 * 86_400 - 1)).aggregates.copies).toBe(2);
    expect((await svc.report('7d', undefined, 2_500 + 7 * 86_400)).aggregates.copies).toBe(0);
    expect((await svc.report('all', 8, 10_000)).aggregates.copies).toBe(0);
    expect((await svc.leaderMedianSlippageBps(7))).toBeNull(); // 2 samples < 3
  });
});

describe('CopyQualityService (indexer)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps CopyQualityStats and CopyEvent rows, with engine ms latency joined by tx hash', async () => {
    const db = new Db(':memory:');
    db.run(`INSERT INTO copies (dedupe, account, leader_ref, leader_id, perp_id, order_type, lots, price, leverage, expected, status, created_ms, tx_hash, latency_ms) VALUES ('a', '0xa', '0xl', 7, 1, 0, '2', '0', 0, 'executed', 'mined', 0, '0xe1', 1300)`);
    const stats = { copies: 10, matchNowCopies: 2, opens: 6, closes: 4, blocked: 3, deviationSamples: 9, avgDeviationBps: 4, medianDeviationBps: 3, p90DeviationBps: 12, worseThanLeader: 6, latencySamples: 9, medianLatencyBlocks: 2, p90LatencyBlocks: 5, medianLatencySeconds: 1, p90LatencySeconds: 2 };
    const copy = { txHash: '0xE1', mirrorAccount_id: '0xA', leaderAccountId: '7', perpId: 1, orderType: 'OPEN_LONG', filledLotsLNS: '2', leaderRef: '0xl', leaderFillReportedPNS: '10000', leaderFillActualPNS: null, followerFillPNS: '10010', deviationBps: 10, latencyBlocks: 2, latencySeconds: 1, blockNumber: 50, timestamp: 900, isMatchNow: false, excludedFromStats: false };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { global: [stats], team: [], blockedByReason: [{ reason: 'EntryTooFar', count: 3 }], teamBlockedByReason: [], copies: [copy], teamCopies: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new CopyQualityService(db, new IndexerClient('http://indexer/v1/graphql', log), () => false);
    const r = await svc.report('all');
    expect(r.source).toBe('indexer');
    expect(r.aggregates).toMatchObject({ copies: 10, deviationBps: { samples: 9, median: 3, p90: 12 }, latencyBlocks: { median: 2, p90: 5 } });
    expect(r.blockedByReason).toEqual({ EntryTooFar: 3 });
    expect(r.copies[0]).toMatchObject({ txHash: '0xE1', leaderFillPNS: '10000', followerFillPNS: '10010', deviationBps: 10, latencyMs: 1300, orderType: OPEN_LONG });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.variables.statsWhere).toEqual({ scope: { _eq: 'global' }, period: { _eq: 'ALL_TIME' }, leaderAccountId: { _is_null: true } });
    expect(body.variables.teamCopyWhere).toEqual({ excludedFromStats: { _eq: true } });
  });

  it('falls back to the engine DB when the indexer fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const db = new Db(':memory:');
    seed(db);
    const r = await new CopyQualityService(db, new IndexerClient('http://indexer/v1/graphql', log), (a) => a === TEAM).report('all');
    expect(r.source).toBe('engine');
    expect(r.aggregates.copies).toBe(2);
  });
});
