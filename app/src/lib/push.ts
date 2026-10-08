// Push (Android): alerts are sealed to this device's notification key (X25519 from the passkey's second PRF namespace,
// "mirror.prf.ns.notify.v1"), so Mirror's server and FCM only relay ciphertext. The engine sends FCM HTTP v1 data
// messages straight to this device's native FCM token (no Expo push service, no Expo project id): the message shows
// the generic "Mirror / New activity" and carries the envelope in data.mirror. The registration is owner-signed
// (pushAuth.ts) in the passkey prompt shown when alerts are turned on. Foreground: the generic banner is
// suppressed and the decrypted alert is shown as a local notification. Background: the OS shows the generic text and
// the background task decrypts into the Alerts list. While the app is open the same envelopes also arrive over SSE.
// Web build: push.web.ts.
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { AppState, Platform } from "react-native";
import { api } from "./api";
import { openJson, publicKeyB64 } from "./notifyKey";
import { envelopeFrom } from "./pushEnvelope";
import { channelHash, keyRegistered, sameReg, type PushChannel } from "./pushAuth";
import { loadPushReg, registerSigned, savePushReg, unregisterSigned } from "./pushRegistration";
import { addNotification } from "../state/notifications";
import { channelAtStartup, getAlertsPref } from "../state/alertsPref";
import type { Address, PushEnvelope, PushPayload } from "./types";
import { loadNotifyKey } from "./wallet";

export const BACKGROUND_TASK = "mirror-encrypted-push";
export const CHANNEL_ID = "copies";

export interface PushRegistration {
  token: string;
  registered: boolean;
  permission: string;
  /** Where alerts reach this device: remote push, or only while the app is open. */
  channel: "fcm" | "expo" | "webpush" | "in-app";
  /** Web only: the service worker cannot decrypt, so the browser shows the generic text. */
  decryptInBackground: boolean;
}

export { envelopeFrom };

Notifications.setNotificationHandler({
  // The generic remote banner is replaced by the decrypted local one while the app is in the foreground.
  handleNotification: async (n) => {
    const generic = !!envelopeFrom(n.request.content.data);
    return { shouldShowBanner: !generic, shouldShowList: !generic, shouldPlaySound: false, shouldSetBadge: false };
  },
});

export async function decryptEnvelope(env: PushEnvelope): Promise<PushPayload | null> {
  const keys = await loadNotifyKey();
  if (!keys) return null;
  try {
    return openJson<PushPayload>(keys, env);
  } catch {
    return null; // sealed to another device's key
  }
}

/**
 * Decrypts into the Alerts list; with `show`, also presents it as a local notification, but only while the app is in
 * the foreground. In the background the JS runtime can still be alive (SSE, the received listener), and there the OS
 * already shows the generic "Mirror / New activity": the decrypted text stays inside the app.
 */
export async function presentEncrypted(env: PushEnvelope, show = true): Promise<PushPayload | null> {
  const p = await decryptEnvelope(env);
  if (!p) return null;
  const isNew = await addNotification(p);
  if (show && isNew && AppState.currentState === "active") {
    await Notifications.scheduleNotificationAsync({
      content: { title: p.title, body: p.body, data: { eventId: p.eventId, account: p.account, kind: p.kind, url: "/alerts" } },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  }
  return p;
}

TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
  if (error) return;
  const d = data as { notification?: { data?: unknown }; data?: unknown } | undefined;
  const env = envelopeFrom(d?.notification?.data ?? d?.data ?? d);
  // The OS already shows the generic text; the decrypted alert goes to the Alerts list.
  if (env) await presentEncrypted(env, false);
});

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Copies and blocked trades",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 120],
    lightColor: "#4B3BFF",
  });
}

/** App start: the background task always; the channel only after alerts were turned on (see channelAtStartup). */
export async function setupNotifications() {
  if (Platform.OS === "android") {
    const [pref, perm] = await Promise.all([getAlertsPref(), Notifications.getPermissionsAsync().then((p) => p.status as string).catch(() => "undetermined")]);
    if (channelAtStartup(pref, perm)) await ensureChannel().catch(() => {});
  }
  try {
    await Notifications.registerTaskAsync(BACKGROUND_TASK);
  } catch {}
}

/** Foreground remote messages carry the envelope: decrypt and present the real text locally. */
export function listenForEncryptedPush() {
  return Notifications.addNotificationReceivedListener((n) => {
    const env = envelopeFrom(n.request.content.data);
    if (env) void presentEncrypted(env);
  });
}

/** The native FCM registration token (Android). No Expo project id needed. */
async function fcmToken(): Promise<string> {
  const t = await Notifications.getDevicePushTokenAsync();
  if (t.type !== "android" || typeof t.data !== "string") throw new Error("no FCM token");
  return t.data;
}

/**
 * Registers the passkey-derived notification public key (in-app delivery over SSE) and, when alerts are on and the
 * OS allows notifications, this device's FCM token. The OS permission is requested and the registration signed (one
 * passkey prompt) only with `ask: true`, which the app passes only when the user turns alerts on (Settings, or after
 * the first follow). Without it nothing prompts: a registration this device already signed is reported as is.
 */
export async function registerForPush(owner: Address, opts: { ask?: boolean } = {}): Promise<PushRegistration> {
  const keys = await loadNotifyKey();
  const none: PushRegistration = { token: "", registered: false, permission: "unknown", channel: "in-app", decryptInBackground: true };
  if (!keys) return none;
  const on = opts.ask || (await getAlertsPref()) === "on";
  let permission = "undetermined";
  try {
    const cur = await Notifications.getPermissionsAsync();
    permission = cur.status;
    // Turning alerts on: the channel first (Android shows the prompt against it), then the one permission prompt.
    if (opts.ask) await ensureChannel().catch(() => {});
    if (cur.status !== "granted" && opts.ask) permission = (await Notifications.requestPermissionsAsync()).status;
  } catch {}
  let token = !on ? "unavailable:alerts-off" : permission === "granted" ? "unavailable" : "unavailable:not-permitted";
  let fcm: string | undefined;
  if (on && permission === "granted" && Platform.OS === "android") {
    try {
      // Needs google-services.json in the build (docs/app.md, "Android push").
      fcm = await fcmToken();
      token = fcm;
    } catch {
      token = "unavailable:no-fcm-config";
    }
  }
  const ch: PushChannel = fcm ? "fcm" : "app";
  const target = fcm ?? "";
  const key = publicKeyB64(keys);
  const channel = fcm ? "fcm" : "in-app";
  const prev = await loadPushReg();
  const out = { token, permission, channel, decryptInBackground: true } as const;
  if (sameReg(prev, owner, key, ch, target) || (!opts.ask && ch === "app" && keyRegistered(prev, owner, key))) return { ...out, registered: true };
  // A new key or channel (first opt-in, a rotated FCM token) needs the owner's signature: only when asked.
  if (!opts.ask) return { ...out, registered: false };
  try {
    await registerSigned(owner, key, ch, target, fcm ? { fcmToken: fcm } : {});
    return { ...out, registered: true };
  } catch {
    return { ...out, registered: false };
  }
}

/** Alerts off: stop remote push to this device (owner-signed; the in-app channel stays while the app is open). */
export async function unregisterPush(owner: Address): Promise<void> {
  try {
    const prev = await loadPushReg();
    if (!prev || prev.channel !== "fcm" || prev.owner !== owner.toLowerCase()) return;
    const t = await fcmToken();
    if (channelHash("fcm", t) !== prev.hash) return;
    await unregisterSigned(owner, "fcm", t);
    await savePushReg(owner, prev.key, "app", "");
  } catch {}
}

/** Web only (push.web.ts): alerts the service worker queued. Native delivers through the background task. */
export async function drainInbox(): Promise<number> {
  return 0;
}
