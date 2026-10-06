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
  paused INTEGER NOT NULL DEFAULT 0,
  net_deposits TEXT NOT NULL DEFAULT '0',
  funded_block INTEGER,
  last_activity_ts INTEGER
);
CREATE INDEX IF NOT EXISTS accounts_owner ON accounts(owner);

CREATE TABLE IF NOT EXISTS account_leaders (
  account TEXT NOT NULL, leader_id INTEGER NOT NULL, ratio_bps INTEGER NOT NULL,
  PRIMARY KEY (account, leader_id)
);
CREATE INDEX IF NOT EXISTS account_leaders_leader ON account_leaders(leader_id);

CREATE TABLE IF NOT EXISTS account_markets (
  account TEXT NOT NULL, perp_id INTEGER NOT NULL, max_notional_cns TEXT NOT NULL,
  PRIMARY KEY (account, perp_id)
);

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

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec(SCHEMA);
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
