// Owner-signed push registration (services/pushauth.ts): nobody can register their own notification key or push
// channel for someone else's owner address, and owner data is only ever sealed to keys registered that way.
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/db.js';
import { Bus } from '../src/services/bus.js';
import { PushService } from '../src/services/push.js';
import { channelHash, pushTypedData } from '../src/services/pushauth.js';
import { open, x25519PublicOf } from '../src/services/pushcrypto.js';
import { ShareService } from '../src/services/share.js';
import { nowSec, PUSH_CHAIN, signedRegister, signedUnregister } from './pushsig.js';

const log = pino({ level: 'silent' });
const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const attacker = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
const ACCT = '0x00000000000000000000000000000000000000a1';
const devicePriv = randomBytes(32);
const deviceKey = x25519PublicOf(devicePriv).toString('base64');
const attackerKey = x25519PublicOf(randomBytes(32)).toString('base64');
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } };
const FCM = `fcm-token-${'a'.repeat(140)}`;

let db: Db;
let svc: PushService;
const make = () => new PushService(db, { get: () => ({ owner: owner.address.toLowerCase(), teamRun: false }), isTeamRun: () => false } as never, new Bus(), { chainId: PUSH_CHAIN, enabled: false }, log);
beforeEach(() => {
  db = new Db(':memory:');
  svc = make();
});
const rows = () => db.all<{ channel: string; target: string; notify_public_key: string }>('SELECT channel, target, notify_public_key FROM push_subs');

describe('PushRegister typed data', () => {
  it('domain {Mirror Push, 1, chainId} without verifyingContract; channelHash commits to channel and target', () => {
    const td = pushTypedData(143, { primaryType: 'PushRegister', message: { owner: owner.address, notifyPublicKey: `0x${'11'.repeat(32)}`, channelHash: channelHash('fcm', 'x'), deadline: 1n } });
    expect(td.domain).toEqual({ name: 'Mirror Push', version: '1', chainId: 143 });
    expect(td.types.PushRegister!.map((f) => `${f.type} ${f.name}`).join(',')).toBe('address owner,bytes32 notifyPublicKey,bytes32 channelHash,uint256 deadline');
    expect(channelHash('webpush', 'a')).not.toBe(channelHash('fcm', 'a'));
    expect(channelHash('app', 'ignored')).toBe(channelHash('app', ''));
  });
});

describe('POST /v1/push/register requires the owner signature', () => {
  it('good owner signature: Web Push and in-app channels registered', async () => {
    const r = await svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey, webPush: SUB }));
    expect(r.channels).toEqual(['webpush', 'sse']);
    expect(rows().map((x) => x.channel).sort()).toEqual(['app', 'webpush']);
    const f = await svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey, fcmToken: FCM }));
    expect(f.channels).toEqual(['fcm', 'sse']);
  });
  it('no signature: refused (401) and nothing stored', async () => {
    await expect(svc.register({ owner: owner.address, notifyPublicKey: attackerKey, webPush: SUB })).rejects.toMatchObject({ statusCode: 401, code: 'signature_required' });
    expect(rows()).toHaveLength(0);
  });
  it('wrong signer: an attacker signing for the owner address is refused', async () => {
    const b = await signedRegister(attacker, { owner: owner.address, notifyPublicKey: attackerKey });
    await expect(svc.register(b)).rejects.toMatchObject({ statusCode: 401, code: 'not_owner' });
    expect(rows()).toHaveLength(0);
  });
  it('a valid owner signature cannot be reused for another key (the attacker swaps notifyPublicKey)', async () => {
    const b = await signedRegister(owner, { notifyPublicKey: deviceKey });
    await expect(svc.register({ ...b, notifyPublicKey: attackerKey })).rejects.toMatchObject({ code: 'not_owner' });
  });
  it('expired, too far ahead, other chain', async () => {
    await expect(svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey }, { deadline: BigInt(nowSec() - 1) }))).rejects.toMatchObject({ statusCode: 400, code: 'expired' });
    await expect(svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey }, { deadline: BigInt(nowSec() + 3700) }))).rejects.toMatchObject({ code: 'deadline_too_far' });
    await expect(svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey }, { chainId: 1 }))).rejects.toMatchObject({ code: 'not_owner' });
  });
  it('replay: the same approval is accepted once', async () => {
    const b = await signedRegister(owner, { notifyPublicKey: deviceKey, webPush: SUB });
    await svc.register(b);
    await expect(svc.register(b)).rejects.toMatchObject({ statusCode: 409, code: 'replayed' });
  });
  it('wrong channel: a signature for one endpoint or token does not register another', async () => {
    const b = await signedRegister(owner, { notifyPublicKey: deviceKey, webPush: SUB });
    await expect(svc.register({ ...b, webPush: { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/attacker' } })).rejects.toMatchObject({ code: 'not_owner' });
    const app = await signedRegister(owner, { notifyPublicKey: deviceKey });
    await expect(svc.register({ ...app, fcmToken: FCM })).rejects.toMatchObject({ code: 'not_owner' });
    const f = await signedRegister(owner, { notifyPublicKey: deviceKey, fcmToken: FCM });
    await expect(svc.register({ ...f, fcmToken: undefined, expoPushToken: 'ExponentPushToken[x]' })).rejects.toMatchObject({ code: 'not_owner' });
    expect(rows()).toHaveLength(0);
  });
  it('one remote channel per registration', async () => {
    const b = await signedRegister(owner, { notifyPublicKey: deviceKey, webPush: SUB });
    await expect(svc.register({ ...b, fcmToken: FCM })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('POST /v1/push/unregister is signed too', () => {
  it('owner removes a channel; attacker and replays cannot', async () => {
    await svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey, fcmToken: FCM }));
    const forged = await signedUnregister(attacker, 'fcm', FCM);
    await expect(svc.unregister({ ...forged, owner: owner.address })).rejects.toMatchObject({ code: 'not_owner' });
    await expect(svc.unregister({ owner: owner.address, channel: 'fcm', target: FCM })).rejects.toMatchObject({ code: 'signature_required' });
    const u = await signedUnregister(owner, 'fcm', FCM);
    await expect(svc.unregister({ ...u, target: 'other' })).rejects.toMatchObject({ code: 'not_owner' });
    expect(await svc.unregister(u)).toEqual({ ok: true, removed: 1 });
    await expect(svc.unregister(u)).rejects.toMatchObject({ code: 'replayed' });
    expect(rows().map((r) => r.channel)).toEqual(['app']);
  });
});

describe('unsigned keys are never used', () => {
  const legacy = (key: string) =>
    db.run("INSERT INTO push_subs (id, owner, channel, target, notify_public_key, created_ms, updated_ms) VALUES (?, ?, 'app', '', ?, 0, 0)", `app:legacy:${key.slice(0, 8)}`, owner.address.toLowerCase(), key);

  it('rows from before signatures were required are dropped at startup; unsigned rows are never delivered to', async () => {
    legacy(attackerKey);
    make();
    expect(rows()).toHaveLength(0);
    await svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey }));
    legacy(attackerKey); // written behind the service's back
    expect(svc.ownerKeys(owner.address)).toEqual([deviceKey]);
  });

  it('the sealed share list refuses an unsigned key and serves a signed one', async () => {
    db.run("INSERT INTO accounts (address, owner, salt, created_block, created_tx, perpl_account_id) VALUES (?, ?, '0x0', 1, '0x0', 77)", ACCT, owner.address.toLowerCase());
    const share = new ShareService({
      db, chainId: PUSH_CHAIN, readOwner: async () => owner.address, position: async () => ({ side: 0, lots: 0n, entryPNS: 0n, markPNS: 0n, depositCNS: 0n, pnlCNS: 0n }),
      level: async () => ({ side: 0, stopLossPNS: 0n, takeProfitPNS: 0n }), market: () => undefined, head: () => 1, alert: async () => {},
      ownerKeys: (o) => svc.ownerKeys(o), receipt: async () => { throw new Error('none'); }, publish: () => {}, hit: () => {},
      limits: { linkIpHourly: 1, linkHourly: 10, ipHourly: 20, maxOpenLinks: 3, maxPending: 20 },
    });
    legacy(attackerKey);
    await expect(share.ownerList(ACCT, attackerKey)).rejects.toMatchObject({ status: 403 });
    await expect(svc.register(await signedRegister(attacker, { owner: owner.address, notifyPublicKey: attackerKey }))).rejects.toMatchObject({ code: 'not_owner' });
    await expect(share.ownerList(ACCT, attackerKey)).rejects.toMatchObject({ status: 403 });
    await svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey }));
    const r = await share.ownerList(ACCT, deviceKey);
    expect(JSON.parse(open(devicePriv, r.sealed).toString()).account.toLowerCase()).toBe(ACCT);
  });
});

describe('shared vector with the app (shared/test-vectors/push-register-v1.json)', () => {
  it('channel hashes and digests', async () => {
    const { readFileSync } = await import('node:fs');
    const { hashTypedData } = await import('viem');
    const V = JSON.parse(readFileSync(new URL('../../shared/test-vectors/push-register-v1.json', import.meta.url), 'utf8'));
    for (const [k, h] of Object.entries(V.channelHashes)) {
      const i = k.indexOf(':');
      expect(channelHash(k.slice(0, i) as never, k.slice(i + 1))).toBe(h);
    }
    const reg = pushTypedData(V.chainId, { primaryType: 'PushRegister', message: { owner: V.owner, notifyPublicKey: V.notifyPublicKeyHex, channelHash: channelHash('fcm', 'tok'), deadline: BigInt(V.deadline) } });
    expect(hashTypedData(reg as never)).toBe(V.registerFcmTokDigest);
    const un = pushTypedData(V.chainId, { primaryType: 'PushUnregister', message: { owner: V.owner, channelHash: channelHash('webpush', 'https://fcm.googleapis.com/fcm/send/abc'), deadline: BigInt(V.deadline) } });
    expect(hashTypedData(un as never)).toBe(V.unregisterWebpushDigest);
  });
});
