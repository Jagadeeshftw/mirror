import type { Db } from '../db.js';
import { BLOCK_REASONS, ORDER_TYPE_NAMES } from '../domain/types.js';
import { MATCH_NOW_REF } from './constants.js';

export interface FeedRow {
  id: number;
  account: string;
  kind: string;
  tx_hash: string;
  log_index: number;
  block: number;
  block_hash: string | null;
  ts: number | null;
  commit_state: string;
  leader_id: number | null;
  perp_id: number | null;
  order_type: number | null;
  lots: string | null;
  price: string | null;
  leverage: number | null;
  reason: string | null;
  limit_v: string | null;
  actual_v: string | null;
  leader_ref: string | null;
  keeper: string | null;
  amount: string | null;
  latency_ms: number | null;
  data: string | null;
  /** Mirrored: builder fee Perpl charged on the copy (CopyProof.builderFeeCNS); null for other kinds. */
  builder_fee_cns?: string | null;
  /** Mirrored / Blocked: block of the leader fill that triggered the copy (keeper copies; null for match now). */
  leader_block?: number | null;
  /** Blocked: lots the leader traded and the leader's leverage on that fill. */
  leader_lots?: string | null;
  leader_leverage?: number | null;
  /** Mirrored closes: realised PnL of the copy, collateral units. */
  realised_pnl_cns?: string | null;
}

export function feedJson(r: FeedRow, explorerTx: string) {
  const data = r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null;
  // Engine-side events (thin-book guard) have no transaction; they are never onchain Blocked events.
  const engine = r.kind.startsWith('Engine');
  return {
    id: r.id,
    account: r.account,
    kind: r.kind,
    onchain: !engine,
    label: engine ? ((data?.label as string | undefined) ?? r.kind) : null,
    txHash: engine ? null : r.tx_hash,
    txUrl: engine ? null : explorerTx + r.tx_hash,
    logIndex: r.log_index,
    block: r.block,
    timestamp: r.ts,
    commitState: r.commit_state,
    leaderAccountId: r.leader_id,
    perpId: r.perp_id,
    orderType: r.order_type,
    orderTypeName: r.order_type !== null ? ORDER_TYPE_NAMES[r.order_type] ?? null : null,
    lotLNS: r.lots,
    pricePNS: r.price,
    leverageHdths: r.leverage,
    reason: r.reason,
    limit: r.limit_v,
    actual: r.actual_v,
    leaderRef: r.leader_ref,
    matchNow: r.leader_ref === MATCH_NOW_REF,
    keeper: r.keeper,
    amount: r.amount,
    latencyMs: r.latency_ms,
    /** Mirrored / Blocked keeper copies: the leader fill's block and copy block minus leader block. */
    leaderBlock: r.leader_block ?? null,
    latencyBlocks: r.leader_block !== null && r.leader_block !== undefined ? r.block - r.leader_block : null,
    /** Mirrored closes: realised PnL of the copy (Perpl close event of the follower, else the contract's leaderRealizedCNS change). */
    realisedPnlCNS: r.realised_pnl_cns ?? null,
    /** Blocked: the leader's own order (lots traded, leverage) from the fill that triggered it. */
    leaderLotLNS: r.leader_lots ?? null,
    leaderLeverageHdths: r.leader_leverage ?? null,
    /** Mirrored only: leader fill and entry, mark, follower fill, entry deviation and builder fee, as emitted onchain. */
    proof: (data?.proof as Record<string, unknown> | undefined) ?? null,
    data,
  };
}

export type FeedInsert = Omit<FeedRow, 'id' | 'commit_state'> & { commit_state?: string };

export function insertFeed(db: Db, f: FeedInsert): FeedRow | undefined {
  const res = db.run(
    `INSERT OR IGNORE INTO feed (account, kind, tx_hash, log_index, block, block_hash, ts, commit_state, leader_id, perp_id, order_type,
      lots, price, leverage, reason, limit_v, actual_v, leader_ref, keeper, amount, latency_ms, data, builder_fee_cns, leader_block, leader_lots,
      leader_leverage, realised_pnl_cns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.account, f.kind, f.tx_hash, f.log_index, f.block, f.block_hash, f.ts, f.commit_state ?? 'proposed', f.leader_id, f.perp_id,
    f.order_type, f.lots, f.price, f.leverage, f.reason, f.limit_v, f.actual_v, f.leader_ref, f.keeper, f.amount, f.latency_ms, f.data, f.builder_fee_cns ?? null,
    f.leader_block ?? null, f.leader_lots ?? null, f.leader_leverage ?? null, f.realised_pnl_cns ?? null,
  );
  if (Number(res.changes) === 0) {
    if (f.latency_ms !== null) {
      db.run('UPDATE feed SET latency_ms = ? WHERE tx_hash = ? AND log_index = ? AND latency_ms IS NULL', f.latency_ms, f.tx_hash, f.log_index);
    }
    return undefined;
  }
  return db.get<FeedRow>('SELECT * FROM feed WHERE id = ?', Number(res.lastInsertRowid));
}

export const reasonName = (n: number) => BLOCK_REASONS[n] ?? `Unknown(${n})`;
