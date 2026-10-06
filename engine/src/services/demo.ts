import { randomUUID } from 'node:crypto';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { perplExchangeAbi } from '../abi/PerplExchange.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import type { Reads } from '../chain/reads.js';
import type { TxSender } from '../chain/sender.js';
import { contractSlippageBound } from '../domain/planner.js';
import { CLOSE_LONG, CLOSE_SHORT, OPEN_LONG } from '../domain/types.js';
import type { MarketData } from '../perpl/market.js';
import type { Bus, BusEvent } from './bus.js';
import type { Registry } from './registry.js';
import { RateLimiter, RateLimitError } from './ratelimit.js';

export interface DemoOptions {
  perpId: number;
  lots: number;
  leverageHdths: number;
  blockedLeverageHdths: number;
  holdMs: number;
  slippageBps: number;
  ipHourly: number;
  dailyCap: number;
  followerAccount: Address | undefined;
}

export class DemoError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Kind = 'trade' | 'blocked';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Judge path: a team-run leader EOA trades 1 lot directly on the Perpl Exchange and the engine copies it into
 * the team-run demo follower. 'blocked' trades at a leverage above the follower's max so the copy is blocked
 * onchain. One cycle at a time, per-IP hourly limit, global daily cap.
 */
export class DemoService {
  private current?: string;
  leaderAccountId = 0;

  constructor(
    private readonly db: Db,
    private readonly reads: Reads,
    private readonly leader: TxSender | undefined,
    private readonly exchange: Address,
    private readonly registry: Registry,
    private readonly market: MarketData,
    private readonly bus: Bus,
    private readonly limiter: RateLimiter,
    private readonly opts: DemoOptions,
    private readonly log: Logger,
  ) {}

  get enabled() {
    return Boolean(this.leader && this.opts.followerAccount);
  }

  get leaderAddress(): Address | undefined {
    return this.leader?.address;
  }

  async init() {
    if (!this.leader) return;
    try {
      this.leaderAccountId = await this.reads.accountIdOf(this.leader.address);
      this.log.info({ leader: this.leader.address, accountId: this.leaderAccountId, follower: this.opts.followerAccount }, 'demo leader');
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'demo leader has no Perpl account yet');
    }
  }

  private dailyCount(): number {
    const since = Date.now() - 24 * 3600_000;
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM demo_cycles WHERE started_ms > ?', since)?.n ?? 0;
  }

  async start(kind: Kind, ip: string): Promise<{ cycleId: string; kind: Kind; status: string; stream: string }> {
    if (!this.enabled || !this.leader) throw new DemoError(503, 'demo not configured');
    if (!this.leaderAccountId) await this.init();
    if (!this.leaderAccountId) throw new DemoError(503, 'demo leader has no Perpl account');
    const follower = this.registry.get(this.opts.followerAccount!);
    if (!follower || !follower.leaders.has(this.leaderAccountId) || !follower.markets.has(this.opts.perpId)) {
      throw new DemoError(503, 'demo follower is not following the demo leader in this market yet');
    }
    if (this.current) throw new DemoError(409, `a demo cycle is already running (${this.current})`);
    if (this.dailyCount() >= this.opts.dailyCap) throw new DemoError(429, 'demo daily cap reached');
    const lim = this.limiter.hit(`demo:${ip}`, this.opts.ipHourly, 3600_000);
    if (!lim.ok) throw new RateLimitError('demo per-IP hourly', lim.resetAt);

    const id = randomUUID();
    this.current = id;
    this.db.run('INSERT INTO demo_cycles (id, kind, ip, status, started_ms) VALUES (?, ?, ?, ?, ?)', id, kind, ip, 'running', Date.now());
    void this.run(id, kind).finally(() => {
      this.current = undefined;
    });
    return { cycleId: id, kind, status: 'started', stream: '/v1/stream?account=demo' };
  }

  private step(id: string, step: string, data: Record<string, unknown> = {}) {
    const ev: BusEvent = { type: 'demo', cycleId: id, step, at: Date.now(), ...data };
    const row = this.db.get<{ steps: string }>('SELECT steps FROM demo_cycles WHERE id = ?', id);
    const steps = row ? (JSON.parse(row.steps) as unknown[]) : [];
    steps.push(ev);
    this.db.run('UPDATE demo_cycles SET steps = ? WHERE id = ?', JSON.stringify(steps), id);
    this.bus.publish('demo', ev);
    this.log.info({ cycleId: id, step, ...data }, 'demo step');
  }

  private async leaderOrder(orderType: number, lots: bigint, leverage: number): Promise<Hex> {
    const pos = await this.reads.position(this.opts.perpId, this.leaderAccountId);
    const perpl = await this.market.mark(this.opts.perpId).catch(() => undefined);
    const price = contractSlippageBound(orderType, pos.mark, this.opts.slippageBps);
    const data = encodeFunctionData({
      abi: perplExchangeAbi,
      functionName: 'execOrder',
      args: [
        {
          orderDescId: BigInt(Date.now()),
          perpId: BigInt(this.opts.perpId),
          orderType,
          orderId: 0n,
          pricePNS: price,
          lotLNS: lots,
          expiryBlock: 0n,
          postOnly: false,
          fillOrKill: false,
          immediateOrCancel: true,
          maxMatches: 100n,
          leverageHdths: BigInt(leverage),
          lastExecutionBlock: 0n,
          amountCNS: 0n,
          maxNegPnlCollatBPS: 1000n,
        },
      ],
    });
    const res = await this.leader!.send({ to: this.exchange, data, label: `demo:order${orderType}` });
    if (res.status !== 'success') throw new Error(`leader order reverted: ${res.revert?.message ?? ''}`);
    this.log.info({ orderType, lots: lots.toString(), pricePNS: price.toString(), chainMark: pos.mark.toString(), perplMark: perpl?.markPNS.toString(), perplSource: perpl?.source, tx: res.hash }, 'demo leader order');
    return res.hash;
  }

  /** Waits for the follower's onchain result for a leader tx (Mirrored or Blocked feed item) in `seen`. */
  private async waitForCopy(seen: BusEvent[], leaderRef: Hex, timeoutMs: number): Promise<BusEvent | undefined> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const hit = seen.find((e) => {
        const item = e.type === 'feed' ? (e.item as { leaderRef?: string; kind?: string }) : undefined;
        return item && item.leaderRef?.toLowerCase() === leaderRef.toLowerCase() && (item.kind === 'Mirrored' || item.kind === 'Blocked');
      });
      if (hit) return hit;
      await sleep(100);
    }
    return undefined;
  }

  private async run(id: string, kind: Kind) {
    const lots = BigInt(this.opts.lots);
    const leverage = kind === 'trade' ? this.opts.leverageHdths : this.opts.blockedLeverageHdths;
    // Collect events from before the leader order is sent so a fast copy is not missed.
    const seen: BusEvent[] = [];
    const off = this.bus.subscribe('demo', (e) => seen.push(e));
    try {
      this.step(id, 'leader_opening', { kind, perpId: this.opts.perpId, lots: lots.toString(), leverageHdths: leverage });
      const openTx = await this.leaderOrder(OPEN_LONG, lots, leverage);
      this.db.run('UPDATE demo_cycles SET open_tx = ? WHERE id = ?', openTx, id);
      this.step(id, 'leader_opened', { txHash: openTx });
      const copyEv = await this.waitForCopy(seen, openTx, 45_000);
      const item = copyEv?.item as { txHash?: string; kind?: string; reason?: string; latencyMs?: number } | undefined;
      if (item) {
        this.db.run('UPDATE demo_cycles SET copy_tx = ? WHERE id = ?', item.txHash ?? null, id);
        this.step(id, item.kind === 'Blocked' ? 'copy_blocked' : 'copy_executed', { txHash: item.txHash, reason: item.reason ?? null, latencyMs: item.latencyMs ?? null });
      } else {
        this.step(id, 'copy_timeout');
      }

      if (kind === 'trade') {
        this.step(id, 'holding', { ms: this.opts.holdMs });
        await sleep(this.opts.holdMs);
      } else {
        await sleep(2_000);
      }

      const pos = await this.reads.position(this.opts.perpId, this.leaderAccountId);
      if (pos.lots > 0n) {
        this.step(id, 'leader_closing', { lots: pos.lots.toString() });
        const closeTx = await this.leaderOrder(pos.side === 0 ? CLOSE_LONG : CLOSE_SHORT, pos.lots, 0);
        this.db.run('UPDATE demo_cycles SET close_tx = ? WHERE id = ?', closeTx, id);
        this.step(id, 'leader_closed', { txHash: closeTx });
        if (kind === 'trade' && item?.kind === 'Mirrored') {
          const closeCopy = await this.waitForCopy(seen, closeTx, 45_000);
          const ci = closeCopy?.item as { txHash?: string; latencyMs?: number } | undefined;
          if (ci) {
            this.db.run('UPDATE demo_cycles SET copy_close_tx = ? WHERE id = ?', ci.txHash ?? null, id);
            this.step(id, 'copy_closed', { txHash: ci.txHash, latencyMs: ci.latencyMs ?? null });
          } else this.step(id, 'copy_close_timeout');
        }
      }
      this.db.run(`UPDATE demo_cycles SET status = 'done', ended_ms = ? WHERE id = ?`, Date.now(), id);
      this.step(id, 'done');
      metrics.demoCycles.inc({ kind, outcome: 'done' });
    } catch (err) {
      const msg = (err as Error).message;
      this.db.run(`UPDATE demo_cycles SET status = 'failed', ended_ms = ?, error = ? WHERE id = ?`, Date.now(), msg, id);
      this.step(id, 'failed', { error: msg });
      metrics.demoCycles.inc({ kind, outcome: 'failed' });
      // Best effort: never leave the demo leader with an open position.
      try {
        const pos = await this.reads.position(this.opts.perpId, this.leaderAccountId);
        if (pos.lots > 0n) await this.leaderOrder(pos.side === 0 ? CLOSE_LONG : CLOSE_SHORT, pos.lots, 0);
      } catch {
        /* reported above */
      }
    } finally {
      off();
    }
  }

  get running() {
    return this.current;
  }

  async state() {
    const leaderPos = this.leaderAccountId ? await this.reads.position(this.opts.perpId, this.leaderAccountId).catch(() => undefined) : undefined;
    const follower = this.opts.followerAccount ? this.registry.get(this.opts.followerAccount) : undefined;
    const followerPos = follower?.perplAccountId ? await this.reads.position(this.opts.perpId, follower.perplAccountId).catch(() => undefined) : undefined;
    const cycles = this.db.all<Record<string, unknown>>('SELECT * FROM demo_cycles ORDER BY started_ms DESC LIMIT 20').map((c) => ({ ...c, steps: JSON.parse(String(c.steps)) }));
    return {
      enabled: this.enabled,
      running: this.current ?? null,
      perpId: this.opts.perpId,
      lots: this.opts.lots,
      leverageHdths: this.opts.leverageHdths,
      blockedLeverageHdths: this.opts.blockedLeverageHdths,
      limits: { perIpHourly: this.opts.ipHourly, dailyCap: this.opts.dailyCap, usedToday: this.dailyCount() },
      leader: { address: this.leader?.address ?? null, accountId: this.leaderAccountId || null, teamRun: true, position: leaderPos ? { side: leaderPos.side, lotLNS: leaderPos.lots.toString() } : null },
      follower: {
        account: this.opts.followerAccount ?? null,
        teamRun: true,
        perplAccountId: follower?.perplAccountId ?? null,
        maxLeverageHdths: follower?.maxLeverageHdths ?? null,
        following: follower ? [...follower.leaders].map(([accountId, ratioBps]) => ({ accountId, ratioBps })) : [],
        position: followerPos ? { side: followerPos.side, lotLNS: followerPos.lots.toString() } : null,
      },
      cycles,
    };
  }
}
