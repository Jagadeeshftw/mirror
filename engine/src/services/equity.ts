import { getAddress, type Address } from 'viem';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { thin, todayPnl, type Snapshot } from '../domain/risk.js';

export interface EquityOptions {
  /** At most one periodic (or view) snapshot per account per interval; activity snapshots always record. */
  intervalMs: number;
  /** Snapshots older than this are deleted. */
  keepDays?: number;
  /** Points returned per history (thinned evenly in time beyond this). */
  maxPoints?: number;
}

type SnapRow = { ts: number; equity_cns: string; net_deposits_cns: string };
const toSnap = (r: SnapRow): Snapshot => ({ ts: r.ts, equityCNS: BigInt(r.equity_cns), netDepositsCNS: BigInt(r.net_deposits_cns) });
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Account equity history in the engine DB: a periodic snapshot per account at most every `intervalMs`, one on every
 * copy, deposit, withdrawal and close-all, and one when an account view read equity anyway (same interval).
 * Serves the last 30 days and today's PnL net of flows.
 */
export class EquityService {
  private timer?: NodeJS.Timeout;
  private lastPrune = 0;
  /** Called after every snapshot (low-equity alerts). */
  onRecord?: (account: string, equity: bigint, netDepositsCNS: bigint) => void;

  constructor(
    private readonly db: Db,
    private readonly readEquity: (account: Address) => Promise<bigint>,
    private readonly opts: EquityOptions,
    private readonly log?: Logger,
  ) {}

  private get intervalSec() {
    return Math.max(1, Math.floor(this.opts.intervalMs / 1000));
  }

  lastTs(account: string): number | undefined {
    return this.db.get<{ ts: number }>('SELECT MAX(ts) AS ts FROM equity_snapshots WHERE account = ?', account.toLowerCase())?.ts ?? undefined;
  }

  private netDeposits(account: string): string {
    return this.db.get<{ net_deposits: string }>('SELECT net_deposits FROM accounts WHERE address = ?', account.toLowerCase())?.net_deposits ?? '0';
  }

  record(account: string, equity: bigint, reason: string, ts = nowSec(), netDeposits = this.netDeposits(account)) {
    this.db.run('INSERT INTO equity_snapshots (account, ts, equity_cns, net_deposits_cns, reason) VALUES (?, ?, ?, ?, ?)', account.toLowerCase(), ts, equity.toString(), netDeposits, reason);
    this.onRecord?.(account, equity, BigInt(netDeposits || '0'));
    if (ts - this.lastPrune > 3_600) {
      this.lastPrune = ts;
      this.db.run('DELETE FROM equity_snapshots WHERE ts < ?', ts - (this.opts.keepDays ?? 35) * 86_400);
    }
  }

  /** True when the account has no snapshot within the interval. */
  due(account: string, ts = nowSec()) {
    const last = this.lastTs(account);
    return last === undefined || ts - last >= this.intervalSec;
  }

  /** Reads equity and records it; `force` records regardless of the interval (copies and flows). */
  async snapshot(account: string, reason: string, force: boolean): Promise<boolean> {
    if (!force && !this.due(account)) return false;
    try {
      const eq = await this.readEquity(getAddress(account));
      if (!force && !this.due(account)) return false;
      this.record(account, eq, reason);
      return true;
    } catch (err) {
      this.log?.debug({ account, err: (err as Error).message }, 'equity snapshot failed');
      return false;
    }
  }

  /** An account view read equity: keep it when the interval has passed (no extra chain read). */
  noteView(account: string, equity: bigint, ts = nowSec()) {
    if (this.due(account, ts)) this.record(account, equity, 'view', ts);
  }

  async sweep(accounts: string[]) {
    for (const a of accounts) await this.snapshot(a, 'periodic', false);
  }

  start(accounts: () => string[]) {
    const tick = Math.max(1_000, Math.min(60_000, this.opts.intervalMs));
    this.timer = setInterval(() => void this.sweep(accounts()).catch(() => undefined), tick);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** `{t (unix s), equityCNS}` for the last `days` days, oldest first. */
  history(account: string, days = 30, ts = nowSec()): Array<{ t: number; equityCNS: string }> {
    const rows = this.db.all<SnapRow>('SELECT ts, equity_cns, net_deposits_cns FROM equity_snapshots WHERE account = ? AND ts >= ? ORDER BY ts, rowid', account.toLowerCase(), ts - days * 86_400);
    return thin(rows.map((r) => ({ t: r.ts, equityCNS: r.equity_cns })), this.opts.maxPoints ?? 720);
  }

  /** Baseline for today's PnL: the first snapshot of the UTC day, else the last one before it. */
  baseline(account: string, ts = nowSec()): Snapshot | undefined {
    const dayStart = Math.floor(ts / 86_400) * 86_400;
    const a = account.toLowerCase();
    const first = this.db.get<SnapRow>('SELECT ts, equity_cns, net_deposits_cns FROM equity_snapshots WHERE account = ? AND ts >= ? ORDER BY ts, rowid LIMIT 1', a, dayStart);
    const prev = first ?? this.db.get<SnapRow>('SELECT ts, equity_cns, net_deposits_cns FROM equity_snapshots WHERE account = ? AND ts < ? ORDER BY ts DESC, rowid DESC LIMIT 1', a, dayStart);
    return prev ? toSnap(prev) : undefined;
  }

  today(account: string, equityNow: bigint, netDepositsNow: bigint, ts = nowSec()): bigint | null {
    return todayPnl(equityNow, netDepositsNow, this.baseline(account, ts));
  }
}
