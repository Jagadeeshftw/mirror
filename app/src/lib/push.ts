// Push: payloads are sealed to the device's passkey-derived X25519 key, so the server and
// the push provider only relay ciphertext. Delivered either as an FCM/Expo data message
// ({ data: { mirror: "<envelope JSON>" } }) or, while the app is open, over the SSE stream
// (event: push). Either way the device decrypts and shows a local notification.
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { api } from "./api";
import { openJson, publicKeyB64 } from "./notifyKey";
import { addNotification } from "../state/notifications";
import type { Address, PushEnvelope, PushPayload } from "./types";
import { loadNotifyKey } from "./wallet";

export const BACKGROUND_TASK = "mirror-encrypted-push";
export const CHANNEL_ID = "copies";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function envelopeFrom(data: unknown): PushEnvelope | null {
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

export async function decryptEnvelope(env: PushEnvelope): Promise<PushPayload | null> {
  const keys = await loadNotifyKey();
  if (!keys) return null;
  try {
    return openJson<PushPayload>(keys, env);
  } catch {
    return null;
  }
}

/** Decrypts and shows a local notification. Returns the payload (or null if it isn't ours). */
export async function presentEncrypted(env: PushEnvelope): Promise<PushPayload | null> {
  const p = await decryptEnvelope(env);
  if (!p) return null;
  await addNotification(p);
  await Notifications.scheduleNotificationAsync({
    content: { title: p.title, body: p.body, data: { eventId: p.eventId, account: p.account, kind: p.kind } },
    trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
  });
  return p;
}

TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
  if (error) return;
  const d = data as { notification?: { data?: unknown }; data?: unknown } | undefined;
  const env = envelopeFrom(d?.notification?.data ?? d?.data ?? d);
  if (env) await presentEncrypted(env);
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

/** Foreground data messages carry ciphertext only: decrypt and re-present. */
export function listenForEncryptedPush() {
  return Notifications.addNotificationReceivedListener((n) => {
    const env = envelopeFrom(n.request.content.data);
    if (env && !n.request.content.title) void presentEncrypted(env);
  });
}

/**
 * Registers the passkey-derived notification key (so in-app SSE payloads can be decrypted) and, when
 * the OS allows notifications, the push token. The OS permission is requested only with `ask: true`,
 * which the app passes only when the user turns alerts on (Settings, or after the first follow).
 */
export async function registerForPush(owner: Address, opts: { ask?: boolean } = {}): Promise<{ token: string; registered: boolean; permission: string }> {
  const keys = await loadNotifyKey();
  if (!keys) return { token: "", registered: false, permission: "unknown" };
  let permission = "undetermined";
  try {
    const cur = await Notifications.getPermissionsAsync();
    permission = cur.status;
    if (cur.status !== "granted" && opts.ask) permission = (await Notifications.requestPermissionsAsync()).status;
  } catch {}
  let token = permission === "granted" ? "unavailable" : "unavailable:not-permitted";
  if (permission === "granted" && Platform.OS !== "web" && (Device.isDevice || Platform.OS === "android")) {
    try {
      token = (await Notifications.getExpoPushTokenAsync()).data;
    } catch {
      try {
        token = `fcm:${(await Notifications.getDevicePushTokenAsync()).data}`;
      } catch {
        token = "unavailable:no-fcm-config";
      }
    }
  }
  try {
    await api.pushRegister({ owner, expoPushToken: token, notifyPublicKey: publicKeyB64(keys) });
    return { token, registered: true, permission };
  } catch {
    return { token, registered: false, permission };
  }
}
