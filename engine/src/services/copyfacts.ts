import type { Db } from '../db.js';
import { CLOSE_LONG, CLOSE_SHORT } from '../domain/types.js';
import { MATCH_NOW_REF } from './constants.js';
import type { FeedInsert, FeedRow } from './feed.js';
import type { PositionEvent } from './watcher.js';

/** Perpl position event kinds that realise PnL (deltaPnlCNS is the realised amount). */
export const REALIZING_KINDS = ['decrease', 'close', 'invert', 'liquidate', 'deleverage'] as const;

/** Stores one decoded Perpl position event (idempotent on tx hash + log index). */
export function storePerplEvent(db: Db, l: { transactionHash: string; logIndex: number; blockNumber: number }, ts: number | null, ev: PositionEvent) {
  db.run(
    `INSERT OR IGNORE INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, lots_before, price, delta_pnl, leverage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    l.transactionHash, l.logIndex, l.blockNumber, ts, ev.accountId, ev.perpId, ev.kind, ev.positionType,
    ev.lotsAfter?.toString() ?? null, ev.lotsBefore?.toString() ?? null, ev.pricePNS?.toString() ?? null, ev.deltaPnlCNS?.toString() ?? null, ev.leverageHdths ?? null,
  );
}

export interface LeaderFillFacts {
  block: number;
  /** Lots the leader traded in that transaction and market (lots after the fill when the size before is unknown). */
  lots: string | null;
  leverageHdths: number | null;
}

/** The leader fill a copy refers to: from leader_fills (live, followed leaders) and the stored Perpl events of that tx. */
export function leaderFill(db: Db, leaderRef: string, leaderId: number, perpId: number): LeaderFillFacts | undefined {
  const ref = leaderRef.toLowerCase();
  const f = db.get<{ block: number; lots_after: string | null; leverage: number | null }>(
    'SELECT block, lots_after, leverage FROM leader_fills WHERE lower(leader_ref) = ? AND leader_id = ? AND perp_id = ?', ref, leaderId, perpId,
  );
  const evs = db.all<{ block: number; kind: string; lots_before: string | null; lots_after: string | null; leverage: number | null }>(
    'SELECT block, kind, lots_before, lots_after, leverage FROM perpl_events WHERE lower(tx_hash) = ? AND account_id = ? AND perp_id = ? ORDER BY log_index', ref, leaderId, perpId,
  );
  if (!f && !evs.length) return undefined;
  let traded: bigint | undefined;
  for (const e of evs) {
    if (e.lots_before === null || e.lots_after === null) continue;
    const before = BigInt(e.lots_before);
    const after = BigInt(e.lots_after);
    const t = e.kind === 'invert' ? before + after : after > before ? after - before : before - after;
    traded = (traded ?? 0n) + t;
  }
  const lots = traded !== undefined && traded > 0n ? traded.toString() : (f?.lots_after ?? evs.at(-1)?.lots_after ?? null);
  const leverage = f?.leverage ?? [...evs].reverse().find((e) => e.leverage !== null)?.leverage ?? null;
  return { block: f?.block ?? evs[0]!.block, lots, leverageHdths: leverage };
}

/** Realised PnL of a copy transaction from the follower's own Perpl events (sum of deltaPnlCNS); null if none stored. */
export function copyRealised(db: Db, txHash: string, perplAccountId: number, perpId: number): string | null {
  const rows = db.all<{ delta_pnl: string }>(
    `SELECT delta_pnl FROM perpl_events WHERE lower(tx_hash) = ? AND account_id = ? AND perp_id = ? AND delta_pnl IS NOT NULL
       AND kind IN (${REALIZING_KINDS.map(() => '?').join(', ')})`,
    txHash.toLowerCase(), perplAccountId, perpId, ...REALIZING_KINDS,
  );
  return rows.length ? rows.reduce((s, r) => s + BigInt(r.delta_pnl), 0n).toString() : null;
}

export const isCloseOrder = (orderType: number | null | undefined) => orderType === CLOSE_LONG || orderType === CLOSE_SHORT;

type Facts = Pick<FeedRow, 'kind' | 'tx_hash' | 'leader_ref' | 'leader_id' | 'perp_id' | 'order_type' | 'leader_block' | 'leader_lots' | 'leader_leverage' | 'realised_pnl_cns'>;

/**
 * Fills a Mirrored / Blocked item's leader block (and, for Blocked, the leader's lots and leverage) and a copied
 * close's realised PnL from what the engine has stored. Returns only the fields it could newly fill.
 */
export function copyFacts(db: Db, r: Facts, perplAccountId: number | null | undefined): Partial<FeedInsert> {
  const out: Partial<FeedInsert> = {};
  if (r.kind !== 'Mirrored' && r.kind !== 'Blocked') return out;
  if (r.leader_ref && r.leader_ref !== MATCH_NOW_REF && r.leader_id !== null && r.perp_id !== null) {
    if (r.leader_block === null || r.leader_block === undefined || (r.kind === 'Blocked' && (r.leader_lots ?? null) === null)) {
      const lf = leaderFill(db, r.leader_ref, r.leader_id, r.perp_id);
      if (lf) {
        if (r.leader_block === null || r.leader_block === undefined) out.leader_block = lf.block;
        if (r.kind === 'Blocked') {
          out.leader_lots = r.leader_lots ?? lf.lots;
          out.leader_leverage = r.leader_leverage ?? lf.leverageHdths;
        }
      }
    }
  }
  if (r.kind === 'Mirrored' && isCloseOrder(r.order_type) && (r.realised_pnl_cns ?? null) === null && perplAccountId && r.perp_id !== null) {
    const pnl = copyRealised(db, r.tx_hash, perplAccountId, r.perp_id);
    if (pnl !== null) out.realised_pnl_cns = pnl;
  }
  return out;
}

/** Writes newly found facts onto a stored feed row; returns the updated row (or the same row when nothing changed). */
export function applyCopyFacts(db: Db, row: FeedRow, perplAccountId: number | null | undefined): FeedRow {
  const f = copyFacts(db, row, perplAccountId);
  const keys = Object.keys(f) as Array<keyof typeof f>;
  if (!keys.length) return row;
  db.run(`UPDATE feed SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (f[k] ?? null) as string | number | null), row.id);
  return { ...row, ...f } as FeedRow;
}
