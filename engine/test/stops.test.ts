import { describe, expect, it } from 'vitest';
import { decodeFunctionData, type Address, type Hex } from 'viem';
import pino from 'pino';
import { mirrorAccountAbi } from '../src/abi/MirrorAccount.js';
import { Db } from '../src/db.js';
import { Bus } from '../src/services/bus.js';
import { StopExecutor } from '../src/services/stops.js';
import { accountStopHit, leaderStopHit, levelHit, trustedMark } from '../src/domain/stops.js';
import { LONG, SHORT } from '../src/domain/types.js';
import type { FollowerInfo } from '../src/services/registry.js';
import type { Reads } from '../src/chain/reads.js';

const log = pino({ level: 'silent' });
const ACCOUNT = '0x00000000000000000000000000000000000000a1' as Address;
const STRANGER = '0x00000000000000000000000000000000000000b2' as Address;

describe('stop conditions (contract formulas)', () => {
  const price = (mark: bigint, oraclePNS = 0n, oracleFresh = false) => ({ mark, markValid: true, oraclePNS, oracleFresh });
  const long = { perpId: 1, side: LONG, stopLossPNS: 900n, takeProfitPNS: 1_100n, slippageBps: 100 } as const;
  const short = { perpId: 1, side: SHORT, stopLossPNS: 1_100n, takeProfitPNS: 900n, slippageBps: 100 } as const;
  const posL = { side: LONG, lots: 5n } as const;
  const posS = { side: SHORT, lots: 5n } as const;

  it('long: take-profit at or above, stop-loss at or below; nothing in between', () => {
    expect(levelHit(long, posL, price(1_100n))).toBe('TakeProfit');
    expect(levelHit(long, posL, price(900n))).toBe('StopLoss');
    expect(levelHit(long, posL, price(1_000n))).toBeUndefined();
  });
  it('short is mirrored', () => {
    expect(levelHit(short, posS, price(899n))).toBe('TakeProfit');
    expect(levelHit(short, posS, price(1_100n))).toBe('StopLoss');
  });
  it('needs a position on the level side', () => {
    expect(levelHit(long, { side: LONG, lots: 0n }, price(2_000n))).toBeUndefined();
    expect(levelHit(long, posS, price(2_000n))).toBeUndefined();
  });
  it('a fresh oracle must also reach the level and agree with the mark within 2%', () => {
    expect(levelHit(long, posL, price(1_100n, 1_090n, true))).toBeUndefined(); // oracle below TP
    expect(levelHit(long, posL, price(1_100n, 1_100n, true))).toBe('TakeProfit');
    expect(trustedMark(price(1_100n, 1_000n, true))).toBe(false); // 10% gap
    expect(levelHit(long, posL, { mark: 1_100n, markValid: false, oraclePNS: 0n, oracleFresh: false })).toBeUndefined();
  });
  it('account stop: daily loss vs day start, drawdown vs high-water; a new day resets daily', () => {
    const s = { now: 86_400 * 10, equity: 9_000n, riskDay: 10, dayStartEquity: 10_000n, highWaterEquity: 10_000n, dailyLossBps: 500, drawdownBps: 0 };
    expect(accountStopHit(s)).toBe('DailyLoss');
    expect(accountStopHit({ ...s, riskDay: 9 })).toBeUndefined();
    expect(accountStopHit({ ...s, dailyLossBps: 0, drawdownBps: 500, highWaterEquity: 12_000n })).toBe('Drawdown');
  });
  it('leader stop: realized + unrealized below -lossStopBps x budget', () => {
    expect(leaderStopHit(-600n, -500n, 10_000n, 1_000)).toBe(true);
    expect(leaderStopHit(-600n, -400n, 10_000n, 1_000)).toBe(false); // exactly -limit is not below
    expect(leaderStopHit(-10_000n, 0n, 10_000n, 0)).toBe(false);
  });
});

function follower(over: Partial<FollowerInfo> = {}): FollowerInfo {
  return {
    address: ACCOUNT, owner: ACCOUNT, perplAccountId: 42, paused: false, expiry: 0, maxLeverageHdths: 300, maxSlippageBps: 80, dailyLossBps: 0, drawdownBps: 0,
    maxEntryDeviationBps: 0, stopSlippageBps: 100, flattenOnStop: false, maxBuilderFeePer100K: 20, leaders: new Map(), markets: new Map([[1, 1n]]), halted: new Set(),
    levels: new Map([[1, { perpId: 1, side: LONG, stopLossPNS: 0n, takeProfitPNS: 1_100n, slippageBps: 100 }]]), teamRun: false, ...over,
  };
}

/** Fake reads: position at mark 1_200 (take-profit reached), oracle stale, eth_call result controlled per test. */
function harness(callReverts: boolean) {
  const calls: Array<{ account: Address; to: Address; data: Hex }> = [];
  const sends: Array<{ to: Address; data: Hex; gasProfile?: string }> = [];
  const reads = {
    client: {
      async getBlock() {
        return { timestamp: 1_000n };
      },
      async call(c: { account: Address; to: Address; data: Hex }) {
        calls.push(c);
        if (callReverts) throw Object.assign(new Error('execution reverted'), { data: '0x' });
        return { data: '0x' };
      },
    },
    async position() {
      return { side: LONG, lots: 7n, mark: 1_200n, markValid: true, depositCNS: 0n, entryPricePNS: 1_000n, pnlCNS: 0n };
    },
    async oracle() {
      return { oraclePNS: 0n, fresh: false };
    },
  } as unknown as Reads;
  const sender = {
    address: STRANGER,
    async send(req: { to: Address; data: Hex; gasProfile?: string }) {
      sends.push(req);
      return { hash: `0x${'cd'.repeat(32)}`, status: 'success', gasUsed: 1n, gasLimit: 2n, receipt: { logs: [] } } as never;
    },
  };
  const db = new Db(':memory:');
  const ex = new StopExecutor(db, reads, () => [follower()], () => sender, new Bus(), { intervalMs: 0, retryMs: 60_000 }, log);
  return { ex, calls, sends, db };
}

describe('StopExecutor account stop', () => {
  /** A flat account with flattenOnStop and a 20% drawdown stop; its risk state comes from `state`. */
  const executor = (state: { equity: bigint; highWaterEquity: bigint; paused?: boolean }) => {
    const reads = {
      client: {
        async readContract({ functionName }: { functionName: string }) {
          const v: Record<string, unknown> = { equity: state.equity, riskDay: 0n, dayStartEquity: state.highWaterEquity, highWaterEquity: state.highWaterEquity, paused: state.paused ?? false };
          return v[functionName];
        },
      },
      async position() {
        return { side: LONG, lots: 0n, mark: 1_000n, markValid: true, depositCNS: 0n, entryPricePNS: 0n, pnlCNS: 0n };
      },
      async oracle() {
        return { oraclePNS: 0n, fresh: false };
      },
    } as unknown as Reads;
    return new StopExecutor(new Db(':memory:'), reads, () => [], () => undefined as never, new Bus(), { intervalMs: 0, retryMs: 60_000 }, log);
  };
  const f = follower({ flattenOnStop: true, drawdownBps: 2_000, levels: new Map() });

  it('leaves an emptied account alone: after a loss and a full withdrawal the stop reads as hit until the next deposit', async () => {
    // 150 deposited, 0.266584 lost, 149.733416 withdrawn: high-water 0.266584, equity 0 (the 9 Oct test user).
    expect(await executor({ equity: 0n, highWaterEquity: 266_584n }).candidatesFor(f, 86_400)).toEqual([]);
  });

  it('still triggers on a funded account below its drawdown floor, flat or not, until it is paused', async () => {
    const c = await executor({ equity: 70_000_000n, highWaterEquity: 100_000_000n }).candidatesFor(f, 86_400);
    expect(c.map((x) => [x.kind, x.reason])).toEqual([['account', 'Drawdown']]);
    expect(await executor({ equity: 70_000_000n, highWaterEquity: 100_000_000n, paused: true }).candidatesFor(f, 86_400)).toEqual([]);
  });
});

describe('StopExecutor', () => {
  it('never sends a trigger whose eth_call simulation reverts', async () => {
    const h = harness(true);
    const r = await h.ex.scan();
    expect(r.map((x) => x.outcome)).toEqual(['simulation_reverted']);
    expect(h.calls).toHaveLength(1);
    expect(h.sends).toHaveLength(0);
    expect(h.db.get<{ status: string }>('SELECT status FROM stop_triggers')?.status).toBe('simulation_reverted');
  });

  it('simulates from the sending signer, then sends triggerLevel with the book headroom', async () => {
    const h = harness(false);
    const r = await h.ex.scan();
    expect(r.map((x) => [x.candidate.kind, x.candidate.reason, x.outcome])).toEqual([['level', 'TakeProfit', 'mined']]);
    expect(h.calls[0]!.account).toBe(STRANGER);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]!.gasProfile).toBe('book');
    const d = decodeFunctionData({ abi: mirrorAccountAbi, data: h.sends[0]!.data });
    expect(d.functionName).toBe('triggerLevel');
    expect(d.args).toEqual([1n]);
    // Cooldown: the same stop is not retried immediately.
    expect(await h.ex.scan()).toEqual([]);
  });
});
