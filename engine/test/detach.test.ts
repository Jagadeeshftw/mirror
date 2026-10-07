// "Stop following, keep my positions" is MirrorAccount.leaderDetached (per leader, contract-enforced). The engine
// indexes LeaderDetachedSet, keeps it across setPolicy for kept leaders, sends no copies of a detached leader, and
// labels Blocked reason 22 (LeaderDetached).
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { decodeAbiParameters, encodeAbiParameters, encodeEventTopics, type AbiParameter, type Address, type Hex, type PublicClient } from 'viem';
import { mirrorAccountAbi } from '../src/abi/MirrorAccount.js';
import { Db } from '../src/db.js';
import { Bus } from '../src/services/bus.js';
import { Registry } from '../src/services/registry.js';
import { copyTargets, DETACH_GONE } from '../src/services/detach.js';
import { alertFor, ruleName } from '../src/services/alerts.js';
import { reasonName } from '../src/services/feed.js';
import { classifyClose, classifyOpen, planCopy } from '../src/domain/planner.js';
import { encodeLeaderDetached } from '../src/domain/encode.js';
import { ACTION, BLOCK_REASONS, LONG } from '../src/domain/types.js';
import type { ChainLog, ChainStreams } from '../src/chain/streams.js';

const log = pino({ level: 'silent' });
const ACCOUNT = '0x00000000000000000000000000000000000000a1' as Address;

function encodeEventLog(eventName: string, args: Record<string, unknown>): { topics: Hex[]; data: Hex } {
  const item = mirrorAccountAbi.find((e) => e.type === 'event' && e.name === eventName) as unknown as { inputs: Array<AbiParameter & { indexed?: boolean }> };
  const topics = encodeEventTopics({ abi: mirrorAccountAbi, eventName, args } as never) as Hex[];
  const rest = item.inputs.filter((i) => !i.indexed);
  return { topics, data: encodeAbiParameters(rest, rest.map((i) => args[i.name!]) as never) };
}

let n = 0;
const chainLog = (block: number, ev: { topics: Hex[]; data: Hex }): ChainLog => ({
  address: ACCOUNT, topics: ev.topics, data: ev.data, blockNumber: block, blockHash: `0x${'00'.repeat(32)}`, blockTimestamp: 2000,
  transactionHash: `0x${(++n).toString(16).padStart(64, '0')}`, logIndex: 0, commitState: undefined, removed: false, observedMs: 0,
});

const policy = (leaders: number[]) =>
  encodeEventLog('PolicyUpdated', {
    maxLeverageHdths: 1000, maxSlippageBps: 100, dailyLossBps: 0, drawdownBps: 0, expiry: 2_000_000_000, maxEntryDeviationBps: 0, stopSlippageBps: 100,
    flattenOnStop: false, maxBuilderFeePer100K: 20,
    leaders: leaders.map((accountId) => ({ accountId, ratioBps: 10_000, budgetCNS: 1_000_000n, lossStopBps: 0 })),
    markets: [{ perpId: 1, maxNotionalCNS: 1_000_000_000n }],
  });
const detachedSet = (leaderAccountId: number, detached: boolean) => encodeEventLog('LeaderDetachedSet', { leaderAccountId, detached });

function setup() {
  const db = new Db(':memory:');
  db.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, created_ts, perpl_account_id) VALUES (?, ?, '0x0', 1, '0x', 1000, 55)`, ACCOUNT.toLowerCase(), ACCOUNT.toLowerCase());
  const reg = new Registry(db, {} as PublicClient, { head: 0 } as unknown as ChainStreams, '0x00000000000000000000000000000000000000f0', 0, new Set(), 'https://x/tx/', new Bus(), log);
  reg.refresh(ACCOUNT.toLowerCase());
  const items: Array<Record<string, unknown>> = [];
  reg.onFeed = (j) => items.push(j as Record<string, unknown>);
  const detached = (id: number) => reg.get(ACCOUNT)!.leaders.get(id)?.detached;
  return { db, reg, items, detached };
}

describe('LeaderDetachedSet indexing', () => {
  it('records the flag per leader and an onchain feed row (real tx, not offchain)', async () => {
    const { reg, items, detached } = setup();
    await reg.handle(chainLog(10, policy([7, 8])));
    const l = chainLog(11, detachedSet(7, true));
    await reg.handle(l);
    expect(detached(7)).toBe(true);
    expect(detached(8)).toBe(false);
    const row = items.at(-1)!;
    expect(row).toMatchObject({ kind: 'LeaderDetached', onchain: true, txHash: l.transactionHash, leaderAccountId: 7 });
    expect(row.commitState).not.toBe('offchain');
    expect(row.data).toMatchObject({ detached: true, label: 'Stopped following this leader (positions kept)' });
  });

  it('setPolicy keeps it for a kept leader; a signed detached=false clears it', async () => {
    const { reg, items, detached } = setup();
    await reg.handle(chainLog(10, policy([7, 8])));
    await reg.handle(chainLog(11, detachedSet(7, true)));
    await reg.handle(chainLog(12, policy([7])));
    expect(detached(7)).toBe(true);
    await reg.handle(chainLog(13, detachedSet(7, false)));
    expect(detached(7)).toBe(false);
    expect((items.at(-1)!.data as { label: string }).label).toBe('Following this leader again');
  });

  it('removing the leader (LeaderDetachedSet(false) then PolicyUpdated) and re-adding it starts clean', async () => {
    const { reg, detached } = setup();
    await reg.handle(chainLog(10, policy([7, 8])));
    await reg.handle(chainLog(11, detachedSet(7, true)));
    await reg.handle(chainLog(12, detachedSet(7, false)));
    await reg.handle(chainLog(12, policy([8])));
    expect(reg.get(ACCOUNT)!.leaders.has(7)).toBe(false);
    await reg.handle(chainLog(13, policy([7, 8])));
    expect(detached(7)).toBe(false);
  });

  it('follow() (PolicyUpdated then LeaderDetachedSet(false)) clears it', async () => {
    const { reg, detached } = setup();
    await reg.handle(chainLog(10, policy([7])));
    await reg.handle(chainLog(11, detachedSet(7, true)));
    await reg.handle(chainLog(12, policy([7])));
    await reg.handle(chainLog(12, detachedSet(7, false)));
    expect(detached(7)).toBe(false);
  });
});

describe('copier targets', () => {
  const f = (address: string, detachedIds: number[] = [], paused = false) => ({
    address, paused, leaders: new Map([7, 8].map((id) => [id, { detached: detachedIds.includes(id) }])),
  });
  it('skips accounts that detached this leader only (opens and closes)', () => {
    const all = [f('a'), f('b', [7]), f('c', [8])];
    expect(copyTargets(all, 7).map((x) => x.address)).toEqual(['a', 'c']);
    expect(copyTargets(all, 8).map((x) => x.address)).toEqual(['a', 'b']);
  });
  it('a paused account still receives the leader closes', () => {
    expect(copyTargets([f('p', [], true)], 7).map((x) => x.address)).toEqual(['p']);
    const orders = planCopy({
      perpId: 1, follower: { side: LONG, lots: 4n }, holder: 7, holderTarget: 0n, triggerTarget: 0n,
      trigger: { leaderAccountId: 7, side: LONG, increased: false, leverageHdths: 0, leaderRef: `0x${'ab'.repeat(32)}`, leaderFillPNS: 0n, leaderEntryPNS: 0n },
      mark: 1_000_000n, maxSlippageBps: 100, safetyBps: 5, maxMatches: 10, maxEntryDeviationBps: 0,
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!).toMatchObject({ kind: 'close', orderType: 2, lotLNS: 4n, leaderAccountId: 7 });
  });
});

describe('reason 22 and the action payload', () => {
  const order = { leaderAccountId: 7, perpId: 1, orderType: 2, lotLNS: 4n, pricePNS: 1n, leverageHdths: 0, maxMatches: 0, leaderRef: `0x${'00'.repeat(32)}` as Hex, leaderFillPNS: 0n };
  it('is LeaderDetached at index 22, labelled', () => {
    expect(BLOCK_REASONS.indexOf('LeaderDetached')).toBe(22);
    expect(reasonName(22)).toBe('LeaderDetached');
    expect(ruleName('LeaderDetached')).toBe('Stopped following this leader (positions kept)');
  });
  it('classify replays the contract: checked first for closes and opens, actual = leader id', () => {
    const close = classifyClose(order, { follower: { side: LONG, lots: 0n }, leaderAllowed: true, leaderDetached: true, marketLeader: 7, target: 0n, markValid: true, mark: 1n, maxSlippageBps: 100 });
    expect(close).toEqual({ reason: 'LeaderDetached', limit: 0n, actual: 7n });
    const open = classifyOpen({ ...order, orderType: 0 }, { leaderDetached: true, paused: true } as never);
    expect(open).toEqual({ reason: 'LeaderDetached', limit: 0n, actual: 7n });
  });
  it('ACTION_SET_LEADER_DETACHED = 11 with abi.encode(uint32, bool)', () => {
    expect(ACTION.SET_LEADER_DETACHED).toBe(11);
    const data = encodeLeaderDetached(7, true);
    expect(decodeAbiParameters([{ type: 'uint32' }, { type: 'bool' }], data)).toEqual([7, true]);
    expect(DETACH_GONE.actionKind).toBe(11);
  });
  it('a LeaderDetached Blocked alert says the contract refused it and positions are kept', () => {
    const a = alertFor(
      { id: 1, account: ACCOUNT, kind: 'Blocked', reason: 'LeaderDetached', leaderAccountId: 7, perpId: null, orderType: 2, txHash: '0x1', timestamp: 1 } as never,
      { markets: new Map(), owner: ACCOUNT, keepers: new Set() } as never,
    );
    expect(a).toMatchObject({ kind: 'blocked', title: 'Not copied: you stopped following leader #7' });
    expect(a!.body).toContain('positions kept');
  });
});
