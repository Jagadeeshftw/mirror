import type { Db } from '../db.js';
import type { Source } from '../perpl/market.js';
import { guardLabel, multipleToBps, thinBookDecision, type GuardResult } from '../domain/thinbook.js';
import { feedJson, insertFeed } from './feed.js';
import type { Bus } from './bus.js';

/** Feed kinds of engine-side events (no transaction, never onchain). */
export const ENGINE_FEED_KINDS = ['EngineShrunk', 'EngineSkipped'] as const;
export const isEngineKind = (kind: string) => kind.startsWith('Engine');

export interface DepthSource {
  depth(perpId: number, orderType: number, limitPNS: bigint): Promise<{ depthLots: bigint | null; source: Source; ageMs: number | null }>;
}

export interface GuardCheck extends GuardResult {
  bookSource: Source;
  bookAgeMs: number | null;
}

export interface GuardContext {
  account: string | null;
  source: 'keeper' | 'quote';
  leaderId: number;
  leaderRef: string | null;
  perpId: number;
  orderType: number;
  limitPNS: bigint;
  /** Block for the feed row (the leader's block for keeper copies). */
  block: number;
}

/**
 * Thin-book guard for opening copies. `check` measures depth and decides; `record` stores a shrink or skip in
 * guard_events and as an engine-side feed row (kind EngineShrunk / EngineSkipped, no tx hash), and publishes it
 * on the account's SSE channel.
 */
export class ThinBookGuard {
  readonly multipleBps: number;

  constructor(
    private readonly db: Db,
    private readonly market: DepthSource,
    private readonly bus: Bus | undefined,
    readonly enabled: boolean,
    multiple: number,
    private readonly explorerTx: string,
  ) {
    this.multipleBps = multipleToBps(multiple);
  }

  async check(perpId: number, orderType: number, lots: bigint, limitPNS: bigint): Promise<GuardCheck> {
    if (!this.enabled) {
      return { decision: 'ok', reason: null, requestedLots: lots, finalLots: lots, depthLots: null, requiredLots: lots, multipleBps: this.multipleBps, bookSource: 'none', bookAgeMs: null };
    }
    const d = await this.market.depth(perpId, orderType, limitPNS).catch(() => ({ depthLots: null, source: 'none' as Source, ageMs: null }));
    return { ...thinBookDecision(lots, d.depthLots, this.multipleBps), bookSource: d.source, bookAgeMs: d.ageMs };
  }

  /** Stores a non-ok decision. Quotes are de-duplicated per (account, market, decision, lots) for 60 s. */
  record(ctx: GuardContext, r: GuardCheck, nowMs = Date.now()): number | undefined {
    if (r.decision === 'ok') return undefined;
    const account = ctx.account?.toLowerCase() ?? null;
    if (ctx.source === 'quote') {
      const dup = this.db.get(
        `SELECT id FROM guard_events WHERE source = 'quote' AND account IS ? AND perp_id = ? AND decision = ? AND final_lots = ? AND created_ms > ?`,
        account, ctx.perpId, r.decision, r.finalLots.toString(), nowMs - 60_000,
      );
      if (dup) return undefined;
    }
    const ins = this.db.run(
      `INSERT INTO guard_events (account, source, leader_id, leader_ref, perp_id, order_type, decision, reason, requested_lots, final_lots, depth_lots,
        required_lots, multiple_bps, limit_pns, book_source, book_age_ms, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      account, ctx.source, ctx.leaderId, ctx.leaderRef, ctx.perpId, ctx.orderType, r.decision, r.reason ?? 'thin_book', r.requestedLots.toString(),
      r.finalLots.toString(), r.depthLots?.toString() ?? null, r.requiredLots.toString(), r.multipleBps, ctx.limitPNS.toString(), r.bookSource, r.bookAgeMs, nowMs,
    );
    const id = Number(ins.lastInsertRowid);
    if (!account) return id;
    const data = {
      onchain: false,
      label: guardLabel(r),
      source: ctx.source,
      reason: r.reason,
      requestedLots: r.requestedLots.toString(),
      finalLots: r.finalLots.toString(),
      depthLots: r.depthLots?.toString() ?? null,
      requiredLots: r.requiredLots.toString(),
      multiple: r.multipleBps / 10_000,
      limitPNS: ctx.limitPNS.toString(),
      bookSource: r.bookSource,
      bookAgeMs: r.bookAgeMs,
    };
    const row = insertFeed(this.db, {
      account, kind: r.decision === 'shrunk' ? 'EngineShrunk' : 'EngineSkipped', tx_hash: `engine:guard:${id}`, log_index: 0, block: ctx.block, block_hash: null,
      ts: Math.floor(nowMs / 1000), commit_state: 'offchain', leader_id: ctx.leaderId, perp_id: ctx.perpId, order_type: ctx.orderType, lots: r.finalLots.toString(),
      price: ctx.limitPNS.toString(), leverage: null, reason: r.reason === 'book_unavailable' ? 'BookUnavailable' : 'ThinBook', limit_v: r.requiredLots.toString(),
      actual_v: r.depthLots?.toString() ?? null, leader_ref: ctx.leaderRef, keeper: null, amount: null, latency_ms: null, data: JSON.stringify(data),
    });
    if (row) this.bus?.publish(account, { type: 'feed', item: feedJson(row, this.explorerTx) });
    return id;
  }
}
