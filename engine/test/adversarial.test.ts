import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.js';
import {
  adversarialFlags,
  bookMovingIncidents,
  exitIncidents,
  leaderMoveBps,
  reducedSide,
  type CopiedLeaderFill,
  type FollowerOpenFill,
  type LeaderExit,
} from '../src/domain/adversarial.js';
import { LONG, OPEN_LONG, OPEN_SHORT, SHORT } from '../src/domain/types.js';
import { AdversarialService } from '../src/services/adversarial.js';

const opts = { exitBlocks: 20, moveBps: 30, worseBps: 20, flagScore: 25, minIncidents: 2 };
const fill = (o: Partial<FollowerOpenFill>): FollowerOpenFill => ({ leaderId: 7, perpId: 1, side: LONG, fillPNS: 10_015n, block: 100, leaderRef: '0xL1', timestamp: 1_000, ...o });
const exit = (o: Partial<LeaderExit>): LeaderExit => ({ leaderId: 7, perpId: 1, kind: 'close', positionType: LONG, pricePNS: 10_020n, block: 110, txHash: '0xE', timestamp: 2_000, ...o });

describe('rule (i): exits into followers', () => {
  const fills = [fill({}), fill({ side: SHORT, fillPNS: 5_000n, block: 200, leaderRef: '0xL2', perpId: 2 })];

  it('counts a leader exit within N blocks at or beyond the followers fill on their side', () => {
    expect(exitIncidents(fills, [exit({})], 20)).toHaveLength(1); // long exit 10_020 >= 10_015, 10 blocks later
    expect(exitIncidents(fills, [exit({ pricePNS: 10_015n })], 20)).toHaveLength(1); // at the fill counts
    expect(exitIncidents(fills, [exit({ block: 120 })], 20)).toHaveLength(1); // exactly N blocks
    expect(exitIncidents(fills, [exit({ perpId: 2, kind: 'decrease', positionType: SHORT, pricePNS: 4_990n, block: 215 })], 20)).toHaveLength(1);
  });

  it('ignores exits too late, before the fill, at a worse price, in another market, or in the copied tx itself', () => {
    expect(exitIncidents(fills, [exit({ block: 121 })], 20)).toHaveLength(0);
    expect(exitIncidents(fills, [exit({ block: 99 })], 20)).toHaveLength(0);
    expect(exitIncidents(fills, [exit({ pricePNS: 10_014n })], 20)).toHaveLength(0);
    expect(exitIncidents(fills, [exit({ perpId: 3 })], 20)).toHaveLength(0);
    expect(exitIncidents(fills, [exit({ txHash: '0xL1' })], 20)).toHaveLength(0);
    expect(exitIncidents(fills, [exit({ perpId: 2, kind: 'close', positionType: SHORT, pricePNS: 5_001n, block: 210 })], 20)).toHaveLength(0);
    expect(exitIncidents(fills, [exit({ leaderId: 8 })], 20)).toHaveLength(0);
  });

  it('an invert reduces the old side', () => {
    expect(reducedSide({ kind: 'invert', positionType: SHORT })).toBe(LONG);
    expect(reducedSide({ kind: 'decrease', positionType: SHORT })).toBe(SHORT);
    expect(exitIncidents(fills, [exit({ kind: 'invert', positionType: SHORT, pricePNS: 10_030n, block: 112 })], 20)).toHaveLength(1);
  });
});

describe('rule (ii): moves the book', () => {
  const copied = (o: Partial<CopiedLeaderFill>): CopiedLeaderFill => ({ leaderId: 7, perpId: 1, leaderRef: '0xL', orderType: OPEN_LONG, leaderFillPNS: 10_040n, preTradePNS: 10_000n, deviationsBps: [25, 30], timestamp: 3_000, ...o });

  it('measures the move in the leader trade direction', () => {
    expect(leaderMoveBps(OPEN_LONG, 10_000n, 10_040n)).toBe(40);
    expect(leaderMoveBps(OPEN_SHORT, 10_000n, 9_950n)).toBe(50);
    expect(leaderMoveBps(OPEN_SHORT, 10_000n, 10_050n)).toBe(-50);
    expect(leaderMoveBps(OPEN_LONG, null, 10_040n)).toBeNull();
  });

  it('needs both a move above X and followers worse than Y (median of the fill copies)', () => {
    expect(bookMovingIncidents([copied({})], 30, 20)).toHaveLength(1);
    expect(bookMovingIncidents([copied({ orderType: OPEN_SHORT, leaderFillPNS: 9_950n, deviationsBps: [21] })], 30, 20)).toHaveLength(1);
    expect(bookMovingIncidents([copied({ deviationsBps: [10, 40] })], 30, 20)).toHaveLength(0); // median 10
    expect(bookMovingIncidents([copied({ leaderFillPNS: 10_030n })], 30, 20)).toHaveLength(0); // move exactly 30
    expect(bookMovingIncidents([copied({ deviationsBps: [20] })], 30, 20)).toHaveLength(0);
    expect(bookMovingIncidents([copied({ preTradePNS: null })], 30, 20)).toHaveLength(0);
    expect(bookMovingIncidents([copied({ deviationsBps: [] })], 30, 20)).toHaveLength(0);
  });

  it('combines both rules into a score and a flag', () => {
    const copiedFills = [copied({ leaderRef: '0xL1' }), copied({ leaderRef: '0xa', deviationsBps: [0] }), copied({ leaderRef: '0xb', deviationsBps: [0] }), copied({ leaderRef: '0xc', deviationsBps: [0] })];
    const f = adversarialFlags(7, { opens: [fill({})], exits: [exit({ timestamp: 9_000 })], copied: copiedFills }, opts);
    expect(f).toEqual({ exitsIntoFollowers: 1, bookMoving: 1, lastSeen: 9_000, score: 50, flagged: true, copiedFills: 4 });
    const one = adversarialFlags(7, { opens: [fill({})], exits: [], copied: copiedFills }, opts);
    expect(one).toMatchObject({ bookMoving: 1, score: 25, flagged: false }); // one incident < minIncidents
    expect(adversarialFlags(9, { opens: [], exits: [], copied: [] }, opts)).toEqual({ exitsIntoFollowers: 0, bookMoving: 0, lastSeen: null, score: 0, flagged: false, copiedFills: 0 });
  });
});

describe('AdversarialService (engine DB)', () => {
  it('derives both rules from feed, leader_fills and perpl_events', () => {
    const db = new Db(':memory:');
    const acc = '0x00000000000000000000000000000000000000a1';
    db.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, perpl_account_id) VALUES (?, '0xb', '0', 1, '0x', 501)`, acc);
    // Another account traded at 10_000 before the leader; the leader bought at 10_050 (50 bps move).
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, account_id, perp_id, kind, position_type, price) VALUES ('0xother', 0, 95, 999, 1, 'open', 0, '10000')`);
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, account_id, perp_id, kind, position_type, price) VALUES ('0xL1', 0, 100, 7, 1, 'open', 0, '10050')`);
    db.run(`INSERT INTO leader_fills (leader_ref, leader_id, perp_id, kind, block, observed_ms, price) VALUES ('0xL1', 7, 1, 'open', 100, 0, '10050')`);
    // The follower filled at 10_080 (29 bps worse) in block 102 ...
    db.run(`INSERT INTO feed (account, kind, tx_hash, log_index, block, ts, leader_id, perp_id, order_type, lots, leader_ref, data) VALUES (?, 'Mirrored', '0xc1', 0, 102, 1000, 7, 1, 0, '1', '0xL1', ?)`,
      acc, JSON.stringify({ proof: { leaderFillPNS: '10050', fillPNS: '10080' } }));
    // ... and the leader closed into it 8 blocks later at 10_085.
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, price) VALUES ('0xE1', 0, 110, 1004, 7, 1, 'close', 0, '10085')`);
    const svc = new AdversarialService(db, opts, () => false);
    expect(svc.forLeader(7)).toEqual({ exitsIntoFollowers: 1, bookMoving: 1, lastSeen: 1004, score: 100, flagged: true, copiedFills: 1 });
    expect(svc.view(8)).toMatchObject({ exitsIntoFollowers: 0, bookMoving: 0, score: 0, flagged: false });
  });
});
