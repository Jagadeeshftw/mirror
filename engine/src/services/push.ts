import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import { getAddress, isAddress } from 'viem';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import type { Bus } from './bus.js';
import type { RegistryLike } from './registry.js';

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const INFO = Buffer.from('mirror-push-v1');

function decodeKey(s: string): Buffer {
  const raw = /^(0x)?[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s.replace(/^0x/, ''), 'hex') : Buffer.from(s, 'base64url');
  if (raw.length !== 32) throw new Error('notifyPublicKey must be a 32-byte X25519 public key (hex or base64url)');
  return raw;
}

function x25519Public(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/**
 * Encrypts a payload to the device's notify key: ephemeral X25519 -> HKDF-SHA256(salt = epk, info
 * "mirror-push-v1") -> AES-256-GCM. The server only ever relays ciphertext.
 */
export function encryptForDevice(payload: unknown, notifyPublicKey: string) {
  const recipient = x25519Public(decodeKey(notifyPublicKey));
  const eph = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const epk = (eph.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  const key = Buffer.from(hkdfSync('sha256', shared, epk, INFO, 32));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return { v: 1, alg: 'X25519-HKDF-SHA256-A256GCM', epk: epk.toString('base64url'), iv: iv.toString('base64url'), ct: Buffer.concat([ct, c.getAuthTag()]).toString('base64url') };
}

export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export class PushService {
  constructor(
    private readonly db: Db,
    private readonly registry: RegistryLike,
    private readonly bus: Bus,
    private readonly opts: { enabled: boolean; accessToken?: string; fetchImpl?: typeof fetch },
    private readonly log: Logger,
  ) {}

  register(owner: string, token: string, notifyPublicKey: string) {
    if (!isAddress(owner)) throw Object.assign(new Error('invalid owner'), { statusCode: 400 });
    if (!EXPO_TOKEN.test(token)) throw Object.assign(new Error('invalid expoPushToken'), { statusCode: 400 });
    try {
      decodeKey(notifyPublicKey);
    } catch (err) {
      throw Object.assign(err as Error, { statusCode: 400 });
    }
    this.db.run(
      'INSERT INTO push_tokens (owner, token, notify_public_key, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT(owner, token) DO UPDATE SET notify_public_key = excluded.notify_public_key',
      owner.toLowerCase(), token, notifyPublicKey, Date.now(),
    );
    return { ok: true, owner: getAddress(owner) };
  }

  start() {
    this.bus.subscribeAll((channel, e) => {
      if (e.type !== 'feed' || channel === 'demo') return;
      void this.notify(channel, e.item as Record<string, unknown>).catch((err) => this.log.warn({ err: (err as Error).message }, 'push failed'));
    });
  }

  async notify(account: string, item: Record<string, unknown>) {
    const owner = this.registry.get(account)?.owner;
    if (!owner) return 0;
    const tokens = this.db.all<{ token: string; notify_public_key: string }>('SELECT token, notify_public_key FROM push_tokens WHERE owner = ?', owner.toLowerCase());
    if (!tokens.length) return 0;
    const payload = { account, kind: item.kind, txHash: item.txHash, reason: item.reason ?? null, perpId: item.perpId ?? null, at: Date.now() };
    const messages = tokens.map((t) => ({ to: t.token, title: 'Mirror', body: 'New account activity', data: { enc: encryptForDevice(payload, t.notify_public_key) }, priority: 'high' }));
    if (!this.opts.enabled) {
      this.log.debug({ account, n: messages.length }, 'push disabled; not sent');
      return messages.length;
    }
    const res = await (this.opts.fetchImpl ?? fetch)('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}) },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
    return messages.length;
  }
}
