import { createHash } from 'node:crypto';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { alertFor, lowEquityAlert, type AlertPayload, type FeedItem, type MarketText } from './alerts.js';
import type { Bus } from './bus.js';
import { FCM_TOKEN, type FcmSender } from './fcm.js';
import { decodeNotifyKey, sealJson, type PushEnvelope } from './pushcrypto.js';
import { channelHash, verifyPushSig, type PushChannel } from './pushauth.js';
import type { RegistryLike } from './registry.js';

export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
/** Browser push services a subscription endpoint may point at (anything else would make the engine an open relay). */
const WEBPUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const MAX_SUBS_PER_OWNER = 10;
const MAX_FAILURES = 20;
/** What the OS shows. The real text is in the sealed envelope and only the device can read it. */
export const GENERIC = { title: 'Mirror', body: 'New activity' } as const;

export interface WebPushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export type WebPushSender = (sub: WebPushSubscription, body: string, headers: Record<string, string>) => Promise<{ statusCode: number }>;

export interface PushOptions {
  /** EIP-712 domain chain id for PushRegister / PushUnregister. */
  chainId: number;
  /** Android through FCM HTTP v1 (FCM_SERVICE_ACCOUNT_PATH / _JSON). */
  fcm?: FcmSender;
  /** Expo push (PUSH_ENABLED): optional fallback for Expo tokens. */
  enabled: boolean;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  /** Web Push sender; set when VAPID keys are configured (app.ts wires the `web-push` package). */
  webPush?: WebPushSender;
  vapidPublicKey?: string;
  /** Test hook: every Web Push request goes here instead of the subscription endpoint. */
  endpointOverride?: string;
  ratePerMin?: number;
  maxAgeSec?: number;
  lowEquityPct?: number;
  markets?: Array<{ perpId: number } & MarketText>;
  /** Mirror's own signer addresses (keepers, stop executor). */
  keepers?: () => string[];
  now?: () => number;
}

type SubRow = { id: string; owner: string; channel: PushChannel; target: string; p256dh: string | null; auth: string | null; notify_public_key: string };
type Err = Error & { statusCode?: number };
const bad = (msg: string): Err => Object.assign(new Error(msg), { statusCode: 400 });
const b64urlLen = (s: string) => Buffer.from(s, 'base64url').length;

export interface RegisterBody {
  owner: string;
  notifyPublicKey: string;
  /** At most one remote channel per registration; none = the in-app (SSE) channel only. */
  fcmToken?: string;
  expoPushToken?: string;
  webPush?: WebPushSubscription;
  /** Owner-signed PushRegister (services/pushauth.ts). */
  deadline?: string | number | bigint;
  signature?: string;
}

export interface UnregisterBody { owner: string; channel: Exclude<PushChannel, 'app'>; target: string; deadline?: string | number | bigint; signature?: string }

export interface Delivery { skipped?: string; sse: number; webpush: number; fcm: number; expo: number; payload?: AlertPayload }
const NONE = { sse: 0, webpush: 0, fcm: 0, expo: 0 } as const;
const toBig = (v: unknown): bigint => {
  try {
    return typeof v === 'bigint' ? v : BigInt(String(v ?? ''));
  } catch {
    throw bad('deadline must be an integer (unix seconds)');
  }
};

/**
 * Encrypted alerts for an owner's MirrorAccounts. Each alert is sealed to every registered device's notification
 * public key (X25519, derived on the device from the passkey's "mirror.prf.ns.notify.v1" PRF namespace) and relayed
 * as ciphertext over SSE (app open), Web Push (VAPID), FCM HTTP v1 (Android) and, if configured, Expo push. Every
 * registration is owner-signed (pushauth.ts). Team-run accounts never alert.
 */
export class PushService {
  private readonly seen = new Map<string, number>();
  private readonly sent = new Map<string, number[]>();
  private readonly markets: Map<number, MarketText>;

  constructor(
    private readonly db: Db,
    private readonly registry: RegistryLike,
    private readonly bus: Bus,
    private readonly opts: PushOptions,
    private readonly log: Logger,
  ) {
    this.markets = new Map((opts.markets ?? []).map((m) => [m.perpId, m]));
    // Registrations from before owner signatures were required may belong to anyone: drop them (the app signs again
    // when alerts are turned on).
    const gone = Number(this.db.run('DELETE FROM push_subs WHERE signed_ms IS NULL').changes);
    if (gone) this.log.info({ removed: gone }, 'unsigned push registrations removed');
  }

  /** Notification keys of the owner's signed registrations: the only keys owner data is ever sealed to. */
  ownerKeys(owner: string): string[] {
    return this.db.all<{ k: string }>('SELECT DISTINCT notify_public_key AS k FROM push_subs WHERE owner = ? AND signed_ms IS NOT NULL', owner.toLowerCase()).map((r) => r.k);
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  config() {
    return { webPush: this.opts.webPush && this.opts.vapidPublicKey ? { vapidPublicKey: this.opts.vapidPublicKey } : null, fcm: !!this.opts.fcm, expo: this.opts.enabled, sse: true, chainId: this.opts.chainId };
  }

  private upsert(owner: string, channel: SubRow['channel'], target: string, key: string, p256dh: string | null = null, auth: string | null = null) {
    const id = `${channel}:${createHash('sha256').update(`${owner}|${target || key}`).digest('hex').slice(0, 32)}`;
    const t = this.now();
    this.db.run(
      `INSERT INTO push_subs (id, owner, channel, target, p256dh, auth, notify_public_key, created_ms, updated_ms, signed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, notify_public_key = excluded.notify_public_key, updated_ms = excluded.updated_ms, signed_ms = excluded.signed_ms, failures = 0`,
      id, owner, channel, target, p256dh, auth, key, t, t, t,
    );
  }

  /**
   * Registers a device's notification key (in-app channel) and at most one remote channel for `owner`. Requires the
   * owner's PushRegister signature over the key and the channel (pushauth.ts), so nobody can point someone else's
   * alerts or share list at their own key.
   */
  async register(b: RegisterBody) {
    if (!isAddress(b.owner)) throw bad('invalid owner');
    let keyRaw: Buffer;
    try {
      keyRaw = decodeNotifyKey(b.notifyPublicKey);
    } catch (err) {
      throw bad((err as Error).message);
    }
    // Tokens like "unavailable:no-fcm-config" mean the device has no remote push yet: the in-app channel still works.
    const expo = b.expoPushToken && EXPO_TOKEN.test(b.expoPushToken) ? b.expoPushToken : undefined;
    if ([b.webPush, b.fcmToken, expo].filter(Boolean).length > 1) throw bad('register one remote channel at a time (webPush, fcmToken or expoPushToken)');
    let channel: PushChannel = 'app';
    let target = '';
    if (b.webPush) {
      let url: URL;
      try {
        url = new URL(b.webPush.endpoint);
      } catch {
        throw bad('invalid webPush.endpoint');
      }
      if (url.protocol !== 'https:' || !WEBPUSH_HOSTS.some((h) => h.test(url.hostname))) throw bad('webPush.endpoint is not a known browser push service');
      if (b64urlLen(b.webPush.keys?.p256dh ?? '') !== 65 || b64urlLen(b.webPush.keys?.auth ?? '') !== 16) throw bad('webPush.keys must hold p256dh (65 bytes) and auth (16 bytes)');
      [channel, target] = ['webpush', b.webPush.endpoint];
    } else if (b.fcmToken) {
      if (!FCM_TOKEN.test(b.fcmToken)) throw bad('invalid fcmToken');
      [channel, target] = ['fcm', b.fcmToken];
    } else if (expo) [channel, target] = ['expo', expo];
    const owner = getAddress(b.owner);
    await verifyPushSig(this.db, this.opts.chainId, {
      primaryType: 'PushRegister',
      message: { owner, notifyPublicKey: `0x${keyRaw.toString('hex')}` as Hex, channelHash: channelHash(channel, target), deadline: toBig(b.deadline) },
    }, b.signature, this.now());
    const o = owner.toLowerCase();
    const channels: string[] = [];
    if (channel === 'webpush') this.upsert(o, 'webpush', target, b.notifyPublicKey, b.webPush!.keys.p256dh, b.webPush!.keys.auth);
    else if (channel !== 'app') this.upsert(o, channel, target, b.notifyPublicKey);
    if (channel !== 'app') channels.push(channel);
    this.upsert(o, 'app', '', b.notifyPublicKey);
    channels.push('sse');
    const extra = this.db.all<{ id: string }>('SELECT id FROM push_subs WHERE owner = ? ORDER BY updated_ms DESC LIMIT -1 OFFSET ?', o, MAX_SUBS_PER_OWNER);
    for (const r of extra) this.db.run('DELETE FROM push_subs WHERE id = ?', r.id);
    return { ok: true, owner, channels };
  }

  /** Owner-signed PushUnregister for one remote channel (the in-app channel ends with the app). */
  async unregister(b: UnregisterBody) {
    if (!isAddress(b.owner)) throw bad('invalid owner');
    if (!['webpush', 'fcm', 'expo'].includes(b.channel)) throw bad('channel must be webpush, fcm or expo');
    const owner: Address = getAddress(b.owner);
    await verifyPushSig(this.db, this.opts.chainId, { primaryType: 'PushUnregister', message: { owner, channelHash: channelHash(b.channel, b.target), deadline: toBig(b.deadline) } }, b.signature, this.now());
    const n = this.db.run('DELETE FROM push_subs WHERE owner = ? AND channel = ? AND target = ?', owner.toLowerCase(), b.channel, b.target).changes;
    return { ok: true, removed: Number(n) };
  }

  start() {
    this.bus.subscribeAll((channel, e) => {
      // The 'demo' channel repeats the team-run follower's events for watchers; it never alerts.
      if (e.type !== 'feed' || channel === 'demo') return;
      void this.notify(channel, e.item as FeedItem).catch((err) => this.log.warn({ err: (err as Error).message }, 'alert failed'));
    });
  }

  /** Hook for equity snapshots (EquityService.onRecord). */
  onEquity(account: string, equityCNS: bigint, netDepositsCNS: bigint) {
    const info = this.registry.get(account);
    if (!info || info.teamRun) return;
    const p = lowEquityAlert(getAddress(account), equityCNS, netDepositsCNS, this.opts.lowEquityPct ?? 50, this.now());
    if (p) void this.deliver(info.owner, account, p).catch((err) => this.log.warn({ err: (err as Error).message }, 'alert failed'));
  }

  async notify(account: string, item: FeedItem): Promise<Delivery> {
    const info = this.registry.get(account);
    if (!info) return { skipped: 'unknown account', ...NONE };
    if (info.teamRun || this.registry.isTeamRun(account)) return { skipped: 'team run', ...NONE };
    if (this.now() / 1000 - Number(item.timestamp) > (this.opts.maxAgeSec ?? 900)) return { skipped: 'old event', ...NONE };
    const keepers = new Set((this.opts.keepers?.() ?? []).map((a) => a.toLowerCase()));
    const p = alertFor(item, { markets: this.markets, owner: info.owner, keepers });
    if (!p) return { skipped: 'not alerted', ...NONE };
    return this.deliver(info.owner, account, p);
  }

  /** Dedupe by event, rate-limit per owner, seal per device key, send on every channel. */
  async deliver(owner: string, account: string, p: AlertPayload): Promise<Delivery> {
    const now = this.now();
    const key = `${account.toLowerCase()}:${p.eventId}`;
    if (this.seen.has(key)) return { skipped: 'duplicate', ...NONE };
    this.seen.set(key, now);
    if (this.seen.size > 5000) for (const k of [...this.seen.keys()].slice(0, 1000)) this.seen.delete(k);
    const o = owner.toLowerCase();
    const recent = (this.sent.get(o) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= (this.opts.ratePerMin ?? 20)) {
      this.log.info({ owner: o, eventId: p.eventId }, 'alert rate-limited');
      return { skipped: 'rate limited', ...NONE };
    }
    const subs = this.db.all<SubRow>('SELECT id, owner, channel, target, p256dh, auth, notify_public_key FROM push_subs WHERE owner = ? AND signed_ms IS NOT NULL', o);
    if (!subs.length) return { skipped: 'no devices', ...NONE };
    recent.push(now);
    this.sent.set(o, recent);

    const envs = new Map<string, PushEnvelope>();
    const envFor = (k: string) => envs.get(k) ?? (envs.set(k, sealJson(k, p)), envs.get(k)!);
    const out: Delivery = { ...NONE, payload: p };
    // In-app: one envelope per device key on the account's SSE stream; a device ignores envelopes it can't open.
    for (const k of new Set(subs.map((s) => s.notify_public_key))) {
      this.bus.publish(account, { type: 'push', ...envFor(k) });
      out.sse++;
    }
    const web = subs.filter((s) => s.channel === 'webpush');
    if (web.length && this.opts.webPush) out.webpush = await this.sendWebPush(web, envFor);
    const fcm = subs.filter((s) => s.channel === 'fcm');
    if (fcm.length && this.opts.fcm) out.fcm = await this.sendFcm(fcm, envFor);
    else if (fcm.length) this.log.debug({ owner: o, n: fcm.length }, 'FCM not configured; not sent');
    const expo = subs.filter((s) => s.channel === 'expo');
    if (expo.length && this.opts.enabled) out.expo = await this.sendExpo(expo, envFor);
    else if (expo.length) this.log.debug({ owner: o, n: expo.length }, 'expo push disabled; not sent');
    return out;
  }

  private async sendWebPush(subs: SubRow[], envFor: (k: string) => PushEnvelope) {
    let ok = 0;
    for (const s of subs) {
      const override = this.opts.endpointOverride;
      const sub = { endpoint: override ?? s.target, keys: { p256dh: s.p256dh ?? '', auth: s.auth ?? '' } };
      try {
        const res = await this.opts.webPush!(sub, JSON.stringify({ mirror: envFor(s.notify_public_key) }), override ? { 'x-mirror-endpoint': s.target } : {});
        if (res.statusCode >= 200 && res.statusCode < 300) {
          ok++;
          this.db.run('UPDATE push_subs SET last_sent_ms = ?, failures = 0 WHERE id = ?', this.now(), s.id);
        } else this.failed(s, res.statusCode);
      } catch (err) {
        this.failed(s, (err as { statusCode?: number }).statusCode ?? 0, (err as Error).message);
      }
    }
    return ok;
  }

  private async sendFcm(subs: SubRow[], envFor: (k: string) => PushEnvelope) {
    let ok = 0;
    for (const s of subs) {
      try {
        const r = await this.opts.fcm!.send(s.target, envFor(s.notify_public_key), GENERIC, 'copies');
        if (r.ok) {
          ok++;
          this.db.run('UPDATE push_subs SET last_sent_ms = ?, failures = 0 WHERE id = ?', this.now(), s.id);
        } else this.failed(s, r.gone ? 410 : r.status, r.code);
      } catch (err) {
        this.failed(s, 0, (err as Error).message);
      }
    }
    return ok;
  }

  private failed(s: SubRow, status: number, msg?: string) {
    // 404/410: the browser dropped the subscription (FCM UNREGISTERED and Expo DeviceNotRegistered map to 410). Anything else counts towards MAX_FAILURES.
    if (status === 404 || status === 410) {
      this.db.run('DELETE FROM push_subs WHERE id = ?', s.id);
      this.log.info({ owner: s.owner, channel: s.channel, status }, 'push subscription gone; removed');
      return;
    }
    this.db.run('UPDATE push_subs SET failures = failures + 1 WHERE id = ?', s.id);
    this.db.run('DELETE FROM push_subs WHERE id = ? AND failures >= ?', s.id, MAX_FAILURES);
    this.log.warn({ owner: s.owner, channel: s.channel, status, err: msg }, 'push send failed');
  }

  private async sendExpo(subs: SubRow[], envFor: (k: string) => PushEnvelope) {
    const messages = subs.map((s) => ({ to: s.target, ...GENERIC, data: { mirror: JSON.stringify(envFor(s.notify_public_key)) }, priority: 'high', channelId: 'copies' }));
    const res = await (this.opts.fetchImpl ?? fetch)('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}) },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
    const tickets = ((await res.json().catch(() => ({}))) as { data?: Array<{ status: string; details?: { error?: string } }> }).data ?? [];
    let ok = 0;
    tickets.forEach((t, i) => {
      if (t.status === 'ok') ok++;
      else if (t.details?.error === 'DeviceNotRegistered' && subs[i]) this.failed(subs[i], 410);
      else if (subs[i]) this.failed(subs[i], 0, t.details?.error);
    });
    return ok;
  }
}
