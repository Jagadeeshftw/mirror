import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { encodeAbiParameters, encodeEventTopics, type AbiParameter, type Address, type Hex, type PublicClient } from 'viem';
import { mirrorAccountAbi } from '../src/abi/MirrorAccount.js';
import { Db } from '../src/db.js';
import { Bus } from '../src/services/bus.js';
import { Registry } from '../src/services/registry.js';
import { Views } from '../src/services/views.js';
import { nullRegistry } from '../src/services/registry.js';
import { leaderFill, copyRealised } from '../src/services/copyfacts.js';
import type { ChainLog, ChainStreams } from '../src/chain/streams.js';
import type { Reads } from '../src/chain/reads.js';
import type { MarketData } from '../src/perpl/market.js';

const log = pino({ level: 'silent' });

/** Topics and data of a MirrorAccount event (indexed args in topics, the rest ABI-encoded in data). */
function encodeEventLog(p: { abi: typeof mirrorAccountAbi; eventName: string; args: Record<string, unknown> }): { topics: Hex[]; data: Hex } {
  const item = p.abi.find((e) => e.type === 'event' && e.name === p.eventName) as unknown as { inputs: Array<AbiParameter & { indexed?: boolean }> };
  const topics = encodeEventTopics({ abi: p.abi, eventName: p.eventName, args: p.args } as never) as Hex[];
  const rest = item.inputs.filter((i) => !i.indexed);
  return { topics, data: encodeAbiParameters(rest, rest.map((i) => p.args[i.name!]) as never) };
}
const ACCOUNT = '0x00000000000000000000000000000000000000a1' as Address;
const KEEPER = '0x00000000000000000000000000000000000000ee' as Address;
const LEADER = 7;
const FOLLOWER_PERPL = 55;
const LEADER_TX = `0x${'11'.repeat(32)}` as Hex;
const CLOSE_TX = `0x${'22'.repeat(32)}` as Hex;
const OPEN_COPY_TX = `0x${'33'.repeat(32)}` as Hex;
const BLOCKED_TX = `0x${'44'.repeat(32)}` as Hex;

function setup(client: Partial<PublicClient> = {}) {
  const db = new Db(':memory:');
  db.run(`INSERT INTO accounts (address, owner, salt, created_block, created_tx, created_ts, perpl_account_id) VALUES (?, ?, '0x0', 1, '0x', 1000, ?)`, ACCOUNT.toLowerCase(), ACCOUNT.toLowerCase(), FOLLOWER_PERPL);
  const reg = new Registry(db, client as PublicClient, { head: 0 } as unknown as ChainStreams, '0x00000000000000000000000000000000000000f0', 0, new Set(), 'https://x/tx/', new Bus(), log);
  reg.refresh(ACCOUNT.toLowerCase());
  // The leader opened 3 lots at 12x in block 100 (watcher: leader_fills + perpl_events).
  db.run(`INSERT INTO leader_fills (leader_ref, leader_id, perp_id, kind, block, observed_ms, lots_after, leverage, price) VALUES (?, ?, 1, 'open', 100, 0, '3', 1200, '1000')`, LEADER_TX, LEADER);
  db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, lots_before, leverage) VALUES (?, 0, 100, 1, ?, 1, 'open', 0, '3', '0', 1200)`, LEADER_TX, LEADER);
  return { db, reg };
}

const chainLog = (tx: Hex, block: number, ev: { topics: Hex[]; data: Hex }): ChainLog => ({
  address: ACCOUNT, topics: ev.topics, data: ev.data, blockNumber: block, blockHash: `0x${'00'.repeat(32)}`, blockTimestamp: 2000, transactionHash: tx, logIndex: 3,
  commitState: undefined, removed: false, observedMs: 0,
});

const proof = { leaderFillPNS: 1000n, leaderEntryPNS: 0n, markPNS: 1000n, fillPNS: 0n, entryDeviationBps: 0, builderFeeCNS: 0n };
const mirrored = (orderType: number, ref: Hex) =>
  encodeEventLog({ abi: mirrorAccountAbi, eventName: 'Mirrored', args: { keeper: KEEPER, leaderAccountId: LEADER, perpId: 1, orderType, lotLNS: 1n, pricePNS: 1000n, leverageHdths: 300, lotsBefore: orderType >= 2 ? 1n : 0n, lotsAfter: orderType >= 2 ? 0n : 1n, leaderRef: ref, proof } });

afterEach(() => vi.useRealTimers());

describe('feed items: leader block, latency in blocks, leader order, realised PnL', () => {
  it('Blocked carries leaderBlock, latencyBlocks and the leader lots / leverage of the triggering fill', async () => {
    const { db, reg } = setup();
    const items: unknown[] = [];
    reg.onFeed = (j) => items.push(j);
    const ev = encodeEventLog({ abi: mirrorAccountAbi, eventName: 'Blocked', args: { keeper: KEEPER, leaderAccountId: LEADER, perpId: 1, reason: 1, orderType: 0, lotLNS: 1n, limit: 500n, actual: 1200n, leaderRef: LEADER_TX, leaderFillPNS: 1000n, markPNS: 1000n } });
    await reg.handle(chainLog(BLOCKED_TX, 103, ev));
    expect(items[0]).toMatchObject({ kind: 'Blocked', leaderBlock: 100, latencyBlocks: 3, leaderLotLNS: '3', leaderLeverageHdths: 1200, realisedPnlCNS: null });
    const page = new Views(db, {} as Reads, {} as MarketData, nullRegistry(new Set()), undefined, 'https://x/tx/').feed(ACCOUNT);
    expect(page.items[0]).toMatchObject({ leaderBlock: 100, latencyBlocks: 3, leaderLotLNS: '3', leaderLeverageHdths: 1200 });
  });

  it('Mirrored open: leader block and latency; no realised PnL, no leader order fields', async () => {
    const { reg } = setup();
    const items: Array<Record<string, unknown>> = [];
    reg.onFeed = (j) => items.push(j as never);
    await reg.handle(chainLog(OPEN_COPY_TX, 102, mirrored(0, LEADER_TX)));
    expect(items[0]).toMatchObject({ kind: 'Mirrored', leaderBlock: 100, latencyBlocks: 2, realisedPnlCNS: null, leaderLotLNS: null });
  });

  it("Mirrored close: realised PnL from the follower's Perpl close event in the copy transaction", async () => {
    const { db, reg } = setup();
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, delta_pnl) VALUES (?, 1, 104, 1, ?, 1, 'close', 0, '0', '-1234')`, CLOSE_TX, FOLLOWER_PERPL);
    const items: Array<Record<string, unknown>> = [];
    reg.onFeed = (j) => items.push(j as never);
    await reg.handle(chainLog(CLOSE_TX, 104, mirrored(2, LEADER_TX)));
    expect(items[0]).toMatchObject({ realisedPnlCNS: '-1234', leaderBlock: 100, latencyBlocks: 4 });
    expect(copyRealised(db, CLOSE_TX, FOLLOWER_PERPL, 1)).toBe('-1234');
    expect(copyRealised(db, CLOSE_TX, 999, 1)).toBeNull();
  });

  it('Mirrored close without a stored Perpl event falls back to the leaderRealizedCNS change over the copy block', async () => {
    vi.useFakeTimers();
    const readContract = vi.fn(async (a: { blockNumber: bigint }) => (a.blockNumber === 104n ? 5_000n : 6_500n));
    const { db, reg } = setup({ readContract: readContract as never });
    await reg.handle(chainLog(CLOSE_TX, 104, mirrored(2, LEADER_TX)));
    expect(db.get<{ realised_pnl_cns: string | null }>('SELECT realised_pnl_cns FROM feed')!.realised_pnl_cns).toBeNull();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(db.get<{ realised_pnl_cns: string }>('SELECT realised_pnl_cns FROM feed')!.realised_pnl_cns).toBe('-1500');
  });

  it('the feed fills facts that arrived after the item was recorded', async () => {
    const { db, reg } = setup();
    await reg.handle(chainLog(CLOSE_TX, 104, mirrored(2, `0x${'99'.repeat(32)}`)));
    db.run(`INSERT INTO leader_fills (leader_ref, leader_id, perp_id, kind, block, observed_ms) VALUES (?, ?, 1, 'close', 101, 0)`, `0x${'99'.repeat(32)}`, LEADER);
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, delta_pnl) VALUES (?, 1, 104, 1, ?, 1, 'close', 0, '0', '777')`, CLOSE_TX, FOLLOWER_PERPL);
    const views = new Views(db, {} as Reads, {} as MarketData, nullRegistry(new Set()), undefined, 'https://x/tx/');
    expect(views.feed(ACCOUNT).items[0]).toMatchObject({ leaderBlock: 101, latencyBlocks: 3, realisedPnlCNS: '777' });
    expect(db.get<{ realised_pnl_cns: string }>('SELECT realised_pnl_cns FROM feed')!.realised_pnl_cns).toBe('777');
  });

  it('match-now items have no leader block; leaderFill sums traded lots (increase, invert)', async () => {
    const { db } = setup();
    const tx = `0x${'55'.repeat(32)}`;
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, lots_before, leverage) VALUES (?, 0, 200, 1, ?, 1, 'increase', 0, '5', '3', 800)`, tx, LEADER);
    expect(leaderFill(db, tx, LEADER, 1)).toEqual({ block: 200, lots: '2', leverageHdths: 800 });
    db.run(`INSERT INTO perpl_events (tx_hash, log_index, block, ts, account_id, perp_id, kind, position_type, lots_after, lots_before) VALUES (?, 0, 201, 1, ?, 1, 'invert', 1, '2', '5')`, `0x${'66'.repeat(32)}`, LEADER);
    expect(leaderFill(db, `0x${'66'.repeat(32)}`, LEADER, 1)).toMatchObject({ lots: '7', leverageHdths: null });
    expect(leaderFill(db, `0x${'77'.repeat(32)}`, LEADER, 1)).toBeUndefined();
  });

  it('copies, deposits and withdrawals after the backfill call onAccountActivity (equity snapshots)', async () => {
    const { reg } = setup();
    const seen: string[] = [];
    reg.onAccountActivity = (_a, kind) => seen.push(kind);
    const dep = encodeEventLog({ abi: mirrorAccountAbi, eventName: 'Deposited', args: { from: ACCOUNT, amount: 10n, netDeposits: 10n } });
    await reg.handle(chainLog(`0x${'a1'.repeat(32)}`, 50, dep));
    expect(seen).toEqual([]); // backfill: historical events never snapshot today's equity
    reg.backfilled = true;
    await reg.handle(chainLog(`0x${'a2'.repeat(32)}`, 51, dep));
    await reg.handle(chainLog(OPEN_COPY_TX, 102, mirrored(0, LEADER_TX)));
    await reg.handle(chainLog(OPEN_COPY_TX, 102, mirrored(0, LEADER_TX))); // duplicate: no second call
    expect(seen).toEqual(['Deposited', 'Mirrored']);
  });
});
