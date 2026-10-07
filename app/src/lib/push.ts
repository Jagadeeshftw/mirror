// Push (Android): alerts are sealed to this device's notification key (X25519 from the passkey's second PRF namespace,
// "mirror.prf.ns.notify.v1"), so Mirror's server, Expo and FCM only relay ciphertext. The remote message shows the
// generic "Mirror / New activity" and carries the envelope in data.mirror. Foreground: the generic banner is
// suppressed and the decrypted alert is shown as a local notification. Background: the OS shows the generic text and
// the background task decrypts into the Alerts list. While the app is open the same envelopes also arrive over SSE.
// Web build: push.web.ts.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { api } from "./api";
import { openJson, publicKeyB64 } from "./notifyKey";
import { addNotification } from "../state/notifications";
import { getAlertsPref } from "../state/alertsPref";
import type { Address, PushEnvelope, PushPayload } from "./types";
import { loadNotifyKey } from "./wallet";

export const BACKGROUND_TASK = "mirror-encrypted-push";
export const CHANNEL_ID = "copies";

export interface PushRegistration {
  token: string;
  registered: boolean;
  permission: string;
  /** Where alerts reach this device: remote push, or only while the app is open. */
  channel: "expo" | "webpush" | "in-app";
  /** Web only: the service worker cannot decrypt, so the browser shows the generic text. */
  decryptInBackground: boolean;
}

/** The sealed envelope from a push message's data, or null if it isn't one. */
export function envelopeFrom(data: unknown): PushEnvelope | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const raw = d.mirror ?? d.envelope ?? d.body ?? d;
  try {
    const env = (typeof raw === "string" ? JSON.parse(raw) : raw) as PushEnvelope;
    return env && env.v === 1 && env.ct ? env : null;
  } catch {
    return null;
  }
}

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

/** Decrypts into the Alerts list; with `show`, also presents it as a local notification. */
export async function presentEncrypted(env: PushEnvelope, show = true): Promise<PushPayload | null> {
  const p = await decryptEnvelope(env);
  if (!p) return null;
  const isNew = await addNotification(p);
  if (show && isNew) {
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

export async function setupNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Copies and blocked trades",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120],
      lightColor: "#4B3BFF",
    });
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

function easProjectId(): string | undefined {
  const c = Constants as unknown as { expoConfig?: { extra?: { eas?: { projectId?: string } } }; easConfig?: { projectId?: string } };
  return c.expoConfig?.extra?.eas?.projectId ?? c.easConfig?.projectId;
}

/**
 * Registers the passkey-derived notification public key (in-app delivery over SSE) and, when alerts are on and the
 * OS allows notifications, the Expo push token. The OS permission is requested only with `ask: true`, which the app
 * passes only when the user turns alerts on (Settings, or after the first follow).
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
    if (cur.status !== "granted" && opts.ask) permission = (await Notifications.requestPermissionsAsync()).status;
  } catch {}
  let token = !on ? "unavailable:alerts-off" : permission === "granted" ? "unavailable" : "unavailable:not-permitted";
  if (on && permission === "granted" && Platform.OS !== "web" && (Device.isDevice || Platform.OS === "android")) {
    try {
      // Needs google-services.json in the build and an Expo project id (docs/app.md, "Android push").
      token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() })).data;
    } catch {
      token = "unavailable:no-fcm-config";
    }
  }
  const channel = token.startsWith("Expo") ? "expo" : "in-app";
  try {
    await api.pushRegister({ owner, notifyPublicKey: publicKeyB64(keys), ...(channel === "expo" ? { expoPushToken: token } : {}) });
    return { token, registered: true, permission, channel, decryptInBackground: true };
  } catch {
    return { token, registered: false, permission, channel, decryptInBackground: true };
  }
}

/** Alerts off: stop remote push to this device (the in-app channel stays while the app is open). */
export async function unregisterPush(owner: Address): Promise<void> {
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() })).data;
    await api.pushUnregister({ owner, target: token });
  } catch {}
}

/** Web only (push.web.ts): alerts the service worker queued. Native delivers through the background task. */
export async function drainInbox(): Promise<number> {
  return 0;
}
