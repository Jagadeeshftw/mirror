import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.js';
import { alertFor, lowEquityAlert, type FeedItem } from '../src/services/alerts.js';
import { Bus } from '../src/services/bus.js';
import { EXPO_TOKEN, GENERIC, PushService, type WebPushSender } from '../src/services/push.js';
import { open, seal, x25519PublicOf, type PushEnvelope } from '../src/services/pushcrypto.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(join(here, '../../shared/test-vectors/push-envelope-v1.json'), 'utf8'));
const b64 = (s: string) => Buffer.from(s, 'base64');
const log = pino({ level: 'silent' });

describe('alert envelope v1 (shared test vector with the app)', () => {
  it('seals to exactly the vector envelope with the fixed ephemeral key and nonce', () => {
    const env = seal(b64(V.recipientPublicKey), Buffer.from(V.plaintext), { ephemeralPrivate: b64(V.ephemeralPrivateKey), nonce: b64(V.nonce) });
    expect(env).toEqual(V.envelope);
  });
  it('the recipient key is the X25519 public key of the vector private key', () => {
    expect(x25519PublicOf(b64(V.recipientPrivateKey)).toString('base64')).toBe(V.recipientPublicKey);
  });
  it('opens the vector envelope; tampering or another version fails', () => {
    expect(open(b64(V.recipientPrivateKey), V.envelope).toString()).toBe(V.plaintext);
    const ct = b64(V.envelope.ct);
    ct[0]! ^= 1;
    expect(() => open(b64(V.recipientPrivateKey), { ...V.envelope, ct: ct.toString('base64') })).toThrow();
    expect(() => open(b64(V.recipientPrivateKey), { ...V.envelope, v: 2 } as never)).toThrow(/version/);
  });
  it('fresh envelopes use a new ephemeral key and nonce each time', () => {
    const a = seal(b64(V.recipientPublicKey), Buffer.from('x'));
    const b = seal(b64(V.recipientPublicKey), Buffer.from('x'));
    expect(a.epk).not.toBe(b.epk);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

const OWNER = '0x00000000000000000000000000000000000000a0';
const ACCT = '0x00000000000000000000000000000000000000a1';
const TEAM = '0x00000000000000000000000000000000000000c1';
const KEEPER = '0x00000000000000000000000000000000000000e1';
const BTC = { perpId: 1, symbol: 'BTC', lotDecimals: 5, priceDecimals: 1 };
const ctx = { markets: new Map([[1, BTC]]), owner: OWNER, keepers: new Set([KEEPER]) };
const nowSec = () => Math.floor(Date.now() / 1000);
const item = (kind: string, x: Partial<FeedItem> = {}): FeedItem => ({
  id: Math.floor(Math.random() * 1e9), account: ACCT, kind, txHash: '0xabc', timestamp: nowSec(), leaderAccountId: 4638, perpId: 1, orderType: 0,
  lotLNS: '1000', pricePNS: '1000000', reason: null, limit: null, actual: null, keeper: null, amount: null, proof: null, data: null, ...x,
});

describe('trigger selection', () => {
  it('Mirrored open: the copy with size, notional and the Mirror fee', () => {
    const p = alertFor(item('Mirrored', { proof: { fillPNS: '1000000', builderFeeCNS: '200000' } }), ctx)!;
    expect(p).toMatchObject({ kind: 'copied', title: 'Copied BTC long' });
    expect(p.body).toBe('0.01000 BTC at 100,000.0 · 1,000.00 AUSD · Mirror fee 0.2000 AUSD · leader #4638');
  });
  it('Mirrored close: no fee line, realised PnL when known', () => {
    const p = alertFor(item('Mirrored', { orderType: 3, realisedPnlCNS: '-1500000' }), ctx)!;
    expect(p).toMatchObject({ kind: 'closed', title: 'Closed BTC short' });
    expect(p.body).toContain('realised -1.50 AUSD');
    expect(p.body).not.toContain('fee');
    expect(alertFor(item('Mirrored', { orderType: 2, realisedPnlCNS: '-1200' }), ctx)!.body).toContain('realised 0.00 AUSD');
  });
  it('Blocked: the rule and its numbers', () => {
    const p = alertFor(item('Blocked', { reason: 'LeverageTooHigh', limit: '500', actual: '1000' }), ctx)!;
    expect(p).toMatchObject({ kind: 'blocked', title: 'Blocked by your rule: Max leverage' });
    expect(p.body).toContain('leader 10.0x, your max 5.0x');
    const n = alertFor(item('Blocked', { reason: 'ExceedsMaxNotional', limit: '6000000', actual: '9500000' }), ctx)!;
    expect(n.body).toContain('copy 9.50 AUSD, your max 6.00 AUSD');
    const e = alertFor(item('Blocked', { reason: 'EntryTooFar', limit: '1010000', actual: '1030000', data: { leaderFillPNS: '1000000' } }), ctx)!;
    expect(e.body).toContain("price moved 3.0% past the leader's entry, your limit 1.0%");
  });
  it('a loss-stop Blocked is a stop hit, with the equity numbers', () => {
    const p = alertFor(item('Blocked', { reason: 'DailyLossStop', limit: '18000000', actual: '17500000' }), ctx)!;
    expect(p).toMatchObject({ kind: 'stop', title: 'Daily loss stop hit' });
    expect(p.body).toContain('Equity 17.50 AUSD is under 18.00 AUSD');
  });
  it('StopTriggered says which stop and who triggered it', () => {
    const by = (keeper: string) => alertFor(item('StopTriggered', { keeper, reason: 'StopLoss', limit: '950000', data: { kind: 'StopLoss', scope: 1, closed: '1' } }), ctx)!;
    expect(by(KEEPER)).toMatchObject({ kind: 'stop', title: 'Stop-loss hit: BTC at 95,000.0' });
    expect(by(KEEPER).body).toContain("Triggered by Mirror's keeper · 1 position closed");
    expect(by(OWNER).body).toContain('Triggered by you');
    expect(by('0x00000000000000000000000000000000000000f9').body).toContain('(anyone may trigger it)');
    const d = alertFor(item('StopTriggered', { keeper: KEEPER, limit: '15000000', actual: '14000000', data: { kind: 'Drawdown', scope: 0, closed: '2' } }), ctx)!;
    expect(d.title).toBe('Account loss stop triggered');
  });
  it('LeaderStopped, deposit and withdrawal', () => {
    expect(alertFor(item('LeaderStopped', { limit: '2000000', actual: '-2100000' }), ctx)).toMatchObject({ kind: 'leader_stop', title: 'Stopped copying leader #4638' });
    expect(alertFor(item('Deposited', { amount: '20000000' }), ctx)).toMatchObject({ kind: 'deposit', body: '20.00 AUSD added to your follow account' });
    expect(alertFor(item('Withdrawn', { amount: '5000000', data: { to: OWNER } }), ctx)!.body).toBe('5.00 AUSD sent to 0x0000…00a0');
  });
  it('policy, level, pause and shrink events are not alerted', () => {
    for (const k of ['PolicyUpdated', 'LevelSet', 'Paused', 'PerplAccountCreated', 'EngineShrunk', 'MarketClosed']) expect(alertFor(item(k), ctx)).toBeNull();
  });
  it('low equity under the threshold, once per day by eventId', () => {
    expect(lowEquityAlert(ACCT, 12_000_000n, 20_000_000n, 50)).toBeNull();
    const p = lowEquityAlert(ACCT, 9_000_000n, 20_000_000n, 50, Date.UTC(2026, 9, 7))!;
    expect(p).toMatchObject({ kind: 'low_equity', eventId: `low-equity:${ACCT}:2026-10-07` });
    expect(p.body).toContain('45.0% of the 20.00 AUSD');
  });
  it('validates Expo tokens', () => {
    expect(EXPO_TOKEN.test('ExponentPushToken[abcDEF123]')).toBe(true);
    expect(EXPO_TOKEN.test('unavailable:no-fcm-config')).toBe(false);
  });
});

const DEVICE_PRIV = b64(V.recipientPrivateKey);
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } };

function setup(opts: { status?: number; ratePerMin?: number } = {}) {
  const db = new Db(':memory:');
  const bus = new Bus();
  const accounts: Record<string, { owner: string; teamRun: boolean }> = { [ACCT]: { owner: OWNER, teamRun: false }, [TEAM]: { owner: OWNER, teamRun: true } };
  const registry = { get: (a: string) => accounts[a.toLowerCase()], isTeamRun: (a: string) => !!accounts[a.toLowerCase()]?.teamRun } as never;
  const web: Array<{ endpoint: string; body: string; headers: Record<string, string> }> = [];
  const webPush: WebPushSender = async (sub, body, headers) => (web.push({ endpoint: sub.endpoint, body, headers }), { statusCode: opts.status ?? 201 });
  const expo: unknown[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    const msgs = JSON.parse(String(init.body));
    expo.push(...msgs);
    return new Response(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }));
  }) as typeof fetch;
  const svc = new PushService(db, registry, bus, { enabled: true, fetchImpl, webPush, vapidPublicKey: 'BPub', ratePerMin: opts.ratePerMin, markets: [BTC], keepers: () => [KEEPER] }, log);
  const sse: PushEnvelope[] = [];
  bus.subscribe(ACCT, (e) => e.type === 'push' && sse.push(e as unknown as PushEnvelope));
  svc.register({ owner: OWNER, notifyPublicKey: V.recipientPublicKey, webPush: SUB, expoPushToken: 'ExponentPushToken[dev1]' });
  return { db, bus, svc, web, expo, sse };
}

describe('PushService fan-out', () => {
  it('seals once per device key and relays only ciphertext on SSE, Web Push and Expo', async () => {
    const { svc, web, expo, sse } = setup();
    const r = await svc.notify(ACCT, item('Mirrored', { proof: { fillPNS: '1000000', builderFeeCNS: '200000' } }));
    expect(r).toMatchObject({ sse: 1, webpush: 1, expo: 1 });
    const wenv = JSON.parse(web[0]!.body).mirror as PushEnvelope;
    expect(JSON.parse(open(DEVICE_PRIV, wenv).toString())).toMatchObject({ kind: 'copied', title: 'Copied BTC long' });
    expect(JSON.parse(open(DEVICE_PRIV, sse[0]!).toString()).account).toBe(ACCT);
    const m = expo[0] as { title: string; body: string; data: { mirror: string } };
    expect([m.title, m.body]).toEqual([GENERIC.title, GENERIC.body]);
    for (const wire of [web[0]!.body, JSON.stringify(expo[0])]) {
      expect(wire).not.toMatch(/BTC|AUSD|0x0000/);
    }
  });
  it('team-run accounts and the demo channel never alert', async () => {
    const { svc, bus, web, sse } = setup();
    expect((await svc.notify(TEAM, item('Mirrored', { account: TEAM }))).skipped).toBe('team run');
    svc.start();
    bus.publish('demo', { type: 'feed', item: item('Mirrored') });
    await new Promise((r) => setTimeout(r, 10));
    expect(web.length + sse.length).toBe(0);
  });
  it('skips old events (backfill) and duplicates', async () => {
    const { svc } = setup();
    expect((await svc.notify(ACCT, item('Deposited', { timestamp: nowSec() - 3600 }))).skipped).toBe('old event');
    const ev = item('Deposited', { amount: '1' });
    expect((await svc.notify(ACCT, ev)).webpush).toBe(1);
    expect((await svc.notify(ACCT, ev)).skipped).toBe('duplicate');
  });
  it('rate-limits per owner', async () => {
    const { svc } = setup({ ratePerMin: 2 });
    const out = [];
    for (let i = 0; i < 3; i++) out.push(await svc.notify(ACCT, item('Deposited')));
    expect(out.map((o) => o.skipped ?? 'sent')).toEqual(['sent', 'sent', 'rate limited']);
  });
  it('removes a Web Push subscription on 410 Gone', async () => {
    const { svc, db } = setup({ status: 410 });
    await svc.notify(ACCT, item('Deposited'));
    expect(db.all("SELECT * FROM push_subs WHERE channel = 'webpush'")).toHaveLength(0);
    expect(db.all("SELECT * FROM push_subs WHERE channel = 'app'")).toHaveLength(1);
  });
  it('registration: unknown push hosts refused; devices without remote push keep the in-app channel', () => {
    const { svc } = setup();
    expect(() => svc.register({ owner: OWNER, notifyPublicKey: V.recipientPublicKey, webPush: { ...SUB, endpoint: 'http://169.254.169.254/x' } })).toThrow(/push service/);
    expect(svc.register({ owner: OWNER, notifyPublicKey: V.recipientPublicKey, expoPushToken: 'unavailable:no-fcm-config' }).channels).toEqual(['sse']);
    expect(() => svc.register({ owner: OWNER, notifyPublicKey: 'short' })).toThrow(/32-byte/);
  });
});
