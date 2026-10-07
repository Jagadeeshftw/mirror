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
