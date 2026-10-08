// The user's alerts choice ("on" only after Turn on alerts or the Settings switch). Separate from alerts.ts so the
// push modules can read it without importing the hook.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const ALERTS_KEY = "mirror.alerts.v1";
export type AlertsPref = "on" | "off" | "unset";

export async function getAlertsPref(): Promise<AlertsPref> {
  try {
    const v = await AsyncStorage.getItem(ALERTS_KEY);
    return v === "on" || v === "off" ? v : "unset";
  } catch {
    return "unset";
  }
}

export async function setAlertsPref(v: "on" | "off"): Promise<void> {
  await AsyncStorage.setItem(ALERTS_KEY, v).catch(() => {});
}

/**
 * Whether the Android notification channel is created at app start. Only once the user has turned alerts on or
 * already allowed notifications: creating a channel can make Android show the permission prompt on its own, and
 * that prompt must never come right after account creation, before the user asked for alerts.
 */
export function channelAtStartup(pref: AlertsPref, permission: string | undefined | null): boolean {
  return pref === "on" || permission === "granted";
}
