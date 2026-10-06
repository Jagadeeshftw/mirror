import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import type { ChainStreams, Head } from '../chain/streams.js';
import type { FeeOracle } from '../chain/sender.js';
import type { Bus } from './bus.js';

const RANK: Record<string, number> = { proposed: 0, voted: 1, finalized: 2 };

/**
 * Confirmation tracker. With monadNewHeads each block is reported as Proposed, Voted and Finalized and feed
 * items follow those states exactly. With standard heads the state is derived from depth (Monad finalizes two
 * blocks after proposal): head-1 voted, head-2 finalized.
 */
export class Tracker {
  constructor(
    private readonly db: Db,
    private readonly streams: ChainStreams,
    private readonly bus: Bus,
    private readonly fees: FeeOracle,
    private readonly demoFollower: string | undefined,
    private readonly log: Logger,
  ) {}

  start() {
    this.streams.onHead((h) => this.onHead(h));
  }

  onHead(h: Head) {
    this.fees.update(h.baseFeePerGas);
    try {
      if (h.native) {
        const state = h.commitState.toLowerCase();
        this.advance(state, `block = ? AND (block_hash IS NULL OR block_hash = ?)`, [h.number, h.hash]);
        if (state === 'finalized') this.advance('finalized', 'block < ?', [h.number]);
        else if (state === 'voted') this.advance('voted', 'block < ?', [h.number]);
      } else {
        this.advance('voted', 'block <= ?', [h.number - 1]);
        this.advance('finalized', 'block <= ?', [h.number - 2]);
      }
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'commit state update failed');
    }
  }

  private advance(state: string, where: string, params: Array<number | string>) {
    const lower = Object.entries(RANK).filter(([, r]) => r < RANK[state]!).map(([s]) => `'${s}'`).join(',');
    if (!lower) return;
    const rows = this.db.all<{ id: number; account: string; tx_hash: string; block: number; kind: string }>(
      `SELECT id, account, tx_hash, block, kind FROM feed WHERE ${where} AND commit_state IN (${lower}) LIMIT 1000`,
      ...params,
    );
    if (!rows.length) return;
    this.db.run(`UPDATE feed SET commit_state = ? WHERE ${where} AND commit_state IN (${lower})`, state, ...params);
    for (const r of rows) {
      const ev = { type: 'commit', id: r.id, txHash: r.tx_hash, block: r.block, kind: r.kind, commitState: state };
      this.bus.publish(r.account, ev);
      if (this.demoFollower && r.account === this.demoFollower.toLowerCase()) this.bus.publish('demo', ev);
    }
  }
}
