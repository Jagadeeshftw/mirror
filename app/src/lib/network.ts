// Build-time network (EXPO_PUBLIC_NETWORK: mainnet | testnet | localnet; default mainnet). The engine's
// /v1/config stays the source of truth whenever it answers; this is what a device knows when it never has:
// a fresh install with Mirror's service down still has the right Monad RPC, contracts, markets, explorer
// and team-run demo follower for the network it was built for (shared/config.json networks[NETWORK]).
// EXPO_PUBLIC_NETWORK_CONFIG (optional JSON in the /v1/config shape) overrides fields of that entry; the
// localnet web e2e uses it, since localnet addresses change on every run.
import shared from "./shared-config.json";
import { normalizeConfig } from "./config";
import type { AppConfig } from "./types";

export type NetworkName = "mainnet" | "testnet" | "localnet";
export const NETWORKS: NetworkName[] = ["mainnet", "testnet", "localnet"];

export function resolveNetwork(v: string | undefined | null): NetworkName {
  const s = String(v ?? "").trim().toLowerCase();
  return (NETWORKS as string[]).includes(s) ? (s as NetworkName) : "mainnet";
}

// Direct property access: Expo inlines EXPO_PUBLIC_* only when written out like this.
export const NETWORK: NetworkName = resolveNetwork(process.env.EXPO_PUBLIC_NETWORK);
const NETWORK_CONFIG_JSON: string | undefined = process.env.EXPO_PUBLIC_NETWORK_CONFIG;

/** Localnet defaults (localnet/start.mjs); addresses come from EXPO_PUBLIC_NETWORK_CONFIG. */
const LOCALNET_BASE = { chainId: 1337, rpc: "http://127.0.0.1:8546", markets: [] as unknown[] };

function parseOverride(json: string | undefined | null): Record<string, any> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/** The bundled config for `name`, in the same normalised shape as /v1/config. */
export function bundledConfig(name: NetworkName = NETWORK, overrideJson: string | undefined | null = NETWORK_CONFIG_JSON): AppConfig {
  const n: any = name === "localnet" ? LOCALNET_BASE : (shared.networks as any)[name];
  const o = parseOverride(overrideJson);
  const raw = {
    chainId: n.chainId,
    rpc: n.rpc,
    explorerTx: n.explorerTx,
    explorerAddress: n.explorerAddress,
    collateralDecimals: n.collateralDecimals ?? 6,
    minAccountOpenCNS: n.minAccountOpenCNS,
    // Per-account deposit cap (the factory's DEPOSIT_CAP): 200 test AUSD on testnet, 25 AUSD planned on mainnet.
    depositCapCNS: n.depositCapCNS,
    markets: n.markets ?? [],
    ...o,
    contracts: {
      factory: n.mirror?.factory ?? null,
      implementation: n.mirror?.implementation ?? null,
      keeperRegistry: n.mirror?.keeperRegistry ?? null,
      deployBlock: n.mirror?.deployBlock ?? null,
      perplExchange: n.perplExchange,
      collateral: n.collateral,
      ...(o.contracts ?? {}),
    },
    teamRun: { ...(n.teamRun ?? {}), ...(o.teamRun ?? {}) },
  };
  return normalizeConfig(raw);
}

let memo: AppConfig | null = null;
/** bundledConfig() for this build's network, computed once. */
export function networkConfig(): AppConfig {
  return (memo ??= bundledConfig());
}

/** "Mirror's testnet service" on testnet builds, "Mirror's service" elsewhere. */
export function serviceName(name: NetworkName = NETWORK): string {
  return name === "testnet" ? "Mirror's testnet service" : "Mirror's service";
}

/** One line on why something that needs Mirror's service can't run right now. */
export function serviceDownLine(name: NetworkName = NETWORK): string {
  return name === "testnet" ? "Mirror's testnet service isn't live yet" : "Mirror's service isn't reachable right now";
}
