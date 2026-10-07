// Alerts preference. The Android/browser notification permission is asked only when the user turns
// alerts on: in Settings, or from the card shown after the first follow. Never right after sign-up.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { registerForPush } from "../lib/push";
import type { Address } from "../lib/types";

const KEY = "mirror.alerts.v1";
type Pref = "on" | "off" | "unset";

export async function getAlertsPref(): Promise<Pref> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "unset";
  } catch {
    return "unset";
  }
}

export function useAlerts(owner?: Address) {
  const [pref, setPref] = useState<Pref>("unset");
  const [permission, setPermission] = useState<string>("undetermined");
  useEffect(() => {
    getAlertsPref().then(setPref);
  }, []);
  const turnOn = useCallback(async () => {
    setPref("on");
    await AsyncStorage.setItem(KEY, "on").catch(() => {});
    if (owner) setPermission((await registerForPush(owner, { ask: true })).permission);
  }, [owner]);
  const turnOff = useCallback(async () => {
    setPref("off");
    await AsyncStorage.setItem(KEY, "off").catch(() => {});
  }, []);
  return { pref, on: pref === "on", permission, turnOn, turnOff };
}
