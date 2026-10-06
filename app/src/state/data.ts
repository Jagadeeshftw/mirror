// Data hooks over the API client (react-query). Polling is modest; live updates come over SSE.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, type LeaderSort, type LeaderWindow } from "../lib/api";
import { ausdBalance } from "../lib/chain";
import { toBig } from "../lib/format";
import type { Address, AppConfig, FeedEvent, LeaderSummary, MarketConfig, MirrorAccount } from "../lib/types";
import { useSession } from "./session";

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: 5 * 60_000, retry: 2 });
}

export function useMarkets(cfg: AppConfig | undefined) {
  return useMemo(() => {
    const bySymbol = new Map<string, MarketConfig>();
    const byPerp = new Map<number, MarketConfig>();
    for (const m of cfg?.markets ?? []) {
      bySymbol.set(m.symbol, m);
      byPerp.set(m.perpId, m);
    }
    return { bySymbol, byPerp };
  }, [cfg]);
}

export function useOwner() {
  const { account } = useSession();
  const owner = account?.address as Address | undefined;
  return useQuery({
    queryKey: ["owner", owner],
    queryFn: () => api.ownerAccounts(owner!),
    enabled: !!owner,
    refetchInterval: 15_000,
  });
}

/** AUSD in the owner's own wallet (EOA): Monad RPC first, API value as fallback. */
export function useWallet() {
  const { account } = useSession();
  const cfg = useConfig().data;
  const owner = useOwner().data;
  const q = useQuery({
    queryKey: ["wallet", account?.address, cfg?.rpc],
    queryFn: async () => (await ausdBalance(cfg!, account!.address)).toString(),
    enabled: !!cfg && !!account,
    refetchInterval: 15_000,
    retry: 1,
  });
  const value = q.data ?? owner?.walletBalanceCNS ?? "0";
  return { cns: toBig(value), source: q.data ? "rpc" : "api", isLoading: q.isLoading && !owner };
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
      queryFn: () => api.feed(a.account),
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
  const isLoading = owner.isLoading || results.some((r) => r.isLoading);
  const updatedAt = Math.max(0, ...results.map((r) => r.dataUpdatedAt));
  return { events, isError, isLoading, updatedAt, refetch: () => results.forEach((r) => r.refetch()) };
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
  return useQuery({ queryKey: ["demo"], queryFn: api.demo, refetchInterval: 10_000 });
}
