import type { Address, Hex, PublicClient } from 'viem';
import { RpcWs, RpcError } from './rpcWs.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';

export type CommitState = 'Proposed' | 'Voted' | 'Finalized';

export interface Head {
  number: number;
  hash: Hex;
  timestamp: number;
  baseFeePerGas: bigint | undefined;
  /** Monad commit state; standard heads are reported as Proposed and aged by depth downstream. */
  commitState: CommitState;
  /** True when the source reports real commit states (monadNewHeads). */
  native: boolean;
  observedMs: number;
}

export interface ChainLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: number;
  blockHash: Hex;
  blockTimestamp: number | undefined;
  transactionHash: Hex;
  logIndex: number;
  commitState: CommitState | undefined;
  removed: boolean;
  observedMs: number;
}

export interface LogFilter {
  address?: Address | Address[];
  topics: (Hex | Hex[] | null)[];
}

export type StreamMode = 'monad' | 'standard' | 'poll';

const MAX_RANGE = 100;

type RawLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp?: string;
  transactionHash: string;
  logIndex: string;
  commitState?: CommitState;
  removed?: boolean;
};

export function normalizeLog(l: RawLog, observedMs = Date.now()): ChainLog {
  return {
    address: l.address as Address,
    topics: l.topics as Hex[],
    data: l.data as Hex,
    blockNumber: Number(l.blockNumber),
    blockHash: l.blockHash as Hex,
    blockTimestamp: l.blockTimestamp ? Number(l.blockTimestamp) : undefined,
    transactionHash: l.transactionHash as Hex,
    logIndex: Number(l.logIndex),
    commitState: l.commitState,
    removed: Boolean(l.removed),
    observedMs,
  };
}

/** Fetches logs over [from, to] in chunks of at most 100 blocks (Monad's eth_getLogs limit). */
export async function getLogsChunked(
  client: PublicClient,
  filter: LogFilter,
  from: number,
  to: number,
  onChunk?: (logs: ChainLog[], chunkTo: number) => void | Promise<void>,
): Promise<ChainLog[]> {
  const all: ChainLog[] = [];
  for (let start = from; start <= to; start += MAX_RANGE) {
    const end = Math.min(to, start + MAX_RANGE - 1);
    const raw = (await client.request({
      method: 'eth_getLogs',
      params: [
        {
          ...(filter.address ? { address: filter.address } : {}),
          topics: filter.topics,
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
        },
      ],
    } as never)) as RawLog[];
    const logs = raw.map((l) => normalizeLog(l));
    all.push(...logs);
    if (onChunk) await onChunk(logs, end);
  }
  return all;
}

type LogSub = { filter: LogFilter; cb: (l: ChainLog) => void; lastBlock: number };

/**
 * One place that decides how the engine hears about new blocks and logs:
 *  - monad: `monadNewHeads` / `monadLogs` (commit states, logs at Proposed for lowest latency)
 *  - standard: `newHeads` / `logs` (anvil and generic nodes)
 *  - poll: eth_blockNumber + eth_getLogs
 * After a WS reconnect, gaps are backfilled with eth_getLogs.
 */
export class ChainStreams {
  mode: StreamMode = 'poll';
  head = 0;
  private ws?: RpcWs;
  private headCbs: Array<(h: Head) => void> = [];
  private logSubs: LogSub[] = [];
  private pollTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly client: PublicClient,
    private readonly wsUrl: string | undefined,
    private readonly preferred: 'auto' | StreamMode,
    private readonly pollMs: number,
    private readonly log: Logger,
  ) {}

  async start() {
    this.head = Number(await this.client.getBlockNumber());
    const want = this.preferred;
    if (want !== 'poll' && this.wsUrl) {
      try {
        this.ws = new RpcWs(this.wsUrl, this.log);
        await this.ws.connect();
        if (want === 'monad' || want === 'auto') {
          try {
            await this.ws.subscribe(['monadNewHeads'], (h) => this.onWsHead(h, true));
            this.mode = 'monad';
          } catch (err) {
            if (want === 'monad') throw err;
            this.log.info({ err: (err as Error).message }, 'monadNewHeads unsupported; using newHeads');
          }
        }
        if (this.mode !== 'monad') {
          await this.ws.subscribe(['newHeads'], (h) => this.onWsHead(h, false));
          this.mode = 'standard';
        }
        this.ws.on('open', () => void this.backfillAfterReconnect());
      } catch (err) {
        this.log.warn({ err: (err as Error).message, wsUrl: this.wsUrl }, 'ws streams unavailable; polling');
        this.ws?.close();
        this.ws = undefined;
        this.mode = 'poll';
      }
    }
    if (this.mode === 'poll') this.schedulePoll();
    this.log.info({ mode: this.mode, head: this.head }, 'chain streams started');
  }

  onHead(cb: (h: Head) => void) {
    this.headCbs.push(cb);
  }

  /** Subscribes to logs from `fromBlock` (exclusive) onwards; gaps are filled with eth_getLogs. */
  async subscribeLogs(filter: LogFilter, cb: (l: ChainLog) => void, fromBlock = this.head) {
    const sub: LogSub = { filter, cb, lastBlock: fromBlock };
    this.logSubs.push(sub);
    if (this.ws && this.mode !== 'poll') {
      const method = this.mode === 'monad' ? 'monadLogs' : 'logs';
      const params: Record<string, unknown> = { topics: filter.topics };
      if (filter.address) params.address = filter.address;
      try {
        await this.ws.subscribe([method, params], (raw) => {
          const l = normalizeLog(raw as RawLog);
          sub.lastBlock = Math.max(sub.lastBlock, l.blockNumber);
          cb(l);
        });
      } catch (err) {
        if (err instanceof RpcError) this.log.warn({ err: err.message, method }, 'log subscription failed; polling logs');
        this.mode = 'poll';
        this.schedulePoll();
      }
    }
  }

  private onWsHead(raw: unknown, native: boolean) {
    const h = raw as { number: string; hash: string; timestamp: string; baseFeePerGas?: string; commitState?: CommitState };
    const head: Head = {
      number: Number(h.number),
      hash: h.hash as Hex,
      timestamp: Number(h.timestamp),
      baseFeePerGas: h.baseFeePerGas ? BigInt(h.baseFeePerGas) : undefined,
      commitState: native ? (h.commitState ?? 'Proposed') : 'Proposed',
      native,
      observedMs: Date.now(),
    };
    this.emitHead(head);
  }

  private emitHead(h: Head) {
    if (h.number > this.head) {
      this.head = h.number;
      metrics.headBlock.set(h.number);
    }
    for (const cb of this.headCbs) {
      try {
        cb(h);
      } catch (err) {
        this.log.error({ err: (err as Error).message }, 'head callback failed');
      }
    }
  }

  private async backfillAfterReconnect() {
    try {
      const head = Number(await this.client.getBlockNumber());
      for (const sub of this.logSubs) {
        if (sub.lastBlock >= head) continue;
        this.log.info({ from: sub.lastBlock + 1, to: head }, 'backfilling logs after reconnect');
        await getLogsChunked(this.client, sub.filter, sub.lastBlock + 1, head, (logs) => logs.forEach(sub.cb));
        sub.lastBlock = head;
      }
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'reconnect backfill failed');
    }
  }

  private schedulePoll() {
    if (this.pollTimer || this.stopped) return;
    const tick = async () => {
      try {
        const n = Number(await this.client.getBlockNumber());
        if (n > this.head) {
          const block = await this.client.getBlock({ blockNumber: BigInt(n) });
          this.emitHead({
            number: n,
            hash: block.hash!,
            timestamp: Number(block.timestamp),
            baseFeePerGas: block.baseFeePerGas ?? undefined,
            commitState: 'Proposed',
            native: false,
            observedMs: Date.now(),
          });
        }
        for (const sub of this.logSubs) {
          if (sub.lastBlock >= n) continue;
          const from = sub.lastBlock + 1;
          await getLogsChunked(this.client, sub.filter, from, n, (logs, end) => {
            logs.forEach(sub.cb);
            sub.lastBlock = end;
          });
        }
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'poll tick failed');
      } finally {
        if (!this.stopped) this.pollTimer = setTimeout(tick, this.pollMs);
      }
    };
    this.pollTimer = setTimeout(tick, 0);
  }

  get wsConnected() {
    return this.ws?.connected ?? false;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    this.ws?.close();
  }
}
