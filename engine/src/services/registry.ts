import { decodeEventLog, getAddress, toEventSelector, type Address, type Hex, type PublicClient } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { mirrorAccountFactoryAbi } from '../abi/MirrorAccountFactory.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import { getLogsChunked, type ChainLog, type ChainStreams } from '../chain/streams.js';
import type { Bus } from './bus.js';
import { feedJson, insertFeed, reasonName, type FeedInsert } from './feed.js';

const accountEvents = ['PerplAccountCreated', 'PolicyUpdated', 'PausedSet', 'Deposited', 'Withdrawn', 'ClosedAll', 'Mirrored', 'Blocked'] as const;

const selector = (name: string, abi: readonly unknown[]) => {
  const item = (abi as Array<{ type: string; name?: string }>).find((e) => e.type === 'event' && e.name === name);
  if (!item) throw new Error(`event ${name} missing from ABI`);
  return toEventSelector(item as never);
};

export const ACCOUNT_CREATED_TOPIC = selector('AccountCreated', mirrorAccountFactoryAbi);
export const ACCOUNT_TOPICS = accountEvents.map((n) => selector(n, mirrorAccountAbi));

export interface FollowerInfo {
  address: Address;
  owner: Address;
  perplAccountId: number;
  paused: boolean;
  expiry: number;
  maxLeverageHdths: number;
  maxSlippageBps: number;
  leaders: Map<number, number>;
  markets: Map<number, bigint>;
  teamRun: boolean;
}

type AccountRow = {
  address: string;
  owner: string;
  perpl_account_id: number | null;
  paused: number;
  expiry: number | null;
  max_leverage_hdths: number | null;
  max_slippage_bps: number | null;
};

/**
 * Follower registry and feed indexer: discovers MirrorAccounts from the factory's AccountCreated events and
 * keeps each account's Perpl account id, policy, leaders and markets (from PerplAccountCreated/PolicyUpdated),
 * plus the account feed (Mirrored, Blocked, Deposited, ...). Backfills from the factory deploy block in
 * 100-block chunks, then follows the head.
 */
export class Registry {
  private accounts = new Map<string, FollowerInfo>();
  private running?: Promise<void>;
  private rerun = false;
  private blockTs = new Map<number, number>();
  cursor = 0;
  backfilled = false;
  /** Called with each new feed row (after commit) so the copy engine can attach latency, push, SSE. */
  onFeed?: (row: ReturnType<typeof feedJson>) => void;
  /** Called after any policy/leader change so watchers can refresh their leader set. */
  onLeadersChanged?: () => void;

  constructor(
    private readonly db: Db,
    private readonly client: PublicClient,
    private readonly streams: ChainStreams,
    private readonly factory: Address,
    private readonly deployBlock: number,
    private readonly teamRun: Set<string>,
    private readonly explorerTx: string,
    private readonly bus: Bus,
    private readonly log: Logger,
  ) {}

  async start() {
    this.loadFromDb();
    const saved = this.db.getKv('registry.cursor');
    this.cursor = saved ? Number(saved) : this.deployBlock - 1;
    await this.catchUp();
    this.backfilled = true;
    this.log.info({ accounts: this.accounts.size, cursor: this.cursor }, 'registry backfilled');
    this.streams.onHead(() => this.kick());
  }

  kick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = this.catchUp()
      .catch((err) => this.log.error({ err: (err as Error).message }, 'registry catch-up failed'))
      .finally(() => {
        this.running = undefined;
        if (this.rerun) {
          this.rerun = false;
          this.kick();
        }
      });
  }

  async catchUp() {
    const head = Number(await this.client.getBlockNumber());
    if (head <= this.cursor) return;
    const from = this.cursor + 1;
    if (head - from > 1_000) this.log.info({ from, to: head }, 'registry backfill');
    await getLogsChunked(this.client, { topics: [[ACCOUNT_CREATED_TOPIC, ...ACCOUNT_TOPICS]] }, from, head, async (logs, end) => {
      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
      for (const l of logs) await this.handle(l);
      this.cursor = end;
      this.db.setKv('registry.cursor', String(end));
      metrics.indexerLag.set(Math.max(0, this.streams.head - end));
    });
  }

  lagBlocks() {
    return Math.max(0, this.streams.head - this.cursor);
  }

  private async timestampOf(l: ChainLog): Promise<number | null> {
    if (l.blockTimestamp) return l.blockTimestamp;
    const cached = this.blockTs.get(l.blockNumber);
    if (cached) return cached;
    try {
      const b = await this.client.getBlock({ blockNumber: BigInt(l.blockNumber) });
      const ts = Number(b.timestamp);
      this.blockTs.set(l.blockNumber, ts);
      if (this.blockTs.size > 5_000) this.blockTs.clear();
      return ts;
    } catch {
      return null;
    }
  }

  /** Processes one log; also used by the submitter to record copy results the moment a receipt arrives. */
  async handle(l: ChainLog) {
    const addr = l.address.toLowerCase();
    if (l.topics[0] === ACCOUNT_CREATED_TOPIC) {
      if (addr !== this.factory.toLowerCase()) return;
      const ev = decodeEventLog({ abi: mirrorAccountFactoryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if (ev.eventName !== 'AccountCreated') return;
      const { owner, account, salt } = ev.args;
      const ts = await this.timestampOf(l);
      this.db.run(
        `INSERT OR IGNORE INTO accounts (address, owner, salt, created_block, created_tx, created_ts, last_activity_ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        account.toLowerCase(), owner.toLowerCase(), salt, l.blockNumber, l.transactionHash, ts, ts,
      );
      this.refresh(account.toLowerCase());
      this.bus.publish(account, { type: 'account', event: 'AccountCreated', owner, account, txHash: l.transactionHash, block: l.blockNumber });
      return;
    }
    if (!this.accounts.has(addr)) return;

    let ev;
    try {
      ev = decodeEventLog({ abi: mirrorAccountAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    } catch {
      return;
    }
    const ts = await this.timestampOf(l);
    const base: FeedInsert = {
      account: addr, kind: ev.eventName, tx_hash: l.transactionHash, log_index: l.logIndex, block: l.blockNumber, block_hash: l.blockHash,
      ts, leader_id: null, perp_id: null, order_type: null, lots: null, price: null, leverage: null, reason: null, limit_v: null,
      actual_v: null, leader_ref: null, keeper: null, amount: null, latency_ms: null, data: null,
    };
    let feed: FeedInsert | undefined;
    switch (ev.eventName) {
      case 'PerplAccountCreated':
        this.db.run('UPDATE accounts SET perpl_account_id = ? WHERE address = ?', Number(ev.args.perplAccountId), addr);
        break;
      case 'PolicyUpdated': {
        const a = ev.args;
        this.db.tx(() => {
          this.db.run(
            'UPDATE accounts SET max_leverage_hdths = ?, max_slippage_bps = ?, daily_loss_bps = ?, drawdown_bps = ?, expiry = ? WHERE address = ?',
            a.maxLeverageHdths, a.maxSlippageBps, a.dailyLossBps, a.drawdownBps, Number(a.expiry), addr,
          );
          this.db.run('DELETE FROM account_leaders WHERE account = ?', addr);
          this.db.run('DELETE FROM account_markets WHERE account = ?', addr);
          for (const ld of a.leaders) this.db.run('INSERT OR REPLACE INTO account_leaders VALUES (?, ?, ?)', addr, Number(ld.accountId), Number(ld.ratioBps));
          for (const m of a.markets) this.db.run('INSERT OR REPLACE INTO account_markets VALUES (?, ?, ?)', addr, Number(m.perpId), m.maxNotionalCNS.toString());
        });
        feed = {
          ...base,
          leverage: a.maxLeverageHdths,
          data: JSON.stringify({
            maxLeverageHdths: a.maxLeverageHdths, maxSlippageBps: a.maxSlippageBps, dailyLossBps: a.dailyLossBps, drawdownBps: a.drawdownBps,
            expiry: Number(a.expiry), leaders: a.leaders.map((x) => ({ accountId: Number(x.accountId), ratioBps: Number(x.ratioBps) })),
            markets: a.markets.map((x) => ({ perpId: Number(x.perpId), maxNotionalCNS: x.maxNotionalCNS.toString() })),
          }),
        };
        break;
      }
      case 'PausedSet':
        this.db.run('UPDATE accounts SET paused = ? WHERE address = ?', ev.args.paused ? 1 : 0, addr);
        feed = { ...base, kind: 'Paused', data: JSON.stringify({ paused: ev.args.paused }) };
        break;
      case 'Deposited':
        this.db.run('UPDATE accounts SET net_deposits = ?, funded_block = COALESCE(funded_block, ?) WHERE address = ?', ev.args.netDeposits.toString(), l.blockNumber, addr);
        feed = { ...base, amount: ev.args.amount.toString(), data: JSON.stringify({ from: ev.args.from, netDeposits: ev.args.netDeposits.toString() }) };
        break;
      case 'Withdrawn':
        this.db.run('UPDATE accounts SET net_deposits = ? WHERE address = ?', ev.args.netDeposits.toString(), addr);
        feed = { ...base, amount: ev.args.amount.toString(), data: JSON.stringify({ to: ev.args.to, netDeposits: ev.args.netDeposits.toString() }) };
        break;
      case 'ClosedAll':
        feed = { ...base, data: JSON.stringify({ slippageBps: ev.args.slippageBps, positionsClosed: Number(ev.args.positionsClosed) }) };
        break;
      case 'Mirrored': {
        const a = ev.args;
        feed = {
          ...base, keeper: a.keeper, leader_id: Number(a.leaderAccountId), perp_id: Number(a.perpId), order_type: a.orderType, lots: a.lotLNS.toString(),
          price: a.pricePNS.toString(), leverage: a.leverageHdths, leader_ref: a.leaderRef, latency_ms: this.latencyFor(l.transactionHash),
          data: JSON.stringify({ lotsBefore: a.lotsBefore.toString(), lotsAfter: a.lotsAfter.toString() }),
        };
        break;
      }
      case 'Blocked': {
        const a = ev.args;
        feed = {
          ...base, keeper: a.keeper, leader_id: Number(a.leaderAccountId), perp_id: Number(a.perpId), order_type: a.orderType, lots: a.lotLNS.toString(),
          reason: reasonName(a.reason), limit_v: a.limit.toString(), actual_v: a.actual.toString(), leader_ref: a.leaderRef,
          latency_ms: this.latencyFor(l.transactionHash),
        };
        break;
      }
    }
    this.db.run('UPDATE accounts SET last_activity_ts = ? WHERE address = ?', ts, addr);
    if (ev.eventName === 'PolicyUpdated' || ev.eventName === 'PerplAccountCreated' || ev.eventName === 'PausedSet') {
      this.refresh(addr);
      this.onLeadersChanged?.();
    }
    if (feed) {
      const row = insertFeed(this.db, feed);
      if (row) {
        const json = feedJson(row, this.explorerTx);
        this.bus.publish(addr, { type: 'feed', item: json });
        this.onFeed?.(json);
      }
    }
  }

  private latencyFor(txHash: Hex): number | null {
    const r = this.db.get<{ latency_ms: number | null }>('SELECT latency_ms FROM copies WHERE tx_hash = ? AND latency_ms IS NOT NULL LIMIT 1', txHash);
    return r?.latency_ms ?? null;
  }

  private loadFromDb() {
    for (const r of this.db.all<{ address: string }>('SELECT address FROM accounts')) this.refresh(r.address);
  }

  refresh(addr: string) {
    const r = this.db.get<AccountRow>('SELECT * FROM accounts WHERE address = ?', addr);
    if (!r) return;
    const leaders = new Map<number, number>();
    for (const l of this.db.all<{ leader_id: number; ratio_bps: number }>('SELECT leader_id, ratio_bps FROM account_leaders WHERE account = ?', addr)) leaders.set(l.leader_id, l.ratio_bps);
    const markets = new Map<number, bigint>();
    for (const m of this.db.all<{ perp_id: number; max_notional_cns: string }>('SELECT perp_id, max_notional_cns FROM account_markets WHERE account = ?', addr)) markets.set(m.perp_id, BigInt(m.max_notional_cns));
    this.accounts.set(addr, {
      address: getAddress(r.address),
      owner: getAddress(r.owner),
      perplAccountId: r.perpl_account_id ?? 0,
      paused: r.paused === 1,
      expiry: r.expiry ?? 0,
      maxLeverageHdths: r.max_leverage_hdths ?? 0,
      maxSlippageBps: r.max_slippage_bps ?? 0,
      leaders,
      markets,
      teamRun: this.isTeamRun(r.address) || this.isTeamRun(r.owner),
    });
  }

  isTeamRun(addr: string) {
    return this.teamRun.has(addr.toLowerCase());
  }

  get(addr: string): FollowerInfo | undefined {
    return this.accounts.get(addr.toLowerCase());
  }

  all(): FollowerInfo[] {
    return [...this.accounts.values()];
  }

  /** Accounts that can receive copies of `leaderId` in `perpId` (funded, following, market allowed). */
  followersOf(leaderId: number, perpId?: number): FollowerInfo[] {
    return this.all().filter((a) => a.perplAccountId !== 0 && a.leaders.has(leaderId) && (perpId === undefined || a.markets.has(perpId)));
  }

  leaderIds(): Set<number> {
    const s = new Set<number>();
    for (const a of this.accounts.values()) if (a.perplAccountId !== 0) for (const id of a.leaders.keys()) s.add(id);
    return s;
  }
}

export type RegistryLike = Pick<Registry, 'get' | 'isTeamRun' | 'followersOf' | 'all' | 'leaderIds'>;

/** Stand-in when no factory is configured (pre-deploy): no accounts, team-run flags from config only. */
export function nullRegistry(teamRun: Set<string>): RegistryLike {
  return {
    get: () => undefined,
    isTeamRun: (a: string) => teamRun.has(a.toLowerCase()),
    followersOf: () => [],
    all: () => [],
    leaderIds: () => new Set<number>(),
  };
}
