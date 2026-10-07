// Last good /v1/config, kept on the device. When the Mirror backend is down the app still knows the
// Monad RPC, the contracts and the team-run demo follower, so balances and watch mode read from Monad.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MAINNET } from "../lib/chain";
import { normalizeConfig } from "../lib/config";
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

/** Config good enough for Monad reads: live, else cached, else the bundled mainnet values. */
export function rpcConfig(cfg: AppConfig | undefined | null): Pick<AppConfig, "rpc" | "chainId" | "contracts" | "teamRun"> {
  const c = cfg ?? cache;
  if (c) return c;
  return {
    rpc: MAINNET.rpc,
    chainId: MAINNET.chainId,
    contracts: { factory: null, implementation: null, keeperRegistry: null, perplExchange: MAINNET.perplExchange as any, collateral: MAINNET.collateral as any },
    teamRun: MAINNET.teamRun as any,
  };
}
