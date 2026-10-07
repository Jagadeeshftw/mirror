import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';

/**
 * Alert envelope v1, the same construction the app opens (app/src/lib/notifyKey.ts `open`):
 *   ephemeral X25519 -> shared = X25519(eph, recipient)
 *   key = HKDF-SHA256(ikm = shared, salt = epk || recipientPub, info = "mirror.v1.push.chacha20poly1305", 32)
 *   ct  = ChaCha20-Poly1305(key, nonce 12 bytes, aad "mirror.v1") with the 16-byte tag appended
 *   envelope = {v: 1, epk, nonce, ct}, standard base64.
 * The recipient key is the device's notification key, derived on the device from the passkey's second PRF namespace
 * ("mirror.prf.ns.notify.v1"). The server holds only the public half and never sees the plaintext after sealing.
 * Test vector shared with the app: shared/test-vectors/push-envelope-v1.json.
 */
export const ENVELOPE_VERSION = 1;
export const PUSH_HKDF_INFO = 'mirror.v1.push.chacha20poly1305';
export const PUSH_AAD = 'mirror.v1';

export interface PushEnvelope {
  v: 1;
  epk: string;
  nonce: string;
  ct: string;
}

const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');

/** A 32-byte X25519 public key from base64 (standard or url-safe) or hex. */
export function decodeNotifyKey(s: string): Buffer {
  const t = s.trim();
  const raw = /^(0x)?[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t.replace(/^0x/, ''), 'hex') : Buffer.from(t, 'base64');
  if (raw.length !== 32) throw new Error('notifyPublicKey must be a 32-byte X25519 public key (base64 or hex)');
  if (raw.every((b) => b === 0)) throw new Error('notifyPublicKey is the zero point');
  return raw;
}

const pub = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
const priv = (raw: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: 'der', type: 'pkcs8' });
export const x25519PublicOf = (privateRaw: Buffer): Buffer => (createPublicKey(priv(privateRaw)).export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);

function aeadKey(shared: Buffer, epk: Buffer, recipient: Buffer, info: string) {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epk, recipient]), Buffer.from(info), 32));
}

/** Seals `plaintext` to `recipient` (raw 32 bytes). `ephemeralPrivate` and `nonce` are only fixed in tests. */
export function seal(recipient: Buffer, plaintext: Buffer, opts: { ephemeralPrivate?: Buffer; nonce?: Buffer; info?: string } = {}): PushEnvelope {
  const ephPriv = opts.ephemeralPrivate ?? randomBytes(32);
  const nonce = opts.nonce ?? randomBytes(12);
  const epk = x25519PublicOf(ephPriv);
  const shared = diffieHellman({ privateKey: priv(ephPriv), publicKey: pub(recipient) });
  const key = aeadKey(shared, epk, recipient, opts.info ?? PUSH_HKDF_INFO);
  const c = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  c.setAAD(Buffer.from(PUSH_AAD), { plaintextLength: plaintext.length });
  const ct = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
  return { v: 1, epk: epk.toString('base64'), nonce: nonce.toString('base64'), ct: ct.toString('base64') };
}

/** Seals a JSON payload to a device's notifyPublicKey (as registered: base64 or hex). */
export function sealJson(notifyPublicKey: string, payload: unknown): PushEnvelope {
  return seal(decodeNotifyKey(notifyPublicKey), Buffer.from(JSON.stringify(payload), 'utf8'));
}

/** Opens an envelope with the recipient's private key. Used by tests and the Stage-A run, never by the server. */
export function open(recipientPrivate: Buffer, env: PushEnvelope, info = PUSH_HKDF_INFO): Buffer {
  if (env.v !== ENVELOPE_VERSION) throw new Error(`unsupported envelope version ${String(env.v)}`);
  const epk = Buffer.from(env.epk, 'base64');
  const recipient = x25519PublicOf(recipientPrivate);
  const shared = diffieHellman({ privateKey: priv(recipientPrivate), publicKey: pub(epk) });
  const key = aeadKey(shared, epk, recipient, info);
  const blob = Buffer.from(env.ct, 'base64');
  const d = createDecipheriv('chacha20-poly1305', key, Buffer.from(env.nonce, 'base64'), { authTagLength: 16 });
  d.setAAD(Buffer.from(PUSH_AAD), { plaintextLength: blob.length - 16 });
  d.setAuthTag(blob.subarray(-16));
  return Buffer.concat([d.update(blob.subarray(0, -16)), d.final()]);
}
