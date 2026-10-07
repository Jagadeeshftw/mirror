import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import { perplExchangeAbi } from '../src/abi/PerplExchange.js';
import { decodePositionEvent } from '../src/services/watcher.js';
import { aggregate, maxDrawdownPct, score } from '../src/services/leaders.js';
import { nansenAdjust } from '../src/nansen/client.js';
import { encodeCloseMarket, encodeFollowData, encodeLevels, encodeOrders } from '../src/domain/encode.js';
import { mirrorAccountAbi } from '../src/abi/MirrorAccount.js';
import { decodeAbiParameters, decodeEventLog, encodeEventTopics as topicsOf, getAbiItem } from 'viem';
import { BLOCK_REASONS, STOP_KINDS } from '../src/domain/types.js';

function eventLog(name: string, values: Record<string, unknown>) {
  const item = perplExchangeAbi.find((e) => e.type === 'event' && e.name === name)! as { inputs: readonly { name: string; type: string }[] };
  const topics = encodeEventTopics({ abi: perplExchangeAbi, eventName: name as never }) as Hex[];
  const data = encodeAbiParameters(item.inputs as never, item.inputs.map((i) => values[i.name] ?? 0n) as never);
  return { topics, data };
}

describe('Perpl position event decoding', () => {
  it('PositionOpenedV2 carries leverage and lots', () => {
    const ev = decodePositionEvent(eventLog('PositionOpenedV2', { perpId: 1n, accountId: 4638n, positionType: 0, leverageHdths: 1000n, lotLNS: 1n, pricePNS: 853_439n, pnlCollateralizedCNS: 0n }));
    expect(ev).toMatchObject({ kind: 'open', accountId: 4638, perpId: 1, positionType: 0, leverageHdths: 1000, lotsAfter: 1n, increased: true });
  });
  it('PositionDecreased reports start/end lots and realized PnL', () => {
    const ev = decodePositionEvent(eventLog('PositionDecreased', { perpId: 20n, accountId: 9n, positionType: 1, startLotLNS: 10n, endLotLNS: 4n, deltaPnlCNS: -5n, fundingCNS: 0n }));
    expect(ev).toMatchObject({ kind: 'decrease', accountId: 9, positionType: 1, lotsBefore: 10n, lotsAfter: 4n, deltaPnlCNS: -5n, increased: false });
  });
  it('PositionLiquidated uses posAccountId', () => {
    const ev = decodePositionEvent(eventLog('PositionLiquidated', { perpId: 1n, posAccountId: 77n, positionType: 0, posLotLNS: 10n, liqLotLNS: 10n, deltaPnlCNS: -100n, fundingCNS: 0n, posAmountCNS: 0n, accAmountCNS: 0n, onOrderBook: false }));
    expect(ev).toMatchObject({ kind: 'liquidate', accountId: 77, lotsAfter: 0n });
  });
});

describe('leader ranking math', () => {
  const row = (kind: string, pnl: string | null, ts: number, lev: number | null = null) => ({ account_id: 1, perp_id: 1, kind, ts, block: ts, tx_hash: '0x', position_type: 0, lots_after: null, lots_before: null, price: null, delta_pnl: pnl, leverage: lev });
  it('aggregates realized PnL, win rate and leverage', () => {
    const s = aggregate([row('open', null, 1, 500), row('decrease', '10', 2), row('close', '-4', 3), row('open', null, 4, 300)]).get(1)!;
    expect(s.pnlCNS).toBe(6n);
    expect(s.closes).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.levSum / s.levN).toBe(400);
  });
  it('max drawdown on the cumulative curve', () => {
    expect(maxDrawdownPct([{ pnlCNS: 100n }, { pnlCNS: -100n }, { pnlCNS: 50n }], 1000n)).toBeCloseTo(18.18, 1);
    expect(score(10, 20, 0.6, 15, 0)).toBe(Math.round((10 - 10 + 2 + 4) * 100) / 100);
  });
  it('Nansen adjustment rewards positive labels and flags risky ones', () => {
    expect(nansenAdjust({ address: '0x', labels: ['Smart Trader'], monad: null, crossVenue: null, fetchedMs: 0 }).bonus).toBe(5);
    expect(nansenAdjust({ address: '0x', labels: ['Exploiter'], monad: null, crossVenue: null, fetchedMs: 0 })).toEqual({ bonus: -50, flags: ['nansen_risk_label'] });
  });
});

describe('ABI encoding of owner action payloads', () => {
  const o = { leaderAccountId: 1, perpId: 1, orderType: 0, lotLNS: 2n, pricePNS: 100n, leverageHdths: 300, maxMatches: 100, leaderRef: `0x${'00'.repeat(32)}` as Hex, leaderFillPNS: 99n };
  const policy = {
    maxLeverageHdths: 300, maxSlippageBps: 80, dailyLossBps: 0, drawdownBps: 0, expiry: 1, maxEntryDeviationBps: 50, stopSlippageBps: 150, flattenOnStop: true, maxBuilderFeePer100K: 20,
    leaders: [{ accountId: 1, ratioBps: 100, budgetCNS: 5_000_000n, lossStopBps: 2_000 }], markets: [{ perpId: 1, maxNotionalCNS: 10n }],
  };
  it('encodes MirrorOrder[] with leaderFillPNS (9 words per order)', () => {
    expect(encodeOrders([o]).length).toBe(2 + 64 * (2 + 9));
  });
  it('round-trips (Policy, MirrorOrder[]) with the new policy and leader fields', () => {
    const item = getAbiItem({ abi: mirrorAccountAbi, name: 'follow' });
    const [p, orders] = decodeAbiParameters(item.inputs, encodeFollowData(policy, [o]));
    expect(p).toMatchObject({ maxEntryDeviationBps: 50, stopSlippageBps: 150, flattenOnStop: true, maxBuilderFeePer100K: 20, leaders: [{ accountId: 1, ratioBps: 100, budgetCNS: 5_000_000n, lossStopBps: 2_000 }] });
    expect(orders[0]).toMatchObject({ leaderFillPNS: 99n });
  });
  it('encodes ACTION_SET_LEVELS and ACTION_CLOSE_MARKET payloads', () => {
    const lv = { perpId: 1, side: 0 as const, stopLossPNS: 900n, takeProfitPNS: 1100n, slippageBps: 100 };
    const [levels] = decodeAbiParameters(getAbiItem({ abi: mirrorAccountAbi, name: 'setLevels' }).inputs, encodeLevels([lv]));
    expect(levels[0]).toMatchObject(lv);
    expect(decodeAbiParameters([{ type: 'uint32' }, { type: 'uint16' }], encodeCloseMarket(16, 150))).toEqual([16, 150]);
  });
  it('enums match the contract (BlockReason appended to 22, StopKind)', () => {
    expect(BLOCK_REASONS.length).toBe(23);
    expect(BLOCK_REASONS.indexOf('LeaderDetached')).toBe(22);
    expect(BLOCK_REASONS.indexOf('BuilderFeeTooHigh')).toBe(21);
    expect(BLOCK_REASONS.indexOf('EntryTooFar')).toBe(15);
    expect(BLOCK_REASONS.indexOf('CloseBelowTarget')).toBe(20);
    expect(STOP_KINDS).toEqual(['DailyLoss', 'Drawdown', 'LeaderLoss', 'StopLoss', 'TakeProfit']);
  });
  it('decodes Mirrored with its CopyProof (builderFeeCNS last)', () => {
    const item = getAbiItem({ abi: mirrorAccountAbi, name: 'Mirrored' });
    const keeper = '0x0000000000000000000000000000000000000001';
    const topics = topicsOf({ abi: mirrorAccountAbi, eventName: 'Mirrored', args: { keeper, leaderAccountId: 7, perpId: 1 } }) as Hex[];
    const nonIndexed = item.inputs.filter((i) => !('indexed' in i && i.indexed));
    const proof = { leaderFillPNS: 1n, leaderEntryPNS: 2n, markPNS: 3n, fillPNS: 4n, entryDeviationBps: -5, builderFeeCNS: 601n };
    const data = encodeAbiParameters(nonIndexed, [0, 1n, 100n, 300, 0n, 1n, `0x${'ab'.repeat(32)}`, proof] as never);
    const ev = decodeEventLog({ abi: mirrorAccountAbi, data, topics: topics as [Hex, ...Hex[]] });
    expect(ev.eventName).toBe('Mirrored');
    expect((ev.args as { proof: typeof proof }).proof).toEqual(proof);
    const proofType = (nonIndexed.at(-1) as unknown as { components: { name: string }[] }).components.map((c) => c.name);
    expect(proofType).toEqual(['leaderFillPNS', 'leaderEntryPNS', 'markPNS', 'fillPNS', 'entryDeviationBps', 'builderFeeCNS']);
  });
});
