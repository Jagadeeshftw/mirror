// Local history of decrypted notifications (never leaves the device) + "last seen" marker.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import type { PushPayload } from "../lib/types";

const KEY = "mirror.notifications.v1";
const SEEN_KEY = "mirror.notifications.seen.v1";
let cache: PushPayload[] | null = null;
const subs = new Set<(l: PushPayload[]) => void>();

async function load(): Promise<PushPayload[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]");
  } catch {
    cache = [];
  }
  return cache!;
}

export async function addNotification(p: PushPayload) {
  const list = await load();
  if (p.eventId && list.some((x) => x.eventId === p.eventId)) return;
  cache = [p, ...list].slice(0, 200);
  await AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
  subs.forEach((s) => s(cache!));
}

export function useNotificationHistory(): PushPayload[] {
  const [list, setList] = useState<PushPayload[]>(cache ?? []);
  useEffect(() => {
    load().then(setList);
    subs.add(setList);
    return () => {
      subs.delete(setList);
    };
  }, []);
  return list;
}

export async function getLastSeen(): Promise<number> {
  return Number((await AsyncStorage.getItem(SEEN_KEY)) ?? 0);
}
export async function setLastSeen(t = Date.now()) {
  await AsyncStorage.setItem(SEEN_KEY, String(t)).catch(() => {});
}
