import type { Db } from '../db.js';
import { LONG, SHORT } from '../domain/types.js';
import {
  adversarialFlags,
  NO_FLAGS,
  type AdversarialFlags,
  type AdversarialOptions,
  type CopiedLeaderFill,
  type FollowerOpenFill,
  type LeaderExit,
} from '../domain/adversarial.js';
import { loadEngineSamples } from './quality-engine.js';
import type { TeamRunFn } from './quality.js';

/** How far back to look for the last trade before a leader's fill (blocks). */
const PRE_TRADE_LOOKBACK_BLOCKS = 200;
const CACHE_MS = 60_000;

/**
 * Adversarial-leader flags from the engine's own records: executed copies (feed + copy proof), the leader's
 * Perpl position events and every account's events in the market (perpl_events) for the pre-trade price.
 * Recomputed at most once a minute.
 */
export class AdversarialService {
  private cache?: { ms: number; flags: Map<number, AdversarialFlags> };

  constructor(
    private readonly db: Db,
    readonly opts: AdversarialOptions,
    private readonly isTeamRun: TeamRunFn,
  ) {}

  forLeader(id: number): AdversarialFlags {
    return this.all().get(id) ?? NO_FLAGS;
  }

  all(nowMs = Date.now()): Map<number, AdversarialFlags> {
    if (this.cache && nowMs - this.cache.ms < CACHE_MS) return this.cache.flags;
    const flags = this.compute();
    this.cache = { ms: nowMs, flags };
    return flags;
  }

  compute(): Map<number, AdversarialFlags> {
    const { copies } = loadEngineSamples(this.db, { since: null, isTeamRun: this.isTeamRun });
    const keeper = copies.filter((c) => !c.matchNow);
    const opens: FollowerOpenFill[] = keeper
      .filter((c) => c.orderType <= 1 && c.followerFillPNS !== null && c.leaderRef)
      .map((c) => ({ leaderId: c.leaderAccountId, perpId: c.perpId, side: c.orderType === 0 ? LONG : SHORT, fillPNS: c.followerFillPNS!, block: c.block, leaderRef: c.leaderRef!, timestamp: c.timestamp }));

    const groups = new Map<string, CopiedLeaderFill & { leaderBlock: number | null }>();
    for (const c of keeper) {
      if (!c.leaderRef) continue;
      const key = `${c.leaderRef}:${c.leaderAccountId}:${c.perpId}`;
      let g = groups.get(key);
      if (!g) {
        const leaderBlock = c.latencyBlocks !== null ? c.block - c.latencyBlocks : null;
        g = { leaderId: c.leaderAccountId, perpId: c.perpId, leaderRef: c.leaderRef, orderType: c.orderType, leaderFillPNS: c.leaderFillPNS, preTradePNS: null, deviationsBps: [], timestamp: c.timestamp, leaderBlock };
        groups.set(key, g);
      }
      if (c.deviationBps !== null) g.deviationsBps.push(c.deviationBps);
    }
    for (const g of groups.values()) g.preTradePNS = this.preTradePrice(g.perpId, g.leaderRef, g.leaderBlock);

    const leaders = [...new Set(keeper.map((c) => c.leaderAccountId))];
    const exits: LeaderExit[] = [];
    if (leaders.length) {
      const rows = this.db.all<{ account_id: number; perp_id: number; kind: 'decrease' | 'close' | 'invert'; position_type: number; price: string; block: number; tx_hash: string; ts: number | null }>(
        `SELECT account_id, perp_id, kind, position_type, price, block, tx_hash, ts FROM perpl_events
          WHERE account_id IN (${leaders.map(() => '?').join(',')}) AND kind IN ('decrease', 'close', 'invert') AND price IS NOT NULL ORDER BY block, log_index`,
        ...leaders,
      );
      for (const r of rows) exits.push({ leaderId: r.account_id, perpId: r.perp_id, kind: r.kind, positionType: r.position_type === 1 ? SHORT : LONG, pricePNS: BigInt(r.price), block: r.block, txHash: r.tx_hash, timestamp: r.ts });
    }
    const input = { opens, exits, copied: [...groups.values()] };
    const out = new Map<number, AdversarialFlags>();
    for (const id of leaders) out.set(id, adversarialFlags(id, input, this.opts));
    return out;
  }

  /** Last priced Perpl event in the market before the leader's transaction. */
  private preTradePrice(perpId: number, leaderRef: string, leaderBlock: number | null): bigint | null {
    if (leaderBlock === null) return null;
    const r = this.db.get<{ price: string }>(
      `SELECT price FROM perpl_events WHERE perp_id = ? AND price IS NOT NULL AND tx_hash != ? AND block < ? AND block >= ?
        ORDER BY block DESC, log_index DESC LIMIT 1`,
      perpId, leaderRef, leaderBlock, leaderBlock - PRE_TRADE_LOOKBACK_BLOCKS,
    );
    return r ? BigInt(r.price) : null;
  }

  /** The `adversarial` block on leader responses. */
  view(id: number) {
    const f = this.forLeader(id);
    return { exitsIntoFollowers: f.exitsIntoFollowers, bookMoving: f.bookMoving, lastSeen: f.lastSeen, score: f.score, flagged: f.flagged, copiedFills: f.copiedFills };
  }
}
