// "One Passkey, Many Keys": a namespaced X25519 key derived from the same passkey PRF output
// that never signs transactions. It decrypts end-to-end encrypted push payloads and
// encrypts private follow notes before they are stored on the backend.
//
// Mera 0.2 returns exactly one PRF output per WebAuthn ceremony (the `first` PRF
// evaluation for one 32-byte salt). A second PRF salt would need a second ceremony, i.e.
// a second biometric prompt at account creation. To keep create to one prompt, namespaced
// keys are derived from the single PRF output with HKDF-SHA256 using distinct `info`
// strings, the same domain-separation scheme Mera itself uses for its secret vaults
// (`mera.v1.encrypt.secret`). The trading key comes from the PRF output via BIP-39/BIP-44,
// a different derivation path, so the two keys are independent.
import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import type { PushEnvelope } from "./types";

export const NOTIFY_KEY_INFO = "mirror.v1.notify.x25519";
export const PUSH_HKDF_INFO = "mirror.v1.push.chacha20poly1305";
export const NOTE_HKDF_INFO = "mirror.v1.note.chacha20poly1305";
const AAD = utf8ToBytes("mirror.v1");

export interface NotifyKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function deriveNotifyKey(prfOutput: Uint8Array): NotifyKeyPair {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  const privateKey = hkdf(sha256, prfOutput, new Uint8Array(0), utf8ToBytes(NOTIFY_KEY_INFO), 32);
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** UTF-8 decode without relying on TextDecoder (not guaranteed on every Hermes build). */
export function utf8Decode(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** ECIES-style sealed box: ephemeral X25519 → HKDF-SHA256 → ChaCha20-Poly1305. */
export function seal(
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
  info = PUSH_HKDF_INFO,
  ephemeralPrivate: Uint8Array = randomBytes(32),
  nonce: Uint8Array = randomBytes(12),
): PushEnvelope {
  const epk = x25519.getPublicKey(ephemeralPrivate);
  const shared = x25519.getSharedSecret(ephemeralPrivate, recipientPublicKey);
  const key = hkdf(sha256, shared, concat(epk, recipientPublicKey), utf8ToBytes(info), 32);
  const ct = chacha20poly1305(key, nonce, AAD).encrypt(plaintext);
  return { v: 1, epk: base64.encode(epk), nonce: base64.encode(nonce), ct: base64.encode(ct) };
}

export function open(keys: NotifyKeyPair, env: PushEnvelope, info = PUSH_HKDF_INFO): Uint8Array {
  if (env.v !== 1) throw new Error("Unsupported envelope version");
  const epk = base64.decode(env.epk);
  const shared = x25519.getSharedSecret(keys.privateKey, epk);
  const key = hkdf(sha256, shared, concat(epk, keys.publicKey), utf8ToBytes(info), 32);
  return chacha20poly1305(key, base64.decode(env.nonce), AAD).decrypt(base64.decode(env.ct));
}

export function openJson<T>(keys: NotifyKeyPair, env: PushEnvelope, info = PUSH_HKDF_INFO): T {
  return JSON.parse(utf8Decode(open(keys, env, info))) as T;
}

/** Private follow notes are sealed to the owner's own notification key. */
export function sealNote(keys: NotifyKeyPair, text: string): PushEnvelope {
  return seal(keys.publicKey, utf8ToBytes(text), NOTE_HKDF_INFO);
}
export function openNote(keys: NotifyKeyPair, env: PushEnvelope): string {
  return utf8Decode(open(keys, env, NOTE_HKDF_INFO));
}

export function publicKeyB64(keys: { publicKey: Uint8Array }): string {
  return base64.encode(keys.publicKey);
}

export function encodeKeyPair(k: NotifyKeyPair): string {
  return base64.encode(k.privateKey);
}
export function decodeKeyPair(s: string): NotifyKeyPair {
  const privateKey = base64.decode(s);
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** Short fingerprint for display: first 8 bytes of sha256(pubkey), hex in pairs. */
export function fingerprint(publicKey: Uint8Array): string {
  const h = sha256(publicKey).slice(0, 8);
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join(":");
}
