import { decodeEventLog, getAddress, toEventSelector, type Address, type Hex, type PublicClient } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { mirrorAccountFactoryAbi } from '../abi/MirrorAccountFactory.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import { getLogsChunked, normalizeLog, type ChainLog, type ChainStreams } from '../chain/streams.js';
import type { SendResult } from '../chain/sender.js';
import { STOP_KINDS, type Level, type Side } from '../domain/types.js';
import type { Bus } from './bus.js';
import { feedJson, insertFeed, reasonName, type FeedInsert } from './feed.js';

const accountEvents = [
  'PerplAccountCreated', 'PolicyUpdated', 'PausedSet', 'Deposited', 'Withdrawn', 'ClosedAll', 'Mirrored', 'Blocked',
  'LevelSet', 'StopTriggered', 'LeaderStopped', 'MarketClosed',
] as const;

const selector = (name: string, abi: readonly unknown[]) => {
  const item = (abi as Array<{ type: string; name?: string }>).find((e) => e.type === 'event' && e.name === name);
  if (!item) throw new Error(`event ${name} missing from ABI`);
  return toEventSelector(item as never);
};

export const ACCOUNT_CREATED_TOPIC = selector('AccountCreated', mirrorAccountFactoryAbi);
export const ACCOUNT_TOPICS = accountEvents.map((n) => selector(n, mirrorAccountAbi));

export interface LeaderRuleInfo {
  ratioBps: number;
  budgetCNS: bigint;
  lossStopBps: number;
  /** LeaderStopped seen since the last policy update. */
  stopped: boolean;
}

export interface FollowerInfo {
  address: Address;
  owner: Address;
  perplAccountId: number;
  paused: boolean;
  expiry: number;
  maxLeverageHdths: number;
  maxSlippageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  maxEntryDeviationBps: number;
  stopSlippageBps: number;
  flattenOnStop: boolean;
  maxBuilderFeePer100K: number;
  leaders: Map<number, LeaderRuleInfo>;
  markets: Map<number, bigint>;
  /** Markets where an owner level fired (opening copies blocked until the next policy). */
  halted: Set<number>;
  levels: Map<number, Level>;
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
  daily_loss_bps: number | null;
  drawdown_bps: number | null;
  max_entry_deviation_bps: number | null;
  stop_slippage_bps: number | null;
  flatten_on_stop: number;
  max_builder_fee_per_100k: number | null;
};

/**
 * Follower registry and feed indexer: discovers MirrorAccounts from the factory's AccountCreated events and
 * keeps each account's Perpl account id, policy, leaders, markets and levels (PerplAccountCreated, PolicyUpdated,
 * LevelSet, LeaderStopped, StopTriggered), plus the account feed (Mirrored with its copy proof, Blocked,
 * Deposited, StopTriggered, ...). Backfills from the factory deploy block in
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
        // A policy update re-arms every listed leader and clears market halts, as _setPolicy does.
        this.db.tx(() => {
          this.db.run(
            `UPDATE accounts SET max_leverage_hdths = ?, max_slippage_bps = ?, daily_loss_bps = ?, drawdown_bps = ?, expiry = ?,
               max_entry_deviation_bps = ?, stop_slippage_bps = ?, flatten_on_stop = ?, max_builder_fee_per_100k = ? WHERE address = ?`,
            a.maxLeverageHdths, a.maxSlippageBps, a.dailyLossBps, a.drawdownBps, Number(a.expiry), a.maxEntryDeviationBps, a.stopSlippageBps, a.flattenOnStop ? 1 : 0,
            a.maxBuilderFeePer100K, addr,
          );
          this.db.run('DELETE FROM account_leaders WHERE account = ?', addr);
          this.db.run('DELETE FROM account_markets WHERE account = ?', addr);
          for (const ld of a.leaders) {
            this.db.run(
              'INSERT OR REPLACE INTO account_leaders (account, leader_id, ratio_bps, budget_cns, loss_stop_bps, stopped) VALUES (?, ?, ?, ?, ?, 0)',
              addr, Number(ld.accountId), Number(ld.ratioBps), ld.budgetCNS.toString(), Number(ld.lossStopBps),
            );
          }
          for (const m of a.markets) this.db.run('INSERT OR REPLACE INTO account_markets (account, perp_id, max_notional_cns, halted) VALUES (?, ?, ?, 0)', addr, Number(m.perpId), m.maxNotionalCNS.toString());
        });
        feed = {
          ...base,
          leverage: a.maxLeverageHdths,
          data: JSON.stringify({
            maxLeverageHdths: a.maxLeverageHdths, maxSlippageBps: a.maxSlippageBps, dailyLossBps: a.dailyLossBps, drawdownBps: a.drawdownBps,
            expiry: Number(a.expiry), maxEntryDeviationBps: a.maxEntryDeviationBps, stopSlippageBps: a.stopSlippageBps, flattenOnStop: a.flattenOnStop,
            maxBuilderFeePer100K: a.maxBuilderFeePer100K,
            leaders: a.leaders.map((x) => ({ accountId: Number(x.accountId), ratioBps: Number(x.ratioBps), budgetCNS: x.budgetCNS.toString(), lossStopBps: Number(x.lossStopBps) })),
            markets: a.markets.map((x) => ({ perpId: Number(x.perpId), maxNotionalCNS: x.maxNotionalCNS.toString() })),
          }),
        };
        break;
      }
      case 'LevelSet': {
        const a = ev.args;
        if (a.stopLossPNS === 0n && a.takeProfitPNS === 0n) this.db.run('DELETE FROM account_levels WHERE account = ? AND perp_id = ?', addr, Number(a.perpId));
        else {
          this.db.run(
            'INSERT OR REPLACE INTO account_levels (account, perp_id, side, stop_loss_pns, take_profit_pns, slippage_bps) VALUES (?, ?, ?, ?, ?, ?)',
            addr, Number(a.perpId), a.side, a.stopLossPNS.toString(), a.takeProfitPNS.toString(), a.slippageBps,
          );
        }
        feed = { ...base, perp_id: Number(a.perpId), data: JSON.stringify({ side: a.side, stopLossPNS: a.stopLossPNS.toString(), takeProfitPNS: a.takeProfitPNS.toString(), slippageBps: a.slippageBps }) };
        break;
      }
      case 'StopTriggered': {
        const a = ev.args;
        const kind = STOP_KINDS[a.kind] ?? `Unknown(${a.kind})`;
        if (kind === 'StopLoss' || kind === 'TakeProfit') {
          // The market is halted for opening copies; the level is deleted onchain once the position is flat.
          this.db.run('UPDATE account_markets SET halted = 1 WHERE account = ? AND perp_id = ?', addr, Number(a.scope));
          await this.syncLevel(addr, Number(a.scope));
        }
        feed = {
          ...base, keeper: a.caller, reason: kind, perp_id: kind === 'StopLoss' || kind === 'TakeProfit' ? Number(a.scope) : null,
          leader_id: kind === 'LeaderLoss' ? Number(a.scope) : null, limit_v: a.limit.toString(), actual_v: a.actual.toString(),
          data: JSON.stringify({ kind, scope: Number(a.scope), caller: a.caller, limit: a.limit.toString(), actual: a.actual.toString(), oraclePNS: a.oraclePNS.toString(), closed: a.positionsClosed.toString() }),
        };
        break;
      }
      case 'LeaderStopped': {
        const a = ev.args;
        this.db.run('UPDATE account_leaders SET stopped = 1 WHERE account = ? AND leader_id = ?', addr, Number(a.leaderAccountId));
        feed = { ...base, leader_id: Number(a.leaderAccountId), limit_v: a.limitCNS.toString(), actual_v: a.pnlCNS.toString(), data: JSON.stringify({ pnlCNS: a.pnlCNS.toString(), limitCNS: a.limitCNS.toString() }) };
        break;
      }
      case 'MarketClosed': {
        const a = ev.args;
        feed = { ...base, perp_id: Number(a.perpId), data: JSON.stringify({ slippageBps: a.slippageBps, lotsBefore: a.lotsBefore.toString(), lotsAfter: a.lotsAfter.toString() }) };
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
        const p = a.proof;
        feed = {
          ...base, keeper: a.keeper, leader_id: Number(a.leaderAccountId), perp_id: Number(a.perpId), order_type: a.orderType, lots: a.lotLNS.toString(),
          price: a.pricePNS.toString(), leverage: a.leverageHdths, leader_ref: a.leaderRef, latency_ms: this.latencyFor(l.transactionHash),
          builder_fee_cns: p.builderFeeCNS.toString(),
          data: JSON.stringify({
            lotsBefore: a.lotsBefore.toString(),
            lotsAfter: a.lotsAfter.toString(),
            proof: { leaderFillPNS: p.leaderFillPNS.toString(), leaderEntryPNS: p.leaderEntryPNS.toString(), markPNS: p.markPNS.toString(), fillPNS: p.fillPNS.toString(), entryDeviationBps: p.entryDeviationBps, builderFeeCNS: p.builderFeeCNS.toString() },
          }),
        };
        break;
      }
      case 'Blocked': {
        const a = ev.args;
        feed = {
          ...base, keeper: a.keeper, leader_id: Number(a.leaderAccountId), perp_id: Number(a.perpId), order_type: a.orderType, lots: a.lotLNS.toString(),
          reason: reasonName(a.reason), limit_v: a.limit.toString(), actual_v: a.actual.toString(), leader_ref: a.leaderRef,
          latency_ms: this.latencyFor(l.transactionHash),
          data: JSON.stringify({ leaderFillPNS: a.leaderFillPNS.toString(), markPNS: a.markPNS.toString() }),
        };
        break;
      }
    }
    this.db.run('UPDATE accounts SET last_activity_ts = ? WHERE address = ?', ts, addr);
    if (['PolicyUpdated', 'PerplAccountCreated', 'PausedSet', 'LevelSet', 'StopTriggered', 'LeaderStopped'].includes(ev.eventName)) {
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

  /** Records a transaction's receipt logs now (copies, stop triggers) rather than waiting for the next head. */
  async handleReceipt(res: SendResult) {
    for (const raw of res.receipt.logs) {
      await this.handle(
        normalizeLog({
          address: raw.address,
          topics: raw.topics as string[],
          data: raw.data,
          blockNumber: `0x${res.blockNumber.toString(16)}`,
          blockHash: res.blockHash,
          transactionHash: res.hash,
          logIndex: `0x${(raw.logIndex ?? 0).toString(16)}`,
        }),
      );
    }
  }

  /** Re-reads one level from the contract (a fully closed level is deleted onchain without a LevelSet event). */
  private async syncLevel(addr: string, perpId: number) {
    try {
      const lv = await this.client.readContract({ address: getAddress(addr), abi: mirrorAccountAbi, functionName: 'level', args: [BigInt(perpId)] });
      if (lv.stopLossPNS === 0n && lv.takeProfitPNS === 0n) this.db.run('DELETE FROM account_levels WHERE account = ? AND perp_id = ?', addr, perpId);
    } catch (err) {
      this.log.warn({ account: addr, perpId, err: (err as Error).message }, 'level re-read failed');
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
    const leaders = new Map<number, LeaderRuleInfo>();
    for (const l of this.db.all<{ leader_id: number; ratio_bps: number; budget_cns: string; loss_stop_bps: number; stopped: number }>('SELECT * FROM account_leaders WHERE account = ?', addr)) {
      leaders.set(l.leader_id, { ratioBps: l.ratio_bps, budgetCNS: BigInt(l.budget_cns), lossStopBps: l.loss_stop_bps, stopped: l.stopped === 1 });
    }
    const markets = new Map<number, bigint>();
    const halted = new Set<number>();
    for (const m of this.db.all<{ perp_id: number; max_notional_cns: string; halted: number }>('SELECT * FROM account_markets WHERE account = ?', addr)) {
      markets.set(m.perp_id, BigInt(m.max_notional_cns));
      if (m.halted === 1) halted.add(m.perp_id);
    }
    const levels = new Map<number, Level>();
    for (const v of this.db.all<{ perp_id: number; side: number; stop_loss_pns: string; take_profit_pns: string; slippage_bps: number }>('SELECT * FROM account_levels WHERE account = ?', addr)) {
      levels.set(v.perp_id, { perpId: v.perp_id, side: (v.side === 1 ? 1 : 0) as Side, stopLossPNS: BigInt(v.stop_loss_pns), takeProfitPNS: BigInt(v.take_profit_pns), slippageBps: v.slippage_bps });
    }
    this.accounts.set(addr, {
      address: getAddress(r.address),
      owner: getAddress(r.owner),
      perplAccountId: r.perpl_account_id ?? 0,
      paused: r.paused === 1,
      expiry: r.expiry ?? 0,
      maxLeverageHdths: r.max_leverage_hdths ?? 0,
      maxSlippageBps: r.max_slippage_bps ?? 0,
      dailyLossBps: r.daily_loss_bps ?? 0,
      drawdownBps: r.drawdown_bps ?? 0,
      maxEntryDeviationBps: r.max_entry_deviation_bps ?? 0,
      stopSlippageBps: r.stop_slippage_bps ?? 0,
      flattenOnStop: r.flatten_on_stop === 1,
      maxBuilderFeePer100K: r.max_builder_fee_per_100k ?? 0,
      leaders,
      markets,
      halted,
      levels,
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
