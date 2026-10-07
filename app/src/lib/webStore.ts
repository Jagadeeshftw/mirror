// Encrypted key-value store for browsers (expo-secure-store has no web support).
// Values are sealed with AES-256-GCM under a non-extractable WebCrypto key that lives in IndexedDB,
// so what sits in localStorage is ciphertext and the key itself can't be read out by script.
// Only the same things Android keeps in SecureStore are stored: the account record (address and
// credential id) and the decrypt-only notification key. The PRF output and the signing key are
// never stored anywhere; they exist only for the duration of one passkey prompt.
import { base64 } from "@scure/base";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { utf8Decode } from "./notifyKey";

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const PREFIX = "mirror.sec.v1.";

export function createWebStore(getKey: () => Promise<CryptoKey>, kv: KV, subtle: SubtleCrypto = globalThis.crypto.subtle) {
  return {
    async getItem(key: string): Promise<string | null> {
      const raw = kv.getItem(PREFIX + key);
      if (!raw) return null;
      try {
        const buf = base64.decode(raw);
        const iv = buf.slice(0, 12);
        const pt = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8ToBytes(key) }, await getKey(), buf.slice(12));
        return utf8Decode(new Uint8Array(pt));
      } catch {
        return null; // wrong key (storage cleared) or tampered: treat as absent
      }
    },
    async setItem(key: string, value: string): Promise<void> {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8ToBytes(key) }, await getKey(), utf8ToBytes(value)));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv, 0);
      out.set(ct, 12);
      kv.setItem(PREFIX + key, base64.encode(out));
    },
    async deleteItem(key: string): Promise<void> {
      kv.removeItem(PREFIX + key);
    },
  };
}

const DB = "mirror-keys";
const STORE = "keys";
const KEY_ID = "store-wrap-v1";

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

let keyP: Promise<CryptoKey> | null = null;
/** The browser's non-extractable wrapping key, created once per origin. */
export function browserKey(): Promise<CryptoKey> {
  if (!keyP) {
    keyP = (async () => {
      const found = await idb<CryptoKey | undefined>("readonly", (s) => s.get(KEY_ID) as IDBRequest<CryptoKey | undefined>);
      if (found) return found;
      const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await idb("readwrite", (s) => s.put(k, KEY_ID));
      return k;
    })();
    keyP.catch(() => {
      keyP = null;
    });
  }
  return keyP;
}
