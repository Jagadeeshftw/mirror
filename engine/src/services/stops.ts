import { encodeFunctionData, type Address, type Hex } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import type { Reads } from '../chain/reads.js';
import { decodeRevert } from '../chain/errors.js';
import { SimulationError, type SendResult, type TxSender } from '../chain/sender.js';
import { accountStopHit, leaderStopHit, levelHit } from '../domain/stops.js';
import type { Bus } from './bus.js';
import type { FollowerInfo } from './registry.js';

export type StopKindName = 'level' | 'account' | 'leader';

export interface StopCandidate {
  account: Address;
  kind: StopKindName;
  /** perpId for a level, 0 for the account stop, the leader's account id for a leader stop. */
  scope: number;
  /** Why the engine thinks the stop is live (StopLoss, TakeProfit, DailyLoss, Drawdown, LeaderLoss). */
  reason: string;
  data: Hex;
}

export type StopOutcome = 'simulation_reverted' | 'mined' | 'reverted' | 'failed';

export interface StopExecutorOptions {
  intervalMs: number;
  retryMs: number;
}

type SenderLike = Pick<TxSender, 'address' | 'send'>;

/**
 * Executes followers' stops permissionlessly once they are true onchain: owner levels (triggerLevel), the account
 * loss stop with flattenOnStop (triggerAccountStop) and leader loss stops with flattenOnStop (triggerLeaderStop).
 * Each candidate is pre-checked off-chain with the contract's own conditions, then simulated with eth_call on
 * the configured Monad RPC from the signer that would send it. Only a successful simulation is sent, with a gas
 * limit from Monad's eth_estimateGas and the book headroom. A trigger whose simulation reverts is never sent.
 */
export class StopExecutor {
  private running = false;
  private lastRun = 0;
  private cooldown = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly reads: Reads,
    private readonly accounts: () => FollowerInfo[],
    private readonly pickSender: () => SenderLike,
    private readonly bus: Bus,
    private readonly opts: StopExecutorOptions,
    private readonly log: Logger,
    /** Records receipt logs in the feed right away (Registry.handleReceipt). */
    private readonly onReceipt?: (res: SendResult) => Promise<void>,
  ) {}

  /** Runs a scan on new heads, at most once per intervalMs and never two at a time. */
  kick() {
    const now = Date.now();
    if (this.running || now - this.lastRun < this.opts.intervalMs) return;
    this.lastRun = now;
    this.running = true;
    void this.scan()
      .catch((err) => this.log.error({ err: (err as Error).message }, 'stop scan failed'))
      .finally(() => {
        this.running = false;
      });
  }

  async scan(): Promise<Array<{ candidate: StopCandidate; outcome: StopOutcome }>> {
    const out: Array<{ candidate: StopCandidate; outcome: StopOutcome }> = [];
    const block = await this.reads.client.getBlock();
    const now = Number(block.timestamp);
    for (const f of this.accounts()) {
      if (f.perplAccountId === 0) continue;
      let candidates: StopCandidate[];
      try {
        candidates = await this.candidatesFor(f, now);
      } catch (err) {
        this.log.warn({ account: f.address, err: (err as Error).message }, 'stop pre-check failed');
        continue;
      }
      for (const c of candidates) {
        const key = `${c.account.toLowerCase()}:${c.kind}:${c.scope}`;
        if ((this.cooldown.get(key) ?? 0) > Date.now()) continue;
        out.push({ candidate: c, outcome: await this.execute(c) });
        this.cooldown.set(key, Date.now() + this.opts.retryMs);
      }
    }
    return out;
  }

  /** Stops whose onchain condition holds now, by the contract's own formulas. */
  async candidatesFor(f: FollowerInfo, now: number): Promise<StopCandidate[]> {
    const out: StopCandidate[] = [];
    const account = f.address;

    for (const lv of f.levels.values()) {
      const pos = await this.reads.position(lv.perpId, f.perplAccountId);
      if (pos.lots === 0n || pos.side !== lv.side) continue;
      const oracle = await this.reads.oracle(lv.perpId);
      const hit = levelHit(lv, pos, { mark: pos.mark, markValid: pos.markValid, oraclePNS: oracle.oraclePNS, oracleFresh: oracle.fresh });
      if (hit) out.push({ account, kind: 'level', scope: lv.perpId, reason: hit, data: encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'triggerLevel', args: [BigInt(lv.perpId)] }) });
    }

    if (!f.flattenOnStop) return out;

    if (f.dailyLossBps !== 0 || f.drawdownBps !== 0) {
      const c = { address: account, abi: mirrorAccountAbi } as const;
      const r = this.reads.client;
      const [equity, riskDay, dayStartEquity, highWaterEquity, paused] = await Promise.all([
        r.readContract({ ...c, functionName: 'equity' }),
        r.readContract({ ...c, functionName: 'riskDay' }),
        r.readContract({ ...c, functionName: 'dayStartEquity' }),
        r.readContract({ ...c, functionName: 'highWaterEquity' }),
        r.readContract({ ...c, functionName: 'paused' }),
      ]);
      const hit = accountStopHit({ now, equity, riskDay: Number(riskDay), dayStartEquity, highWaterEquity, dailyLossBps: f.dailyLossBps, drawdownBps: f.drawdownBps });
      // Once paused and flat there is nothing left for the trigger to do. Nor with no equity at all: an account
      // emptied after a loss keeps a high-water mark above zero (withdrawals lower it by the amount, not to zero),
      // so the stop reads as hit until the next deposit; pausing it then would only make a returning user's
      // deposit land in a paused account. Copies stay blocked onchain while the stop holds.
      if (hit && equity > 0n && (!paused || (await this.hasOpenPosition(f)))) {
        out.push({ account, kind: 'account', scope: 0, reason: hit, data: encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'triggerAccountStop' }) });
      }
    }

    for (const [leaderId, rule] of f.leaders) {
      if (rule.lossStopBps === 0) continue;
      const book = await this.reads.leaderBook(account, leaderId);
      // Latch the stop once, then only while positions are still held for the leader.
      if (leaderStopHit(book.realizedCNS, book.unrealizedCNS, rule.budgetCNS, rule.lossStopBps) && (!book.stopped || book.marginCNS > 0n)) {
        out.push({ account, kind: 'leader', scope: leaderId, reason: 'LeaderLoss', data: encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'triggerLeaderStop', args: [leaderId] }) });
      }
    }
    return out;
  }

  private async hasOpenPosition(f: FollowerInfo): Promise<boolean> {
    for (const perpId of f.markets.keys()) {
      if ((await this.reads.position(perpId, f.perplAccountId)).lots > 0n) return true;
    }
    return false;
  }

  private record(c: StopCandidate, status: StopOutcome, extra: { tx?: Hex; sender?: Address; error?: string; gasUsed?: bigint; gasLimit?: bigint } = {}) {
    this.db.run(
      'INSERT INTO stop_triggers (account, kind, scope, status, tx_hash, sender, error, gas_used, gas_limit, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      c.account.toLowerCase(), c.kind, c.scope, status, extra.tx ?? null, extra.sender ?? null, extra.error ?? null, extra.gasUsed?.toString() ?? null, extra.gasLimit?.toString() ?? null, Date.now(),
    );
    metrics.stopTriggers.inc({ kind: c.kind, outcome: status });
    this.bus.publish(c.account.toLowerCase(), { type: 'stop', kind: c.kind, scope: c.scope, reason: c.reason, status, txHash: extra.tx ?? null, error: extra.error ?? null });
  }

  /** Simulates the trigger with eth_call on Monad; sends it only if the simulation succeeds. */
  async execute(c: StopCandidate): Promise<StopOutcome> {
    const sender = this.pickSender();
    try {
      await this.reads.client.call({ account: sender.address, to: c.account, data: c.data });
    } catch (err) {
      const revert = decodeRevert(err);
      this.record(c, 'simulation_reverted', { sender: sender.address, error: revert.message });
      this.log.info({ account: c.account, kind: c.kind, scope: c.scope, reason: c.reason, revert: revert.message }, 'stop trigger simulation reverted; not sent');
      return 'simulation_reverted';
    }
    let res: SendResult;
    try {
      res = await sender.send({ to: c.account, data: c.data, label: `stop:${c.kind}`, gasProfile: 'book' });
    } catch (err) {
      const msg = err instanceof SimulationError ? err.revert.message : (err as Error).message;
      // An estimate that reverts is a failed simulation too: nothing was signed.
      const status: StopOutcome = err instanceof SimulationError ? 'simulation_reverted' : 'failed';
      this.record(c, status, { sender: sender.address, error: msg });
      this.log.warn({ account: c.account, kind: c.kind, scope: c.scope, err: msg }, 'stop trigger not sent');
      return status;
    }
    const status: StopOutcome = res.status === 'success' ? 'mined' : 'reverted';
    this.record(c, status, { tx: res.hash, sender: sender.address, error: res.revert?.message, gasUsed: res.gasUsed, gasLimit: res.gasLimit });
    this.log.info({ account: c.account, kind: c.kind, scope: c.scope, reason: c.reason, tx: res.hash, status: res.status, gasUsed: res.gasUsed.toString(), gasLimit: res.gasLimit.toString() }, 'stop triggered');
    await this.onReceipt?.(res).catch((err) => this.log.warn({ err: (err as Error).message }, 'stop receipt not recorded'));
    return status;
  }
}
