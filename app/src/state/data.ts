// Data hooks over the API client (react-query). Polling is modest; live updates come over SSE.
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type LeaderSort, type LeaderWindow } from "../lib/api";
import { ausdBalance, publicClient } from "../lib/chain";
import { classifyError, FAST_FAIL_MS } from "../lib/conn";
import { readOwnFromRpc, type OwnSnapshot } from "../lib/watchRpc";
import { toBig } from "../lib/format";
import type { Address, AppConfig, FeedEvent, LeaderSummary, MarketConfig, MirrorAccount } from "../lib/types";
import { useSession } from "./session";
import { networkConfig } from "../lib/network";
import { cachedConfig, rpcConfig, saveConfigCache } from "./configCache";

// Bundled market list (symbol and decimals) for this build's network, used until /v1/config has loaded.
const bundledMarkets = (): MarketConfig[] => networkConfig().markets;

/** /v1/config, with the last good copy as a placeholder so Monad reads keep working while Mirror is down. */
export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => saveConfigCache(await api.config()),
    staleTime: 5 * 60_000,
    retry: 2,
    // The last good config stays as data when /v1/config fails (placeholderData is dropped on error, which
    // left the app without the RPC and markets exactly when Mirror is down). A device that never reached Mirror
    // starts from the bundled config for its build's network (EXPO_PUBLIC_NETWORK). Updated-at 0: refetched at once.
    initialData: cachedConfig() ?? networkConfig(),
    initialDataUpdatedAt: 0,
  });
}

export function useMarkets(cfg: AppConfig | undefined) {
  return useMemo(() => {
    const bySymbol = new Map<string, MarketConfig>();
    const byPerp = new Map<number, MarketConfig>();
    // Markets come from /v1/config (any network); the bundled list for this build's network is the offline fallback.
    for (const m of cfg?.markets?.length ? cfg.markets : bundledMarkets()) {
      bySymbol.set(m.symbol, { ...byPerp.get(m.perpId), ...m });
      byPerp.set(m.perpId, { ...byPerp.get(m.perpId), ...m });
    }
    return { bySymbol, byPerp };
  }, [cfg]);
}

/** Timeout for refreshing owner data that is already on screen. */
export const REFRESH_TIMEOUT_MS = 25_000;

export function useOwner() {
  const qc = useQueryClient();
  const { account } = useSession();
  const owner = account?.address as Address | undefined;
  return useQuery({
    queryKey: ["owner", owner],
    // The first load fails fast (FAST_FAIL_MS) so Home shows balances read from Monad instead of waiting on Mirror's
    // service. Refreshes of data already on screen get longer: on a rate-limited public RPC the engine's account view
    // can take several seconds, and a refresh that times out would leave a stale status showing.
    queryFn: () => api.ownerAccounts(owner!, qc.getQueryData(["owner", owner]) ? REFRESH_TIMEOUT_MS : FAST_FAIL_MS),
    enabled: !!owner,
    refetchInterval: 15_000,
    retry: 1,
    retryDelay: 3_000,
  });
}

/** AUSD in the owner's own wallet (EOA): Monad RPC first, API value as fallback. */
export function useWallet() {
  const { account } = useSession();
  const cfg = rpcConfig(useConfig().data);
  const owner = useOwner().data;
  const q = useQuery({
    queryKey: ["wallet", account?.address, cfg.rpc],
    queryFn: async () => (await ausdBalance(cfg, account!.address)).toString(),
    enabled: !!account && !!cfg.contracts.collateral,
    refetchInterval: 15_000,
    retry: 1,
  });
  const value = q.data ?? owner?.walletBalanceCNS ?? "0";
  return { cns: toBig(value), source: q.data ? "rpc" : "api", isLoading: q.isLoading && !owner, isError: q.isError && !q.data };
}

export interface Totals {
  balance: bigint;
  equity: bigint;
  upnl: bigint;
  realised: bigint;
  today: bigint;
  margin: bigint;
  withdrawable: bigint;
  wallet: bigint;
  deposited: bigint;
  accounts: MirrorAccount[];
  openPositions: number;
}

export function useTotals(): { totals: Totals | null; isLoading: boolean; isError: boolean; refetch: () => void; dataUpdatedAt: number } {
  const owner = useOwner();
  const wallet = useWallet();
  const totals = useMemo(() => {
    if (!owner.data) return null;
    const accts = owner.data.accounts.filter((a) => !a.teamRun);
    const sum = (f: (a: MirrorAccount) => string) => accts.reduce((s, a) => s + toBig(f(a)), 0n);
    const t: Totals = {
      wallet: wallet.cns,
      balance: wallet.cns + sum((a) => a.balanceCNS),
      equity: wallet.cns + sum((a) => a.equityCNS),
      upnl: sum((a) => a.pnl.unrealisedCNS),
      realised: sum((a) => a.pnl.realisedCNS),
      today: sum((a) => a.pnl.todayCNS),
      margin: sum((a) => a.marginCNS),
      withdrawable: sum((a) => a.withdrawableCNS),
      deposited: sum((a) => a.netDepositsCNS),
      accounts: accts,
      openPositions: accts.reduce((s, a) => s + a.positions.length, 0),
    };
    return t;
  }, [owner.data, wallet.cns]);
  return { totals, isLoading: owner.isLoading, isError: owner.isError, refetch: owner.refetch, dataUpdatedAt: owner.dataUpdatedAt };
}

export function useFeedAll() {
  const owner = useOwner();
  const accts = owner.data?.accounts ?? [];
  const results = useQueries({
    queries: accts.map((a) => ({
      queryKey: ["feed", a.account],
      queryFn: () => api.feed(a.account, null, FAST_FAIL_MS),
      refetchInterval: 30_000,
    })),
  });
  const events = useMemo(() => {
    const all: FeedEvent[] = [];
    const seen = new Set<string>();
    for (const r of results) for (const e of r.data?.events ?? []) if (!seen.has(e.id)) {
      seen.add(e.id);
      all.push(e);
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(",")]);
  const isError = results.some((r) => r.isError) || owner.isError;
  const error = owner.error ?? results.find((r) => r.error)?.error ?? null;
  const isLoading = owner.isLoading || results.some((r) => r.isLoading);
  const updatedAt = Math.max(0, ...results.map((r) => r.dataUpdatedAt));
  return { events, isError, error, isLoading, updatedAt, refetch: () => { void owner.refetch(); results.forEach((r) => r.refetch()); } };
}

export function useLeaders(window: LeaderWindow, sort: LeaderSort, market?: string) {
  return useQuery({ queryKey: ["leaders", window, sort, market ?? ""], queryFn: () => api.leaders(window, sort, market), staleTime: 60_000 });
}

export function useLeader(id: number, window: LeaderWindow = "30d") {
  return useQuery({ queryKey: ["leader", id, window], queryFn: () => api.leader(id, window), staleTime: 60_000, enabled: Number.isFinite(id) });
}

/** Address/labels lookup for leaders (used by feed rows). */
export function useLeaderDirectory(): Map<number, LeaderSummary> {
  const q = useLeaders("30d", "score");
  return useMemo(() => new Map((q.data ?? []).map((l) => [l.accountId, l])), [q.data]);
}

export function useDemo() {
  return useQuery({ queryKey: ["demo"], queryFn: () => api.demo(), refetchInterval: 10_000 });
}

/**
 * The owner's own follow accounts read straight from Monad (equity and latest copies), for when Mirror's service
 * is down: accounts found at the factory's CREATE2 addresses, logs read in 100-block chunks (bounded).
 */
export function useOwnRpc(enabled: boolean) {
  const { account } = useSession();
  const qc = useQueryClient();
  const cfg = rpcConfig(useConfig().data);
  const owner = account?.address as Address | undefined;
  const key = ["ownRpc", cfg.rpc, owner];
  return useQuery({
    queryKey: key,
    queryFn: () => readOwnFromRpc(publicClient(cfg) as any, cfg, owner!, { prev: qc.getQueryData<OwnSnapshot>(key) }),
    enabled: enabled && !!owner && !!cfg.contracts.factory && !!cfg.contracts.implementation,
    refetchInterval: 20_000,
    retry: 1,
  });
}

/**
 * The Feed's events: from Mirror's service, or (service down, nothing cached) the owner's own copies read straight
 * from Monad. `via` says which, so the screen labels it.
 */
export function useFeedView() {
  const feed = useFeedAll();
  const down = feed.isError && classifyError(feed.error).source === "mirror";
  const rpcMode = down && feed.events.length === 0;
  const own = useOwnRpc(rpcMode);
  return {
    ...feed,
    down,
    via: (rpcMode ? "rpc" : "api") as "rpc" | "api",
    events: rpcMode ? (own.data?.events ?? []) : feed.events,
    own,
  };
}
