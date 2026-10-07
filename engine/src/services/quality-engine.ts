import type { Db } from '../db.js';
import { deviationBps, type BlockSample, type CopySample } from '../domain/quality.js';
import { MATCH_NOW_REF } from './constants.js';

type FeedQ = {
  account: string;
  kind: string;
  tx_hash: string;
  block: number;
  ts: number | null;
  leader_id: number;
  perp_id: number;
  order_type: number;
  lots: string | null;
  reason: string | null;
  leader_ref: string | null;
  latency_ms: number | null;
  data: string | null;
  owner: string | null;
  perpl_account_id: number | null;
  copy_latency_ms: number | null;
  leader_block: number | null;
  leader_price: string | null;
};

export interface EngineSampleOptions {
  since: number | null;
  leaderId?: number;
  isTeamRun: (account: string, owner: string | null, leaderId: number) => boolean;
}

const big = (v: unknown): bigint | null => {
  if (v === null || v === undefined || v === '') return null;
  try {
    const b = BigInt(v as string);
    return b > 0n ? b : null;
  } catch {
    return null;
  }
};

/**
 * Copy-quality samples from the engine's own DB: Mirrored / Blocked feed rows joined with the copies table
 * (engine-measured latency), leader_fills (leader block and fill price) and perpl_events (the follower's own
 * Perpl fill in the copy tx, which prices closes; opens are priced by the onchain copy proof).
 */
export function loadEngineSamples(db: Db, o: EngineSampleOptions): { copies: CopySample[]; blocks: BlockSample[] } {
  const where: string[] = [`f.kind IN ('Mirrored', 'Blocked')`];
  const params: Array<number> = [];
  if (o.since !== null) {
    where.push('f.ts >= ?');
    params.push(o.since);
  }
  if (o.leaderId !== undefined) {
    where.push('f.leader_id = ?');
    params.push(o.leaderId);
  }
  const rows = db.all<FeedQ>(
    `SELECT f.account, f.kind, f.tx_hash, f.block, f.ts, f.leader_id, f.perp_id, f.order_type, f.lots, f.reason, f.leader_ref, f.latency_ms, f.data,
            a.owner, a.perpl_account_id,
            (SELECT c.latency_ms FROM copies c WHERE c.tx_hash = f.tx_hash AND c.latency_ms IS NOT NULL LIMIT 1) AS copy_latency_ms,
            lf.block AS leader_block, lf.price AS leader_price
       FROM feed f
       LEFT JOIN accounts a ON a.address = f.account
       LEFT JOIN leader_fills lf ON lf.leader_ref = f.leader_ref AND lf.leader_id = f.leader_id AND lf.perp_id = f.perp_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.id`,
    ...params,
  );
  const copies: CopySample[] = [];
  const blocks: BlockSample[] = [];
  for (const r of rows) {
    const matchNow = r.leader_ref === MATCH_NOW_REF;
    const teamRun = o.isTeamRun(r.account, r.owner, r.leader_id);
    if (r.kind === 'Blocked') {
      blocks.push({ reason: r.reason ?? 'Unknown', leaderAccountId: r.leader_id, timestamp: r.ts, matchNow, teamRun });
      continue;
    }
    const data = r.data ? (JSON.parse(r.data) as { proof?: { leaderFillPNS?: string; fillPNS?: string } }) : {};
    const leaderFill = matchNow ? null : (big(data.proof?.leaderFillPNS) ?? big(r.leader_price));
    let followerFill = big(data.proof?.fillPNS);
    if (!followerFill && r.perpl_account_id) {
      const ev = db.get<{ price: string | null }>(
        'SELECT price FROM perpl_events WHERE tx_hash = ? AND account_id = ? AND perp_id = ? AND price IS NOT NULL ORDER BY log_index LIMIT 1',
        r.tx_hash, r.perpl_account_id, r.perp_id,
      );
      followerFill = big(ev?.price);
    }
    copies.push({
      txHash: r.tx_hash,
      account: r.account,
      leaderAccountId: r.leader_id,
      perpId: r.perp_id,
      orderType: r.order_type,
      lotLNS: r.lots ?? '0',
      leaderRef: r.leader_ref,
      leaderFillPNS: leaderFill,
      followerFillPNS: followerFill,
      deviationBps: matchNow ? null : deviationBps(r.order_type, leaderFill, followerFill),
      latencyMs: matchNow ? null : (r.copy_latency_ms ?? r.latency_ms),
      latencyBlocks: matchNow || r.leader_block === null ? null : r.block - r.leader_block,
      block: r.block,
      timestamp: r.ts,
      matchNow,
      teamRun,
    });
  }
  return { copies, blocks };
}

/** Engine-measured latency (ms) per copy tx hash, to enrich indexer rows (the indexer only has block times). */
export function engineLatencyByTx(db: Db, txHashes: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!txHashes.length) return out;
  const marks = txHashes.map(() => '?').join(',');
  const rows = db.all<{ tx_hash: string; latency_ms: number }>(
    `SELECT tx_hash, latency_ms FROM copies WHERE latency_ms IS NOT NULL AND tx_hash IN (${marks})`,
    ...txHashes.map((t) => t.toLowerCase()),
  );
  for (const r of rows) out.set(r.tx_hash.toLowerCase(), r.latency_ms);
  return out;
}
