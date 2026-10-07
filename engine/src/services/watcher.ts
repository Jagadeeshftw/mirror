import { decodeEventLog, toEventSelector, type Address, type Hex, type PublicClient } from 'viem';
import { perplExchangeAbi } from '../abi/PerplExchange.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import { getLogsChunked, type ChainLog, type ChainStreams } from '../chain/streams.js';
import type { Side } from '../domain/types.js';

export const POSITION_EVENTS = [
  'PositionOpened',
  'PositionOpenedV2',
  'PositionIncreased',
  'PositionIncreasedV2',
  'PositionDecreased',
  'PositionClosed',
  'PositionInverted',
  'PositionLiquidated',
  'PositionDeleveraged',
  'PositionDeleveragedV2',
] as const;

export const POSITION_TOPICS: Hex[] = POSITION_EVENTS.map((name) => {
  const item = perplExchangeAbi.find((e) => e.type === 'event' && e.name === name);
  if (!item) throw new Error(`missing ${name}`);
  return toEventSelector(item as never);
});

export type PositionKind = 'open' | 'increase' | 'decrease' | 'close' | 'invert' | 'liquidate' | 'deleverage';

export interface PositionEvent {
  kind: PositionKind;
  accountId: number;
  perpId: number;
  positionType: Side;
  lotsBefore: bigint | undefined;
  lotsAfter: bigint | undefined;
  leverageHdths: number | undefined;
  pricePNS: bigint | undefined;
  deltaPnlCNS: bigint | undefined;
  increased: boolean;
}

/** Decodes a Perpl position event (all fields non-indexed) into the parts the copy engine needs. */
export function decodePositionEvent(log: { data: Hex; topics: Hex[] }): PositionEvent | undefined {
  let ev;
  try {
    ev = decodeEventLog({ abi: perplExchangeAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
  } catch {
    return undefined;
  }
  const a = ev.args as Record<string, unknown>;
  const n = (k: string) => (a[k] === undefined ? undefined : BigInt(a[k] as bigint));
  const accountId = Number(a.accountId ?? a.posAccountId);
  const perpId = Number(a.perpId);
  const positionType = (Number(a.positionType) === 1 ? 1 : 0) as Side;
  const leverage = a.leverageHdths === undefined ? undefined : Number(a.leverageHdths);
  const base = { accountId, perpId, positionType, leverageHdths: leverage, pricePNS: n('pricePNS'), deltaPnlCNS: n('deltaPnlCNS') };
  switch (ev.eventName) {
    case 'PositionOpened':
    case 'PositionOpenedV2':
      return { ...base, kind: 'open', lotsBefore: 0n, lotsAfter: n('lotLNS'), increased: true };
    case 'PositionIncreased':
    case 'PositionIncreasedV2':
      return { ...base, kind: 'increase', lotsBefore: n('startLotLNS'), lotsAfter: n('endLotLNS'), increased: true };
    case 'PositionDecreased':
      return { ...base, kind: 'decrease', lotsBefore: n('startLotLNS'), lotsAfter: n('endLotLNS'), increased: false };
    case 'PositionClosed':
      return { ...base, kind: 'close', lotsBefore: undefined, lotsAfter: 0n, increased: false };
    case 'PositionInverted':
      return { ...base, kind: 'invert', lotsBefore: n('startLotLNS'), lotsAfter: n('endLotLNS'), increased: true };
    case 'PositionLiquidated': {
      const pos = n('posLotLNS');
      const liq = n('liqLotLNS');
      return { ...base, kind: 'liquidate', pricePNS: n('liqPricePNS'), lotsBefore: pos, lotsAfter: pos !== undefined && liq !== undefined ? pos - liq : undefined, increased: false };
    }
    case 'PositionDeleveraged':
    case 'PositionDeleveragedV2':
      return { ...base, kind: 'deleverage', pricePNS: n('deleveragePricePNS'), lotsBefore: n('startLotLNS'), lotsAfter: n('endLotLNS'), increased: false };
    default:
      return undefined;
  }
}

export interface LeaderChange {
  leaderId: number;
  perpId: number;
  leaderRef: Hex;
  block: number;
  observedMs: number;
  kind: PositionKind;
  increased: boolean;
  leverageHdths: number | undefined;
  expectedLotsAfter: bigint | undefined;
  /** The leader's fill price from the event (open, increase, invert, close), recorded as leaderFillPNS. */
  fillPNS: bigint | undefined;
}

/**
 * Subscribes to Perpl Exchange position events (monadLogs at Proposed on Monad). Every event is stored for the
 * leader ranking; events of followed leaders are coalesced per (tx, leader, market) and handed to the copy engine.
 */
export class LeaderWatcher {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private pending = new Map<string, LeaderChange>();
  onChange?: (c: LeaderChange) => void;

  constructor(
    private readonly db: Db,
    private readonly client: PublicClient,
    private readonly streams: ChainStreams,
    private readonly exchange: Address,
    private readonly isFollowed: (leaderId: number) => boolean,
    private readonly log: Logger,
  ) {}

  async start(backfillBlocks: number) {
    const head = this.streams.head;
    await this.streams.subscribeLogs({ address: this.exchange, topics: [POSITION_TOPICS] }, (l) => this.onLog(l, true), head);
    if (backfillBlocks > 0) {
      const from = Math.max(0, head - backfillBlocks);
      void getLogsChunked(this.client, { address: this.exchange, topics: [POSITION_TOPICS] }, from, head, (logs) => {
        for (const l of logs) this.onLog(l, false);
      })
        .then(() => this.log.info({ from, to: head }, 'perpl position history backfilled'))
        .catch((err) => this.log.warn({ err: (err as Error).message }, 'perpl history backfill failed'));
    }
  }

  private markSeen(key: string) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > 20_000) this.seen.delete(this.seenOrder.shift()!);
    return true;
  }

  onLog(l: ChainLog, live: boolean) {
    if (l.removed) return;
    // monadLogs delivers each log once per commit state; act on the first.
    if (!this.markSeen(`${l.transactionHash}:${l.logIndex}`)) return;
    const ev = decodePositionEvent(l);
    if (!ev) return;
    metrics.perplEvents.inc({ kind: ev.kind });
    this.db.run(
      `INSERT OR IGNORE INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, lots_before, price, delta_pnl, leverage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      l.transactionHash, l.logIndex, l.blockNumber, l.blockTimestamp ?? Math.floor(l.observedMs / 1000), ev.accountId, ev.perpId, ev.kind, ev.positionType,
      ev.lotsAfter?.toString() ?? null, ev.lotsBefore?.toString() ?? null, ev.pricePNS?.toString() ?? null, ev.deltaPnlCNS?.toString() ?? null, ev.leverageHdths ?? null,
    );
    if (!live || !this.isFollowed(ev.accountId)) return;

    metrics.leaderEvents.inc({ kind: ev.kind });
    // Liquidation and deleverage prices are not the leader's own fill.
    const fill = ev.kind === 'liquidate' || ev.kind === 'deleverage' ? undefined : ev.pricePNS;
    this.db.run(
      'INSERT OR IGNORE INTO leader_fills (leader_ref, leader_id, perp_id, kind, block, observed_ms, lots_after, leverage, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      l.transactionHash, ev.accountId, ev.perpId, ev.kind, l.blockNumber, l.observedMs, ev.lotsAfter?.toString() ?? null, ev.leverageHdths ?? null, fill?.toString() ?? null,
    );
    this.log.info(
      { leader: ev.accountId, perpId: ev.perpId, kind: ev.kind, lotsAfter: ev.lotsAfter?.toString(), leverageHdths: ev.leverageHdths, tx: l.transactionHash, block: l.blockNumber, commitState: l.commitState },
      'leader fill',
    );
    const key = `${l.transactionHash}:${ev.accountId}:${ev.perpId}`;
    const prev = this.pending.get(key);
    const change: LeaderChange = {
      leaderId: ev.accountId,
      perpId: ev.perpId,
      leaderRef: l.transactionHash,
      block: l.blockNumber,
      observedMs: prev?.observedMs ?? l.observedMs,
      kind: ev.kind,
      increased: (prev?.increased ?? false) || ev.increased,
      leverageHdths: ev.leverageHdths ?? prev?.leverageHdths,
      expectedLotsAfter: ev.lotsAfter ?? prev?.expectedLotsAfter,
      fillPNS: fill ?? prev?.fillPNS,
    };
    this.pending.set(key, change);
    if (!prev) {
      // Several events of one transaction arrive back to back; plan once on the last state.
      setImmediate(() => {
        const c = this.pending.get(key);
        this.pending.delete(key);
        if (c) this.onChange?.(c);
      });
    }
  }
}
