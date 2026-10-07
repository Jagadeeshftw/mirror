// Alerts preference. The Android/browser notification permission is asked only when the user turns
// alerts on: in Settings, or from the card shown after the first follow. Never right after sign-up.
import { useCallback, useEffect, useState } from "react";
import { registerForPush, unregisterPush, type PushRegistration } from "../lib/push";
import type { Address } from "../lib/types";
import { getAlertsPref, setAlertsPref, type AlertsPref } from "./alertsPref";

export { getAlertsPref } from "./alertsPref";

export function useAlerts(owner?: Address) {
  const [pref, setPref] = useState<AlertsPref>("unset");
  const [permission, setPermission] = useState<string>("undetermined");
  const [reg, setReg] = useState<PushRegistration | null>(null);
  useEffect(() => {
    getAlertsPref().then(setPref);
  }, []);
  const turnOn = useCallback(async () => {
    setPref("on");
    await setAlertsPref("on");
    if (!owner) return;
    const r = await registerForPush(owner, { ask: true });
    setPermission(r.permission);
    setReg(r);
  }, [owner]);
  const turnOff = useCallback(async () => {
    setPref("off");
    await setAlertsPref("off");
    if (owner) await unregisterPush(owner).catch(() => {});
  }, [owner]);
  return { pref, on: pref === "on", permission, registration: reg, turnOn, turnOff };
}
