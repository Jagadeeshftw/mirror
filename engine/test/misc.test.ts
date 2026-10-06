import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import { perplExchangeAbi } from '../src/abi/PerplExchange.js';
import { decodePositionEvent } from '../src/services/watcher.js';
import { encryptForDevice, EXPO_TOKEN } from '../src/services/push.js';
import { aggregate, maxDrawdownPct, score } from '../src/services/leaders.js';
import { nansenAdjust } from '../src/nansen/client.js';
import { encodeFollowData, encodeOrders } from '../src/domain/encode.js';

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

describe('push payload encryption', () => {
  it('round-trips with the device private key', () => {
    const device = generateKeyPairSync('x25519');
    const pub = (device.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64url');
    const enc = encryptForDevice({ kind: 'Blocked', reason: 'LeverageTooHigh' }, pub);
    const epk = Buffer.from(enc.epk, 'base64url');
    const shared = diffieHellman({ privateKey: device.privateKey, publicKey: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), epk]), format: 'der', type: 'spki' }) });
    const key = Buffer.from(hkdfSync('sha256', shared, epk, Buffer.from('mirror-push-v1'), 32));
    const blob = Buffer.from(enc.ct, 'base64url');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64url'));
    d.setAuthTag(blob.subarray(-16));
    const out = JSON.parse(Buffer.concat([d.update(blob.subarray(0, -16)), d.final()]).toString());
    expect(out).toEqual({ kind: 'Blocked', reason: 'LeverageTooHigh' });
  });
  it('validates Expo tokens', () => {
    expect(EXPO_TOKEN.test('ExponentPushToken[abcDEF123]')).toBe(true);
    expect(EXPO_TOKEN.test('nope')).toBe(false);
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

describe('ABI encoding of match-now payloads', () => {
  it('encodes MirrorOrder[] and (Policy, MirrorOrder[])', () => {
    const o = { leaderAccountId: 1, perpId: 1, orderType: 0, lotLNS: 2n, pricePNS: 100n, leverageHdths: 300, maxMatches: 100, leaderRef: `0x${'00'.repeat(32)}` as Hex };
    expect(encodeOrders([o]).length).toBe(2 + 64 * (2 + 8));
    const data = encodeFollowData({ maxLeverageHdths: 300, maxSlippageBps: 80, dailyLossBps: 0, drawdownBps: 0, expiry: 1, leaders: [{ accountId: 1, ratioBps: 100 }], markets: [{ perpId: 1, maxNotionalCNS: 10n }] }, [o]);
    expect(data.startsWith('0x')).toBe(true);
  });
});
