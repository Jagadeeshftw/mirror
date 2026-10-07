// Web build of push.ts: Web Push with VAPID through the service worker (public/sw.js), no Firebase.
//
// The alert is sealed to this browser's notification key (X25519 from the passkey's second PRF namespace,
// "mirror.prf.ns.notify.v1"). That key lives in the app's encrypted storage (localStorage sealed under a
// non-extractable IndexedDB key, webStore.ts), which a service worker cannot read, and the worker has no X25519 /
// ChaCha20 code. So the worker never decrypts: it shows the generic "Mirror / New activity", keeps the envelope in
// IndexedDB ("mirror-inbox") and pings open tabs. The app decrypts the inbox when it opens or regains focus, and
// envelopes that arrive over SSE while it is open.
import { api } from "./api";
import { openJson, publicKeyB64 } from "./notifyKey";
import { envelopeFrom } from "./pushEnvelope";
import { channelHash, keyRegistered, sameReg, type PushChannel } from "./pushAuth";
import { loadPushReg, registerSigned, savePushReg, unregisterSigned } from "./pushRegistration";
import { basePath } from "./pwa";
import { addNotification } from "../state/notifications";
import { getAlertsPref } from "../state/alertsPref";
import type { Address, PushEnvelope, PushPayload, WebPushSubscriptionJSON } from "./types";
import { loadNotifyKey } from "./wallet";

export const BACKGROUND_TASK = "mirror-encrypted-push";
export const CHANNEL_ID = "copies";
export const INBOX_DB = "mirror-inbox";
export const INBOX_STORE = "envelopes";

export interface PushRegistration {
  token: string;
  registered: boolean;
  permission: string;
  channel: "fcm" | "expo" | "webpush" | "in-app";
  decryptInBackground: boolean;
}

export { envelopeFrom };

export async function decryptEnvelope(env: PushEnvelope): Promise<PushPayload | null> {
  const keys = await loadNotifyKey();
  if (!keys) return null;
  try {
    return openJson<PushPayload>(keys, env);
  } catch {
    return null;
  }
}

/** Decrypts into the Alerts list. The browser notification itself is the service worker's generic one. */
export async function presentEncrypted(env: PushEnvelope, _show = true): Promise<PushPayload | null> {
  const p = await decryptEnvelope(env);
  if (p) await addNotification(p);
  return p;
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(INBOX_STORE, { autoIncrement: true });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

/** Takes every envelope the service worker queued and decrypts it. Returns how many were ours. */
export async function drainInbox(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  let envs: unknown[] = [];
  try {
    const db = await idb();
    envs = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(INBOX_STORE, "readwrite");
      const st = tx.objectStore(INBOX_STORE);
      const all = st.getAll();
      all.onsuccess = () => {
        st.clear();
        resolve(all.result);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of envs) {
    const env = envelopeFrom(e);
    if (env && (await presentEncrypted(env))) n++;
  }
  return n;
}

export async function setupNotifications() {
  await drainInbox();
}

/** Decrypts queued alerts now, when the worker pings, and whenever the tab becomes visible again. */
export function listenForEncryptedPush() {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  const onMsg = (e: MessageEvent) => {
    if (e.data?.type === "mirror-push") void drainInbox();
  };
  const onVis = () => {
    if (document.visibilityState === "visible") void drainInbox();
  };
  sw?.addEventListener("message", onMsg);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  void drainInbox();
  return {
    remove() {
      sw?.removeEventListener("message", onMsg);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    },
  };
}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(`${basePath()}/`).catch(() => undefined);
  if (reg) return reg;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
}

async function subscribe(vapidPublicKey: string): Promise<PushSubscription | null> {
  const reg = await swRegistration();
  if (!reg?.pushManager) return null;
  const key = b64urlBytes(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  const cur = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && cur && (cur.length !== key.length || cur.some((b, i) => b !== key[i]))) {
    await sub.unsubscribe().catch(() => {}); // server rotated its VAPID keys
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
}

/**
 * Registers the notification public key (in-app delivery over SSE) and, with alerts on and notifications allowed, a
 * Web Push subscription. The browser permission is requested and the registration signed by the owner key (one
 * passkey prompt, pushAuth.ts) only with `ask: true` (Turn on alerts / Settings). Without it nothing prompts: a
 * registration this browser already signed is reported as is.
 */
export async function registerForPush(owner: Address, opts: { ask?: boolean } = {}): Promise<PushRegistration> {
  const keys = await loadNotifyKey();
  const base: PushRegistration = { token: "", registered: false, permission: "unknown", channel: "in-app", decryptInBackground: false };
  if (!keys) return base;
  const on = opts.ask || (await getAlertsPref()) === "on";
  const N = typeof Notification !== "undefined" ? Notification : undefined;
  let permission: string = N ? N.permission : "unsupported";
  if (N && on && opts.ask && permission === "default") permission = await N.requestPermission().catch(() => "default");
  if (permission === "default") permission = "undetermined";
  let webPush: WebPushSubscriptionJSON | undefined;
  let token = !on ? "unavailable:alerts-off" : permission === "granted" ? "unavailable:no-webpush" : "unavailable:not-permitted";
  if (on && permission === "granted") {
    try {
      const cfg = await api.pushConfig();
      // Without a prompt, only look at an existing subscription; subscribing is part of turning alerts on.
      const sub = cfg.webPush ? (opts.ask ? await subscribe(cfg.webPush.vapidPublicKey) : await existing()) : null;
      const j = sub?.toJSON();
      if (j?.endpoint && j.keys?.p256dh && j.keys?.auth) {
        webPush = { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
        token = "webpush";
      }
    } catch {
      token = "unavailable:no-webpush";
    }
  }
  const ch: PushChannel = webPush ? "webpush" : "app";
  const target = webPush?.endpoint ?? "";
  const key = publicKeyB64(keys);
  const out = { ...base, token, permission, channel: webPush ? ("webpush" as const) : ("in-app" as const) };
  const prev = await loadPushReg();
  if (sameReg(prev, owner, key, ch, target) || (!opts.ask && ch === "app" && keyRegistered(prev, owner, key))) return { ...out, registered: true };
  if (!opts.ask) return out;
  try {
    await registerSigned(owner, key, ch, target, webPush ? { webPush } : {});
    return { ...out, registered: true };
  } catch {
    return out;
  }
}

async function existing(): Promise<PushSubscription | null> {
  const reg = await swRegistration();
  return (await reg?.pushManager?.getSubscription().catch(() => null)) ?? null;
}

/** Alerts off: tell the server (owner-signed) and drop the browser subscription. */
export async function unregisterPush(owner: Address): Promise<void> {
  const reg = await swRegistration().catch(() => null);
  const sub = await reg?.pushManager?.getSubscription().catch(() => null);
  if (!sub) return;
  const prev = await loadPushReg();
  if (prev && prev.channel === "webpush" && prev.owner === owner.toLowerCase() && prev.hash === channelHash("webpush", sub.endpoint)) {
    await unregisterSigned(owner, "webpush", sub.endpoint).catch(() => {});
    await savePushReg(owner, prev.key, "app", "").catch(() => {});
  }
  await sub.unsubscribe().catch(() => {});
}
