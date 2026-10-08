// Last good /v1/config, kept on the device. When the Mirror backend is down the app still knows the
// Monad RPC, the contracts and the team-run demo follower, so balances and watch mode read from Monad. A device
// that never reached it falls back to the bundled config for the build's network (lib/network.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeConfig } from "../lib/config";
import { networkConfig } from "../lib/network";
import type { AppConfig } from "../lib/types";

const KEY = "mirror.config.cache.v1";
let cache: AppConfig | null = null;

export async function loadConfigCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cache = normalizeConfig(JSON.parse(raw));
  } catch {}
}

export function cachedConfig(): AppConfig | null {
  return cache;
}

export function saveConfigCache(cfg: AppConfig): AppConfig {
  cache = cfg;
  AsyncStorage.setItem(KEY, JSON.stringify(cfg)).catch(() => {});
  return cfg;
}

/**
 * Config good enough for Monad reads and display: live, else the last good copy on this device, else the
 * bundled config for this build's network (EXPO_PUBLIC_NETWORK), so a fresh device with Mirror's service down
 * still knows the right RPC, contracts, markets, explorer and demo follower.
 */
export function rpcConfig(cfg: AppConfig | undefined | null): AppConfig {
  return cfg ?? cache ?? networkConfig();
}
