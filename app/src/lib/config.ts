// Network config from GET /v1/config, normalised. The engine is the source of truth for chain id, RPC,
// contracts, markets and team-run accounts, so one build runs against localnet (1337), a mainnet fork,
// testnet (10143) and mainnet. The bundled shared-config is only the fallback when the API is unreachable.
import type { AppConfig, MarketConfig } from "./types";

export const TESTNET_CHAIN_ID = 10143;

export function normalizeConfig(raw: any): AppConfig {
  const c = raw?.contracts ?? {};
  const t = raw?.teamRun ?? {};
  return {
    chainId: Number(raw.chainId),
    rpc: String(raw.rpc),
    explorerTx: raw.explorerTx ?? "https://monadvision.com/tx/",
    explorerAddress: raw.explorerAddress ?? "https://monadvision.com/address/",
    contracts: {
      factory: c.factory ?? null,
      implementation: c.implementation ?? null,
      keeperRegistry: c.keeperRegistry ?? null,
      perplExchange: c.perplExchange,
      collateral: c.collateral,
      deployBlock: c.deployBlock ?? null,
    },
    collateralDecimals: Number(raw.collateralDecimals ?? 6),
    depositCapCNS: String(raw.depositCapCNS ?? "25000000"),
    minAccountOpenCNS: String(raw.perplMinAccountOpenCNS ?? raw.minAccountOpenCNS ?? "10000000"),
    markets: (raw.markets ?? []) as MarketConfig[],
    teamRun: {
      addresses: t.addresses ?? [t.demoLeaderAddress, t.demoFollowerAccount].filter(Boolean),
      demoLeaderAddress: t.demoLeaderAddress ?? null,
      demoLeaderAccountId: t.demoLeaderAccountId ?? null,
      demoFollowerAccount: t.demoFollowerAccount ?? null,
    },
  };
}

/** "test AUSD" on Monad testnet, "AUSD" everywhere else. */
export function ausdUnit(chainId: number | undefined | null): string {
  return chainId === TESTNET_CHAIN_ID ? "test AUSD" : "AUSD";
}
