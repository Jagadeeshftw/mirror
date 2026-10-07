import { encodeFunctionData } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import type { Reads, PerplPosition } from '../chain/reads.js';
import { SimulationError, type SenderPool, type SendResult } from '../chain/sender.js';
import { simulateCall, decodeBool, type BlockedInfo } from '../chain/simulate.js';
import { classifyClose, classifyOpen, planCopy, targetLots, type PlannedOrder } from '../domain/planner.js';
import { LONG, SHORT, isOpen, ORDER_TYPE_NAMES, type Side } from '../domain/types.js';
import { toOrderStruct } from '../domain/encode.js';
import type { MarketData } from '../perpl/market.js';
import type { Bus } from './bus.js';
import type { FollowerInfo, Registry } from './registry.js';
import type { LeaderChange } from './watcher.js';
import type { ThinBookGuard } from './guard.js';
import { copyTargets } from './detach.js';

export interface CopierOptions {
  safetyBps: number;
  maxMatches: number;
  blockedSubmitReasons: Set<string>;
  demoFollower: string | undefined;
  /** Thin-book guard for opening copies that would execute (blocked copies do not trade and are not guarded). */
  guard?: ThinBookGuard;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plans and submits copies for every follower of a leader that just changed a position. Followers are
 * processed in parallel (independent account state); one follower's orders run strictly in sequence.
 */
export class Copier {
  private queues = new Map<string, Promise<void>>();
  private inflight = 0;

  constructor(
    private readonly db: Db,
    private readonly reads: Reads,
    private readonly registry: Registry,
    private readonly keepers: SenderPool,
    private readonly market: MarketData,
    private readonly bus: Bus,
    private readonly opts: CopierOptions,
    private readonly log: Logger,
  ) {}

  get busy() {
    return this.inflight;
  }

  async onLeaderChange(c: LeaderChange): Promise<void> {
    // Detached accounts ("stop following, keep my positions") get no copies, opens or closes. Paused accounts
    // still get the leader's closes (the contract refuses only their opens).
    const followers = copyTargets(this.registry.followersOf(c.leaderId, c.perpId));
    if (!followers.length) return;

    // Targets are per leader, so only the changed leader's position matters for this event.
    const leaderNow = await this.readLeader(c);

    // Perpl market data: compare the WS mark with the onchain mark the contract will check against.
    const perplMark = await this.market.mark(c.perpId).catch(() => undefined);
    if (perplMark && leaderNow.mark > 0n) {
      const driftBps = Number(((perplMark.markPNS - leaderNow.mark) * 10_000n) / leaderNow.mark);
      if (Math.abs(driftBps) > 50) this.log.warn({ perpId: c.perpId, perplMark: perplMark.markPNS.toString(), chainMark: leaderNow.mark.toString(), driftBps }, 'perpl mark drift vs chain');
    }

    await Promise.all(followers.map((f) => this.enqueue(f.address, () => this.copyFor(f, c, leaderNow))));
  }

  /** Waits until the onchain position reflects the event (the event may be ahead of `latest` at Proposed). */
  private async readLeader(c: LeaderChange): Promise<PerplPosition> {
    let pos = await this.reads.position(c.perpId, c.leaderId);
    for (let i = 0; i < 6 && c.expectedLotsAfter !== undefined && pos.lots !== c.expectedLotsAfter; i++) {
      await sleep(120);
      pos = await this.reads.position(c.perpId, c.leaderId);
    }
    return pos;
  }

  private enqueue(account: string, job: () => Promise<void>): Promise<void> {
    const key = account.toLowerCase();
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(job).catch((err) => this.log.error({ account, err: (err as Error).message }, 'copy job failed'));
    this.queues.set(key, next);
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  private channels(f: FollowerInfo) {
    const ch = [f.address.toLowerCase()];
    if (this.opts.demoFollower && f.address.toLowerCase() === this.opts.demoFollower.toLowerCase()) ch.push('demo');
    return ch;
  }

  private emit(f: FollowerInfo, event: Record<string, unknown>) {
    for (const ch of this.channels(f)) this.bus.publish(ch, { type: 'copy', account: f.address, ...event });
  }

  private async copyFor(f: FollowerInfo, c: LeaderChange, leaderNow: PerplPosition) {
    this.inflight += 1;
    try {
      const follower = await this.reads.position(c.perpId, f.perplAccountId);
      // The market belongs to the leader whose copy opened it; only that leader's changes resize it.
      const holder = follower.lots > 0n ? await this.reads.marketLeader(f.address, c.perpId) : 0;
      const rule = f.leaders.get(c.leaderId);
      const leader = rule ? { ratioBps: rule.ratioBps, side: leaderNow.side, lots: leaderNow.lots } : undefined;
      const holderTarget = holder === c.leaderId ? targetLots(leader, follower.side) : 0n;
      const triggerTarget = targetLots(leader, leaderNow.side);
      const orders = planCopy({
        perpId: c.perpId,
        follower: { side: follower.side, lots: follower.lots },
        holder,
        holderTarget,
        triggerTarget,
        trigger: {
          leaderAccountId: c.leaderId,
          side: leaderNow.side,
          increased: c.increased && leaderNow.lots > 0n,
          leverageHdths: c.leverageHdths ?? 0,
          leaderRef: c.leaderRef,
          leaderFillPNS: c.fillPNS ?? 0n,
          leaderEntryPNS: leaderNow.entryPricePNS,
        },
        mark: follower.mark,
        maxSlippageBps: f.maxSlippageBps,
        safetyBps: this.opts.safetyBps,
        maxMatches: this.opts.maxMatches,
        maxEntryDeviationBps: f.maxEntryDeviationBps,
      });
      this.log.info(
        {
          account: f.address, leader: c.leaderId, perpId: c.perpId, followerLots: follower.lots.toString(), followerSide: follower.side, holder,
          holderTarget: holderTarget.toString(), triggerTarget: triggerTarget.toString(), leaderEntryPNS: leaderNow.entryPricePNS.toString(),
          leaderFillPNS: c.fillPNS?.toString() ?? null, orders: orders.length,
        },
        'copy plan',
      );
      for (const o of orders) {
        const done = await this.execute(f, c, o, follower);
        if (!done) break;
      }
    } finally {
      this.inflight -= 1;
    }
  }

  /** Returns false when later orders of the same plan should not run. */
  private async execute(f: FollowerInfo, c: LeaderChange, planned: PlannedOrder, follower: PerplPosition): Promise<boolean> {
    let o = planned;
    const dedupe = `${f.address.toLowerCase()}:${c.leaderRef}:${o.perpId}:${o.orderType}`;
    const now = Date.now();
    const ins = this.db.run(
      `INSERT OR IGNORE INTO copies (dedupe, account, leader_ref, leader_id, perp_id, order_type, lots, price, leverage, expected, status, created_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'executed', 'planned', ?)`,
      dedupe, f.address.toLowerCase(), c.leaderRef, c.leaderId, o.perpId, o.orderType, o.lotLNS.toString(), o.pricePNS.toString(), o.leverageHdths, now,
    );
    if (Number(ins.changes) === 0) return true;
    const copyId = Number(ins.lastInsertRowid);
    metrics.copiesPlanned.inc({ kind: o.kind });

    const sender = this.keepers.pick();
    let data = encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'mirror', args: [toOrderStruct(o)] });
    const sim = await simulateCall(this.reads.client, sender.address, f.address, data);
    if (!sim.ok) {
      this.db.run(`UPDATE copies SET status = 'skipped', error = ? WHERE id = ?`, sim.revert?.message ?? 'reverted', copyId);
      this.log.warn({ account: f.address, order: ORDER_TYPE_NAMES[o.orderType], lots: o.lotLNS.toString(), revert: sim.revert?.message }, 'copy simulation reverted; skipped');
      this.emit(f, { stage: 'skipped', leaderRef: c.leaderRef, perpId: o.perpId, orderType: o.orderType, error: sim.revert?.message });
      return false;
    }
    const executed = decodeBool(sim.returnData, 'mirror');
    let blocked: BlockedInfo | undefined;
    if (executed === false) {
      blocked = sim.blocked[0] ?? (await this.explainBlock(f, o, follower));
      this.db.run(`UPDATE copies SET expected = 'blocked', reason = ? WHERE id = ?`, blocked.reason, copyId);
      const submit = isOpen(o.orderType) && this.opts.blockedSubmitReasons.has(blocked.reason);
      this.log.info({ account: f.address, leader: c.leaderId, reason: blocked.reason, limit: blocked.limit.toString(), actual: blocked.actual.toString(), submit }, 'copy would be blocked');
      if (!submit) {
        this.db.run(`UPDATE copies SET status = 'skipped' WHERE id = ?`, copyId);
        metrics.copiesBlocked.inc({ reason: blocked.reason, submitted: 'no' });
        return false;
      }
    }

    // Thin-book guard: an executing opening copy needs multiple x its lots on the book within its limit.
    if (!blocked && isOpen(o.orderType) && this.opts.guard?.enabled) {
      const g = await this.opts.guard.check(o.perpId, o.orderType, o.lotLNS, o.pricePNS);
      if (g.decision !== 'ok') {
        this.opts.guard.record({ account: f.address, source: 'keeper', leaderId: c.leaderId, leaderRef: c.leaderRef, perpId: o.perpId, orderType: o.orderType, limitPNS: o.pricePNS, block: c.block }, g);
        metrics.copiesBlocked.inc({ reason: g.decision === 'shrunk' ? 'EngineShrunk' : 'EngineSkipped', submitted: g.decision === 'shrunk' ? 'yes' : 'no' });
        const info = { decision: g.decision, reason: g.reason, requestedLots: g.requestedLots.toString(), finalLots: g.finalLots.toString(), depthLots: g.depthLots?.toString() ?? null, requiredLots: g.requiredLots.toString(), bookSource: g.bookSource };
        this.log.info({ account: f.address, leader: c.leaderId, perpId: o.perpId, ...info }, 'thin-book guard');
        if (g.decision === 'skipped') {
          this.db.run(`UPDATE copies SET status = 'skipped', error = ? WHERE id = ?`, `engine guard: ${g.reason}`, copyId);
          this.emit(f, { stage: 'skipped', leaderRef: c.leaderRef, perpId: o.perpId, orderType: o.orderType, guard: info });
          return false;
        }
        o = { ...o, lotLNS: g.finalLots };
        data = encodeFunctionData({ abi: mirrorAccountAbi, functionName: 'mirror', args: [toOrderStruct(o)] });
        const resim = await simulateCall(this.reads.client, sender.address, f.address, data);
        if (!resim.ok || decodeBool(resim.returnData, 'mirror') !== true) {
          this.db.run(`UPDATE copies SET status = 'skipped', error = ? WHERE id = ?`, 'engine guard: shrunk order did not simulate', copyId);
          return false;
        }
        this.db.run(`UPDATE copies SET lots = ?, error = ? WHERE id = ?`, o.lotLNS.toString(), `engine guard: shrunk from ${g.requestedLots}`, copyId);
      }
    }

    // Perpl book: expected fill for the log line and the feed (the IOC limit is the contract-checked bound).
    const fill = !blocked ? await this.market.expectedFill(o.perpId, o.orderType, o.lotLNS, o.pricePNS).catch(() => undefined) : undefined;
    this.emit(f, { stage: 'submitting', leaderRef: c.leaderRef, perpId: o.perpId, orderType: o.orderType, lotLNS: o.lotLNS.toString(), pricePNS: o.pricePNS.toString(), leverageHdths: o.leverageHdths, expected: blocked ? 'blocked' : 'executed', reason: blocked?.reason ?? null, expectedFillPNS: fill?.pricePNS?.toString() ?? null });

    let res: SendResult;
    try {
      res = await sender.send({ to: f.address, data, label: `mirror:${blocked ? 'blocked' : o.kind}`, gasProfile: 'book' });
    } catch (err) {
      const msg = err instanceof SimulationError ? err.revert.message : (err as Error).message;
      this.db.run(`UPDATE copies SET status = 'failed', error = ?, keeper = ? WHERE id = ?`, msg, sender.address, copyId);
      metrics.copiesSubmitted.inc({ result: 'failed' });
      this.log.error({ account: f.address, err: msg }, 'copy submission failed');
      this.emit(f, { stage: 'failed', leaderRef: c.leaderRef, error: msg });
      return false;
    }
    const latency = res.includedMs - c.observedMs;
    this.db.run(
      `UPDATE copies SET status = ?, tx_hash = ?, keeper = ?, included_ms = ?, block = ?, gas_used = ?, latency_ms = ?, error = ? WHERE id = ?`,
      res.status === 'success' ? 'mined' : 'reverted', res.hash, sender.address, res.includedMs, res.blockNumber, res.gasUsed.toString(), latency,
      res.revert?.message ?? null, copyId,
    );
    metrics.copiesSubmitted.inc({ result: res.status === 'success' ? (blocked ? 'blocked' : 'executed') : 'reverted' });
    if (blocked) metrics.copiesBlocked.inc({ reason: blocked.reason, submitted: 'yes' });
    else if (res.status === 'success') metrics.copyLatency.observe(latency);
    this.log.info(
      { account: f.address, leader: c.leaderId, tx: res.hash, status: res.status, block: res.blockNumber, leaderBlock: c.block, latencyMs: latency, gasUsed: res.gasUsed.toString(), gasLimit: res.gasLimit.toString(), blocked: blocked?.reason, expectedFillPNS: fill?.pricePNS?.toString(), revert: res.revert?.message },
      'copy included',
    );
    // Record the feed rows now rather than waiting for the indexer.
    await this.registry.handleReceipt(res);
    this.emit(f, { stage: res.status === 'success' ? 'included' : 'reverted', leaderRef: c.leaderRef, txHash: res.hash, block: res.blockNumber, latencyMs: latency, blocked: blocked?.reason ?? null });
    return res.status === 'success' && !blocked;
  }

  /** Without eth_simulateV1 logs, replays the contract's checks to name the rule. */
  private async explainBlock(f: FollowerInfo, o: PlannedOrder, follower: PerplPosition): Promise<BlockedInfo> {
    const [s, marketLeader, leaderPos, book, block, builder] = await Promise.all([
      this.reads.account(f.address),
      this.reads.marketLeader(f.address, o.perpId),
      this.reads.position(o.perpId, o.leaderAccountId),
      this.reads.leaderBook(f.address, o.leaderAccountId),
      this.reads.client.getBlock(),
      this.reads.builder(f.address),
    ]);
    const m = s.markets.find((x) => x.perpId === o.perpId);
    const rule = s.leaders.find((l) => l.accountId === o.leaderAccountId);
    const side: Side = o.orderType === 0 || o.orderType === 2 ? LONG : SHORT;
    const target = targetLots(rule ? { ratioBps: rule.ratioBps, side: leaderPos.side, lots: leaderPos.lots } : undefined, side);
    if (!isOpen(o.orderType)) {
      const r = classifyClose(o, { follower: { side: follower.side, lots: follower.lots }, leaderAllowed: Boolean(rule), marketLeader, target, markValid: follower.markValid, mark: follower.mark, maxSlippageBps: s.maxSlippageBps });
      return r === 'revert' ? { reason: 'None', limit: 0n, actual: 0n } : { reason: r.reason, limit: r.limit, actual: r.actual };
    }
    const r = classifyOpen(o, {
      now: Number(block.timestamp),
      paused: s.paused,
      expiry: s.expiry,
      marketAllowed: Boolean(m?.allowed),
      marketHalted: Boolean(m?.halted),
      maxNotionalCNS: m?.maxNotionalCNS ?? 0n,
      lotDecimals: m?.lotDecimals ?? 0,
      priceDecimals: m?.priceDecimals ?? 0,
      leaderAllowed: Boolean(rule),
      leaderStopped: book.stopped,
      builderFeePer100K: builder.feePer100K,
      maxBuilderFeePer100K: s.maxBuilderFeePer100K,
      maxLeverageHdths: s.maxLeverageHdths,
      follower: { side: follower.side, lots: follower.lots },
      marketLeader,
      markValid: follower.markValid,
      mark: follower.mark,
      maxSlippageBps: s.maxSlippageBps,
      leader: { side: leaderPos.side, lots: leaderPos.lots },
      leaderEntryPNS: leaderPos.entryPricePNS,
      maxEntryDeviationBps: s.maxEntryDeviationBps,
      target,
      budgetCNS: rule?.budgetCNS ?? 0n,
      lossStopBps: rule?.lossStopBps ?? 0,
      leaderMarginCNS: book.marginCNS,
      leaderUnrealizedCNS: book.unrealizedCNS,
      leaderRealizedCNS: book.realizedCNS,
      equity: s.equity,
      riskDay: s.riskDay,
      dayStartEquity: s.dayStartEquity,
      highWaterEquity: s.highWaterEquity,
      dailyLossBps: s.dailyLossBps,
      drawdownBps: s.drawdownBps,
    });
    return { reason: r.reason, limit: r.limit, actual: r.actual };
  }

  async drain(timeoutMs = 15_000) {
    const end = Date.now() + timeoutMs;
    while (this.queues.size && Date.now() < end) await Promise.race([...this.queues.values(), sleep(250)]);
  }
}

