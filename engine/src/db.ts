import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS accounts (
  address TEXT PRIMARY KEY,           -- lowercase
  owner TEXT NOT NULL,                -- lowercase
  salt TEXT NOT NULL,
  created_block INTEGER NOT NULL,
  created_tx TEXT NOT NULL,
  created_ts INTEGER,
  perpl_account_id INTEGER,
  max_leverage_hdths INTEGER,
  max_slippage_bps INTEGER,
  daily_loss_bps INTEGER,
  drawdown_bps INTEGER,
  expiry INTEGER,
  max_entry_deviation_bps INTEGER,
  stop_slippage_bps INTEGER,
  flatten_on_stop INTEGER NOT NULL DEFAULT 0,
  max_builder_fee_per_100k INTEGER,
  paused INTEGER NOT NULL DEFAULT 0,
  net_deposits TEXT NOT NULL DEFAULT '0',
  funded_block INTEGER,
  last_activity_ts INTEGER
);
CREATE INDEX IF NOT EXISTS accounts_owner ON accounts(owner);

CREATE TABLE IF NOT EXISTS account_leaders (
  account TEXT NOT NULL, leader_id INTEGER NOT NULL, ratio_bps INTEGER NOT NULL,
  budget_cns TEXT NOT NULL DEFAULT '0',
  loss_stop_bps INTEGER NOT NULL DEFAULT 0,
  stopped INTEGER NOT NULL DEFAULT 0,  -- LeaderStopped seen since the last PolicyUpdated
  PRIMARY KEY (account, leader_id)
);
CREATE INDEX IF NOT EXISTS account_leaders_leader ON account_leaders(leader_id);

CREATE TABLE IF NOT EXISTS account_markets (
  account TEXT NOT NULL, perp_id INTEGER NOT NULL, max_notional_cns TEXT NOT NULL,
  halted INTEGER NOT NULL DEFAULT 0,   -- an owner level fired; cleared by the next PolicyUpdated
  PRIMARY KEY (account, perp_id)
);

-- Owner stop-loss / take-profit levels (LevelSet), watched by the stop executor.
CREATE TABLE IF NOT EXISTS account_levels (
  account TEXT NOT NULL, perp_id INTEGER NOT NULL, side INTEGER NOT NULL,
  stop_loss_pns TEXT NOT NULL, take_profit_pns TEXT NOT NULL, slippage_bps INTEGER NOT NULL,
  PRIMARY KEY (account, perp_id)
);

-- Stop executor attempts (simulated first; only a successful simulation is sent).
CREATE TABLE IF NOT EXISTS stop_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- level | account | leader
  scope INTEGER NOT NULL,             -- perpId, 0, or leader account id
  status TEXT NOT NULL,               -- simulation_reverted | mined | reverted | failed
  tx_hash TEXT,
  sender TEXT,
  error TEXT,
  gas_used TEXT,
  gas_limit TEXT,
  created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stop_triggers_account ON stop_triggers(account, id);

CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  kind TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block INTEGER NOT NULL,
  block_hash TEXT,
  ts INTEGER,
  commit_state TEXT NOT NULL DEFAULT 'proposed',
  leader_id INTEGER,
  perp_id INTEGER,
  order_type INTEGER,
  lots TEXT,
  price TEXT,
  leverage INTEGER,
  reason TEXT,
  limit_v TEXT,
  actual_v TEXT,
  leader_ref TEXT,
  keeper TEXT,
  amount TEXT,
  latency_ms INTEGER,
  data TEXT,
  builder_fee_cns TEXT,                -- Mirrored: CopyProof.builderFeeCNS (0 for closes)
  leader_block INTEGER,                -- Mirrored / Blocked: block of the leader fill that triggered the copy
  leader_lots TEXT,                    -- Blocked: lots the leader traded in that fill
  leader_leverage INTEGER,             -- Blocked: the leader's leverage on that fill
  realised_pnl_cns TEXT,               -- Mirrored closes: realised PnL of the copy (Perpl close event or leaderRealizedCNS change)
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS feed_account ON feed(account, id);
CREATE INDEX IF NOT EXISTS feed_kind ON feed(kind, id);
CREATE INDEX IF NOT EXISTS feed_block ON feed(block);

CREATE TABLE IF NOT EXISTS leader_fills (
  leader_ref TEXT NOT NULL,           -- leader tx hash
  leader_id INTEGER NOT NULL,
  perp_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  block INTEGER NOT NULL,
  observed_ms INTEGER NOT NULL,
  lots_after TEXT,
  leverage INTEGER,
  price TEXT,                         -- leader fill price from the Perpl event (copy proof leaderFillPNS)
  PRIMARY KEY (leader_ref, leader_id, perp_id)
);

CREATE TABLE IF NOT EXISTS copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL,
  leader_ref TEXT NOT NULL,
  leader_id INTEGER NOT NULL,
  perp_id INTEGER NOT NULL,
  order_type INTEGER NOT NULL,
  lots TEXT NOT NULL,
  price TEXT NOT NULL,
  leverage INTEGER NOT NULL,
  expected TEXT NOT NULL,             -- executed | blocked
  reason TEXT,
  status TEXT NOT NULL,               -- planned | sent | mined | reverted | failed | skipped
  tx_hash TEXT,
  keeper TEXT,
  error TEXT,
  created_ms INTEGER NOT NULL,
  included_ms INTEGER,
  block INTEGER,
  gas_used TEXT,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS copies_tx ON copies(tx_hash);

CREATE TABLE IF NOT EXISTS perpl_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block INTEGER NOT NULL,
  ts INTEGER,
  account_id INTEGER NOT NULL,
  perp_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  position_type INTEGER,
  lots_after TEXT,
  lots_before TEXT,
  price TEXT,
  delta_pnl TEXT,
  leverage INTEGER,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS perpl_events_account ON perpl_events(account_id, block);
CREATE INDEX IF NOT EXISTS perpl_events_block ON perpl_events(block);

-- Engine-side thin-book guard decisions (no transaction): opening copies shrunk or skipped before sending.
CREATE TABLE IF NOT EXISTS guard_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT,                       -- lowercase; null for a quote on an account not deployed yet
  source TEXT NOT NULL,               -- keeper | quote
  leader_id INTEGER NOT NULL,
  leader_ref TEXT,
  perp_id INTEGER NOT NULL,
  order_type INTEGER NOT NULL,
  decision TEXT NOT NULL,             -- shrunk | skipped
  reason TEXT NOT NULL,               -- thin_book | book_unavailable
  requested_lots TEXT NOT NULL,
  final_lots TEXT NOT NULL,
  depth_lots TEXT,
  required_lots TEXT NOT NULL,
  multiple_bps INTEGER NOT NULL,
  limit_pns TEXT NOT NULL,
  book_source TEXT NOT NULL,
  book_age_ms INTEGER,
  created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guard_events_account ON guard_events(account, id);
CREATE INDEX IF NOT EXISTS guard_events_leader ON guard_events(leader_id, id);

-- Account equity over time: at most one periodic snapshot per EQUITY_SNAPSHOT_MS, plus one on every copy,
-- deposit and withdrawal. net_deposits is the contract's netDeposits at that moment (today's PnL is net of flows).
CREATE TABLE IF NOT EXISTS equity_snapshots (
  account TEXT NOT NULL,              -- lowercase
  ts INTEGER NOT NULL,                -- unix seconds
  equity_cns TEXT NOT NULL,
  net_deposits_cns TEXT NOT NULL,
  reason TEXT NOT NULL                -- periodic | view | Mirrored | Deposited | Withdrawn | ClosedAll
);
CREATE INDEX IF NOT EXISTS equity_snapshots_account ON equity_snapshots(account, ts);

CREATE TABLE IF NOT EXISTS demo_cycles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ip TEXT NOT NULL,
  status TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  ended_ms INTEGER,
  open_tx TEXT,
  close_tx TEXT,
  copy_tx TEXT,
  copy_close_tx TEXT,
  error TEXT,
  steps TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS push_tokens (
  owner TEXT NOT NULL,
  token TEXT NOT NULL,
  notify_public_key TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  PRIMARY KEY (owner, token)
);

-- Alert delivery targets. channel: 'app' (in-app SSE only), 'webpush' (target = endpoint, p256dh/auth from the
-- browser subscription) or 'expo' (target = Expo push token). Every row carries the device's notification public key;
-- alerts are sealed to it, so every channel relays ciphertext only.
CREATE TABLE IF NOT EXISTS push_subs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  p256dh TEXT,
  auth TEXT,
  notify_public_key TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  last_sent_ms INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subs_owner ON push_subs (owner);

CREATE TABLE IF NOT EXISTS nansen_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nansen_spend (
  day TEXT PRIMARY KEY,
  amount TEXT NOT NULL
);
`;

/** Columns added after the first schema; applied to existing databases on open (idempotent). */
const COLUMN_MIGRATIONS: Array<[table: string, column: string, decl: string]> = [
  ['accounts', 'max_entry_deviation_bps', 'INTEGER'],
  ['accounts', 'stop_slippage_bps', 'INTEGER'],
  ['accounts', 'flatten_on_stop', 'INTEGER NOT NULL DEFAULT 0'],
  ['account_leaders', 'budget_cns', "TEXT NOT NULL DEFAULT '0'"],
  ['account_leaders', 'loss_stop_bps', 'INTEGER NOT NULL DEFAULT 0'],
  ['account_leaders', 'stopped', 'INTEGER NOT NULL DEFAULT 0'],
  ['account_markets', 'halted', 'INTEGER NOT NULL DEFAULT 0'],
  ['leader_fills', 'price', 'TEXT'],
  ['accounts', 'max_builder_fee_per_100k', 'INTEGER'],
  ['feed', 'builder_fee_cns', 'TEXT'],
  ['feed', 'leader_block', 'INTEGER'],
  ['feed', 'leader_lots', 'TEXT'],
  ['feed', 'leader_leverage', 'INTEGER'],
  ['feed', 'realised_pnl_cns', 'TEXT'],
];

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec(SCHEMA);
    this.migrate();
  }

  private migrate() {
    for (const [table, column, decl] of COLUMN_MIGRATIONS) {
      const cols = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!cols.some((c) => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }

  all<T = Row>(query: string, ...params: SQLInputValue[]): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }

  get<T = Row>(query: string, ...params: SQLInputValue[]): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }

  run(query: string, ...params: SQLInputValue[]) {
    return this.sql.prepare(query).run(...params);
  }

  tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN');
    try {
      const r = fn();
      this.sql.exec('COMMIT');
      return r;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  getKv(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value;
  }

  setKv(key: string, value: string) {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  close() {
    this.sql.close();
  }
}
