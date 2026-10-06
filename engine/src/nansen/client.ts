import type { LocalAccount } from 'viem';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import { x402Fetch, type X402Options } from './x402.js';

export interface NansenProfile {
  address: string;
  labels: string[];
  /** Monad realized PnL summary (x402, $0.01). */
  monad: { realizedPnlUsd: number; realizedPnlPercent: number; winRate: number; tradedTimes: number } | null;
  /** Hyperliquid perp book of the same wallet (x402, $0.01): cross-venue context for the leader card. */
  crossVenue: { venue: 'hyperliquid'; accountValueUsd: number; positions: number; unrealizedPnlUsd: number } | null;
  fetchedMs: number;
}

export interface NansenOptions {
  apiUrl: string;
  apiKey?: string;
  payer?: LocalAccount;
  network: string;
  maxPerCall: bigint;
  dailyBudget: bigint;
  cacheHours: number;
  fetchImpl?: typeof fetch;
}

const POSITIVE = ['smart', 'fund', 'whale', 'profitable', 'top', 'trader'];
const NEGATIVE = ['exploit', 'scam', 'hack', 'sanction', 'phish', 'rug', 'tornado', 'mixer'];

/** Score adjustment and risk flags derived from Nansen data; used by the leader ranking. */
export function nansenAdjust(p: NansenProfile | null): { bonus: number; flags: string[] } {
  if (!p) return { bonus: 0, flags: [] };
  let bonus = 0;
  const flags: string[] = [];
  const lower = p.labels.map((l) => l.toLowerCase());
  if (lower.some((l) => NEGATIVE.some((n) => l.includes(n)))) {
    bonus -= 50;
    flags.push('nansen_risk_label');
  } else if (lower.some((l) => POSITIVE.some((n) => l.includes(n)))) bonus += 5;
  if (p.monad) {
    if (p.monad.realizedPnlUsd > 0) bonus += 2;
    if (p.monad.winRate >= 0.55 && p.monad.tradedTimes >= 20) bonus += 2;
  }
  if (p.crossVenue && p.crossVenue.unrealizedPnlUsd < -0.2 * Math.max(1, p.crossVenue.accountValueUsd)) flags.push('cross_venue_drawdown');
  return { bonus, flags };
}

/**
 * Nansen leader enrichment over x402 (USDC on Monad, eip155:143) with a per-call cap and a daily budget.
 * Labels need an API key (Nansen excludes the labels endpoint from x402) and are fetched only when one is set.
 * Results are cached; the ranking never waits on a paid call.
 */
export class NansenClient {
  private inflight = new Set<string>();

  constructor(private readonly db: Db, private readonly o: NansenOptions, private readonly log: Logger) {}

  cached(address: string): NansenProfile | null {
    const r = this.db.get<{ value: string; fetched_ms: number }>('SELECT value, fetched_ms FROM nansen_cache WHERE key = ?', `profile:${address.toLowerCase()}`);
    return r ? (JSON.parse(r.value) as NansenProfile) : null;
  }

  private fresh(address: string) {
    const r = this.db.get<{ fetched_ms: number }>('SELECT fetched_ms FROM nansen_cache WHERE key = ?', `profile:${address.toLowerCase()}`);
    return r && Date.now() - r.fetched_ms < this.o.cacheHours * 3600_000;
  }

  /** Returns the cached profile and refreshes it in the background when stale. */
  get(address: string): NansenProfile | null {
    if (!this.fresh(address) && !this.inflight.has(address)) {
      this.inflight.add(address);
      void this.fetchProfile(address)
        .catch((err) => this.log.warn({ address, err: (err as Error).message }, 'nansen enrichment failed'))
        .finally(() => this.inflight.delete(address));
    }
    return this.cached(address);
  }

  private spentToday(): bigint {
    const day = new Date().toISOString().slice(0, 10);
    return BigInt(this.db.get<{ amount: string }>('SELECT amount FROM nansen_spend WHERE day = ?', day)?.amount ?? '0');
  }

  private addSpend(amount: bigint) {
    const day = new Date().toISOString().slice(0, 10);
    this.db.run('INSERT INTO nansen_spend (day, amount) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET amount = ?', day, amount.toString(), (this.spentToday() + amount).toString());
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    const url = `${this.o.apiUrl}${path}`;
    const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json', ...(this.o.apiKey ? { apikey: this.o.apiKey } : {}) }, body: JSON.stringify(body) };
    if (this.o.apiKey) {
      const res = await (this.o.fetchImpl ?? fetch)(url, init);
      metrics.nansenCalls.inc({ path, outcome: String(res.status) });
      return res.ok ? ((await res.json()) as T) : null;
    }
    if (!this.o.payer) return null;
    const x: X402Options = {
      account: this.o.payer,
      networks: [this.o.network],
      maxAmount: this.o.maxPerCall,
      fetchImpl: this.o.fetchImpl,
      approve: (_req, amount) => this.spentToday() + amount <= this.o.dailyBudget,
    };
    const r = await x402Fetch(url, init, x);
    if (r.paid) this.addSpend(r.paid.amount);
    metrics.nansenCalls.inc({ path, outcome: r.paid ? 'paid' : String(r.response.status) });
    return r.response.ok ? ((await r.response.json()) as T) : null;
  }

  async fetchProfile(address: string): Promise<NansenProfile> {
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 86_400_000);
    const [pnl, perp, labels] = await Promise.all([
      this.post<{ realized_pnl_usd: number; realized_pnl_percent: number; win_rate: number; traded_times: number }>('/api/v1/profiler/address/pnl-summary', {
        wallet_address: address,
        chain: 'monad',
        date: { from: from.toISOString(), to: to.toISOString() },
      }).catch(() => null),
      this.post<{ data?: { assetPositions?: Array<{ position: { unrealized_pnl_usd?: number } }>; margin_summary_account_value_usd?: number | string } }>('/api/v1/profiler/perp-positions', { address }).catch(() => null),
      this.o.apiKey
        ? this.post<{ data?: Array<{ label: string }> }>('/api/v1/profiler/address/labels', { address, chain: 'monad', pagination: { page: 1, per_page: 50 } }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const profile: NansenProfile = {
      address,
      labels: labels?.data?.map((l) => l.label) ?? [],
      monad: pnl ? { realizedPnlUsd: pnl.realized_pnl_usd, realizedPnlPercent: pnl.realized_pnl_percent, winRate: pnl.win_rate, tradedTimes: pnl.traded_times } : null,
      crossVenue: perp?.data
        ? {
            venue: 'hyperliquid',
            accountValueUsd: Number(perp.data.margin_summary_account_value_usd ?? 0),
            positions: perp.data.assetPositions?.length ?? 0,
            unrealizedPnlUsd: (perp.data.assetPositions ?? []).reduce((s, p) => s + Number(p.position.unrealized_pnl_usd ?? 0), 0),
          }
        : null,
      fetchedMs: Date.now(),
    };
    this.db.run(
      'INSERT INTO nansen_cache (key, value, fetched_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_ms = excluded.fetched_ms',
      `profile:${address.toLowerCase()}`, JSON.stringify(profile), profile.fetchedMs,
    );
    return profile;
  }
}
