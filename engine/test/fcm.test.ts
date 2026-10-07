// Android alerts through FCM HTTP v1 against a fake FCM server. The service account here is a throwaway RSA key made
// in the test; the real Firebase key is never read by tests.
import { createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/db.js';
import { Bus } from '../src/services/bus.js';
import { FCM_SCOPE, fcmFromEnv, fcmSendUrl, FcmSender, GOOGLE_TOKEN_URL, parseServiceAccount, serviceAccountJwt, type ServiceAccount } from '../src/services/fcm.js';
import { GENERIC, PushService } from '../src/services/push.js';
import { open, x25519PublicOf, type PushEnvelope } from '../src/services/pushcrypto.js';
import { nowSec, PUSH_CHAIN, signedRegister } from './pushsig.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA: ServiceAccount = { client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), project_id: 'mirror-test' };
const b64json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());

describe('service account and token minting', () => {
  it('JWT RS256 with the firebase.messaging scope, verifiable with the service account public key', () => {
    const jwt = serviceAccountJwt(SA, 1_700_000_000);
    const [h, c, sig] = jwt.split('.');
    expect(b64json(h!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(b64json(c!)).toEqual({ iss: SA.client_email, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);
  });
  it('parse errors never echo key material', () => {
    expect(() => parseServiceAccount('{"private_key":"-----BEGIN PRIVATE KEY-----SECRETSTUFF"}')).toThrow(/must hold/);
    try {
      parseServiceAccount('{"private_key":"-----BEGIN PRIVATE KEY-----SECRETSTUFF"}');
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/SECRET/);
    }
    expect(() => fcmFromEnv({ NETWORK: 'mainnet', FCM_SERVICE_ACCOUNT_PATH: '/nonexistent/key.json' })).toThrow('FCM_SERVICE_ACCOUNT_PATH is not readable');
  });
  it('FCM_ENDPOINT_OVERRIDE is refused unless NETWORK=localnet; the real send URL names the project', () => {
    const env = { FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(SA), FCM_ENDPOINT_OVERRIDE: 'http://127.0.0.1:1/send' };
    expect(() => fcmFromEnv({ ...env, NETWORK: 'mainnet' })).toThrow(/only allowed with NETWORK=localnet/);
    expect(fcmFromEnv({ ...env, NETWORK: 'localnet' })!.tokenUrl).toBe('http://127.0.0.1:1/token');
    expect(fcmFromEnv({ NETWORK: 'mainnet', FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...SA, project_id: 'mirror-c8061' }) })!.sendUrl).toBe('https://fcm.googleapis.com/v1/projects/mirror-c8061/messages:send');
    expect(fcmSendUrl('p')).toMatch(/\/v1\/projects\/p\/messages:send$/);
    expect(fcmFromEnv({ NETWORK: 'mainnet' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------- fake FCM server

type Req = { path: string; headers: IncomingMessage['headers']; body: string };
const reqs: Req[] = [];
let respond: (r: Req) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
let mints = 0;
let base = '';
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const r = { path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() };
    reqs.push(r);
    if (r.path === '/token') {
      mints++;
      const assertion = new URLSearchParams(r.body).get('assertion') ?? '';
      const [h, c, s] = assertion.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s ?? '', 'base64url'));
      res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ok ? { access_token: `tok-${mints}`, expires_in: 3599, token_type: 'Bearer' } : { error: 'invalid_grant' }));
    }
    const out = respond(r);
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  reqs.length = 0;
  mints = 0;
  respond = () => ({ status: 200, body: { name: 'projects/mirror-test/messages/1' } });
});

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ACCT = '0x00000000000000000000000000000000000000a1';
const devicePriv = randomBytes(32);
const deviceKey = x25519PublicOf(devicePriv).toString('base64');
const TOKEN = `dXk3:APA91b${'x'.repeat(150)}`;
const sends = () => reqs.filter((r) => r.path === '/send');

async function setup(now?: () => number) {
  const db = new Db(':memory:');
  const fcm = now ? new FcmSender({ serviceAccount: SA, endpointOverride: `${base}/send`, now }) : fcmFromEnv({ NETWORK: 'localnet', FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(SA), FCM_ENDPOINT_OVERRIDE: `${base}/send` })!;
  const registry = { get: () => ({ owner: owner.address.toLowerCase(), teamRun: false }), isTeamRun: () => false } as never;
  const svc = new PushService(db, registry, new Bus(), { chainId: PUSH_CHAIN, enabled: false, fcm, ratePerMin: 100, now }, pino({ level: 'silent' }));
  await svc.register(await signedRegister(owner, { notifyPublicKey: deviceKey, fcmToken: TOKEN }));
  return { db, svc, fcm };
}
const deposit = (i: number) => ({ id: i, account: ACCT, kind: 'Deposited', txHash: '0x1', timestamp: nowSec(), leaderAccountId: null, perpId: null, orderType: null, lotLNS: null, pricePNS: null, reason: null, limit: null, actual: null, keeper: null, amount: '20000000' });

describe('PushService over FCM HTTP v1 (fake endpoint)', () => {
  it('sends a data message: generic text, sealed envelope only, OAuth bearer from the minted token', async () => {
    const { svc } = await setup();
    const r = await svc.notify(ACCT, deposit(1));
    expect(r.fcm).toBe(1);
    const [s] = sends();
    expect(s!.headers.authorization).toBe('Bearer tok-1');
    const { message } = JSON.parse(s!.body);
    expect(message.token).toBe(TOKEN);
    expect(message.notification).toBeUndefined();
    expect(Object.keys(message.data).sort()).toEqual(['body', 'channelId', 'message', 'mirror', 'title']);
    expect([message.data.title, message.data.message, message.data.channelId]).toEqual([GENERIC.title, GENERIC.body, 'copies']);
    expect(JSON.parse(message.data.body).mirror).toBe(message.data.mirror);
    const env = JSON.parse(message.data.mirror) as PushEnvelope;
    expect(JSON.parse(open(devicePriv, env).toString())).toMatchObject({ kind: 'deposit', body: '20.00 AUSD added to your follow account' });
    expect(s!.body).not.toMatch(/AUSD|Deposit|0x0000/);
  });
  it('caches the access token until shortly before expiry', async () => {
    let t = Date.now();
    const { svc } = await setup(() => t);
    await svc.notify(ACCT, deposit(1));
    await svc.notify(ACCT, deposit(2));
    expect(mints).toBe(1);
    t += 3_550_000; // inside the last minute of the token's life
    await svc.notify(ACCT, { ...deposit(3), timestamp: Math.floor(t / 1000) });
    expect(mints).toBe(2);
    expect(sends().map((s) => s.headers.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2']);
  });
  it('UNREGISTERED deletes the device token; the in-app channel stays', async () => {
    const { svc, db } = await setup();
    respond = () => ({ status: 404, body: { error: { code: 404, status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } });
    expect((await svc.notify(ACCT, deposit(1))).fcm).toBe(0);
    expect(db.all("SELECT * FROM push_subs WHERE channel = 'fcm'")).toHaveLength(0);
    expect(db.all("SELECT * FROM push_subs WHERE channel = 'app'")).toHaveLength(1);
  });
  it('other errors count as failures but keep the token; a 401 mints a fresh token once', async () => {
    const { svc, db } = await setup();
    respond = () => ({ status: 503, body: { error: { status: 'UNAVAILABLE' } } });
    await svc.notify(ACCT, deposit(1));
    expect(db.get<{ failures: number }>("SELECT failures FROM push_subs WHERE channel = 'fcm'")!.failures).toBe(1);
    let first = true;
    respond = () => (first ? ((first = false), { status: 401, body: { error: { status: 'UNAUTHENTICATED' } } }) : { status: 200, body: {} });
    expect((await svc.notify(ACCT, deposit(2))).fcm).toBe(1);
    expect(mints).toBe(2);
  });
  it('a direct FcmSender with an unusable key fails to mint and reports it without the key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const s = new FcmSender({ serviceAccount: { ...SA, private_key: other }, endpointOverride: `${base}/send` });
    await expect(s.accessToken()).rejects.toThrow(/^FCM token mint failed: HTTP 400$/);
  });
});
