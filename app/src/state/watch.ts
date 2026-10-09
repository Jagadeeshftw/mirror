// Watch mode: the team-run demo follower's real copies. From the Mirror backend when it answers
// (with live demo cycles over SSE), otherwise read straight from Monad, with the Run buttons off.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, streamUrl } from "../lib/api";
import { failTitle } from "../lib/conn";
import { indexerUrl, serviceDownLine } from "../lib/network";
import { readWatchFromIndexer } from "../lib/watchIndexer";
import { publicClient } from "../lib/chain";
import { openSse } from "../lib/sse";
import type { Address, DemoCycle, DemoState, FeedEvent, FeedPage, MirrorAccount } from "../lib/types";
import { DEFAULT_SCAN_BLOCKS, DOWN_SCAN_BLOCKS, readWatchFromRpc, scannedMinutes, type WatchSnapshot } from "../lib/watchRpc";
import { rpcConfig } from "./configCache";
import { useConfig, useDemo } from "./data";
import { applyCommit, applyFeedEvent } from "./live";

/** Demo cycle progress and the demo follower's feed over /v1/stream?account=demo. */
export function useDemoStream(enabled = true): boolean {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const h = openSse(streamUrl("demo"), {
      onOpen: () => setLive(true),
      onError: () => setLive(false),
      onMessage: (m) => {
        if (m.event === "demo") {
          const cy = JSON.parse(m.data) as DemoCycle;
          qc.setQueryData<DemoState>(["demo"], (old) => (old ? { ...old, busy: cy.status === "running", cycles: [cy, ...old.cycles.filter((x) => x.id !== cy.id)] } : old));
          if (cy.status !== "running") qc.invalidateQueries({ queryKey: ["demo"] });
        } else if (m.event === "feed") {
          applyFeedEvent(qc, JSON.parse(m.data) as FeedEvent);
          qc.invalidateQueries({ queryKey: ["demo"] });
        } else if (m.event === "commit") {
          const acct = qc.getQueryData<DemoState>(["demo"])?.follower.account;
          if (acct) applyCommit(qc, acct, JSON.parse(m.data));
        } else if (m.event === "hello") setLive(true);
      },
    });
    return () => h.close();
  }, [qc, enabled]);
  return live;
}

export interface WatchData {
  source: "api" | "rpc" | "none";
  /** Where this view reads from: Mirror's service, or straight from Monad (service down). */
  via: "api" | "rpc";
  account: Address | null;
  follower: MirrorAccount | null;
  equityCNS: string | null;
  events: FeedEvent[];
  cycles: DemoCycle[];
  busy: boolean;
  limits: DemoState["limits"] | null;
  leaderAccountId: number | null;
  block: number | null;
  readAt: number | null;
  /** RPC reads: minutes of blocks scanned for the copies shown (for "No copies in the last N minutes"). */
  scannedMinutes: number | null;
  /** RPC reads: the read failed (Monad unreachable). */
  rpcError: boolean;
  /** Where the history in `events` came from when the engine is down: Mirror's indexer (plus the newest blocks from
   *  Monad), or Monad alone (a bounded scan of the last minutes). */
  history?: "indexer" | "rpc";
  isLoading: boolean;
}

export function useWatch(opts: { backendDown?: boolean } = {}): WatchData {
  const qc = useQueryClient();
  const cfg = useConfig().data;
  const demo = useDemo();
  const d = demo.data;
  const apiAccount = d?.follower.account;
  const feed = useQuery({ queryKey: ["feed", apiAccount ?? "demo"], queryFn: () => api.feed(apiAccount!), enabled: !!apiAccount && !opts.backendDown, refetchInterval: 20_000 });
  const rc = rpcConfig(cfg);
  const rpcAccount = (rc.teamRun?.demoFollowerAccount ?? null) as Address | null;
  const useRpc = !!opts.backendDown || (demo.isError && !d);
  // With Mirror's service down the scan goes further back (bounded: at most 28 eth_getLogs calls); refreshes
  // only scan the blocks since the previous read.
  const maxBlocks = opts.backendDown ? DOWN_SCAN_BLOCKS : DEFAULT_SCAN_BLOCKS;
  const key = ["watchRpc", rc.rpc, rpcAccount, maxBlocks];
  const rpc = useQuery({
    queryKey: key,
    queryFn: () => readWatchFromRpc(publicClient(rc) as any, rpcAccount!, { maxBlocks, prev: qc.getQueryData<WatchSnapshot>(key) }),
    enabled: useRpc && !!rpcAccount,
    refetchInterval: 10_000,
    retry: 1,
  });
  const idxUrl = indexerUrl();
  const idx = useQuery({
    queryKey: ["watchIndexer", idxUrl, rpcAccount],
    queryFn: () => readWatchFromIndexer(idxUrl!, rpcAccount!, 30),
    enabled: useRpc && !!idxUrl && !!rpcAccount,
    refetchInterval: 15_000,
    retry: 0,
  });
  if (useRpc) {
    // The indexer's history, topped up with the newest blocks read from Monad (the indexer can trail by seconds).
    const fromRpc = rpc.data?.events ?? [];
    const seen = new Set(fromRpc.map((e) => `${e.txHash}-${e.kind}`));
    const merged = [...fromRpc, ...(idx.data ?? []).filter((e) => !seen.has(`${e.txHash}-${e.kind}`))].sort((a, b) => b.timestamp - a.timestamp);
    return {
      source: rpc.data || idx.data ? "rpc" : "none",
      via: "rpc",
      history: idx.data?.length ? "indexer" : "rpc",
      account: rpcAccount,
      follower: null,
      equityCNS: rpc.data?.equityCNS ?? null,
      events: merged,
      cycles: [],
      busy: false,
      limits: null,
      leaderAccountId: rc.teamRun?.demoLeaderAccountId ?? null,
      block: rpc.data?.block ?? null,
      readAt: rpc.data?.readAt ?? null,
      scannedMinutes: rpc.data ? scannedMinutes(rpc.data) : null,
      rpcError: rpc.isError && !rpc.data && !idx.data?.length,
      isLoading: rpc.isLoading && idx.isLoading && !!rpcAccount,
    };
  }
  const events = ((feed.data as FeedPage | undefined)?.events ?? []).filter((e) => e.kind === "Mirrored" || e.kind === "Blocked" || e.kind === "EngineShrunk" || e.kind === "EngineSkipped");
  return {
    source: d ? "api" : "none",
    via: "api",
    account: apiAccount ?? null,
    follower: d?.follower ?? null,
    equityCNS: d?.follower.equityCNS ?? null,
    events,
    cycles: d?.cycles ?? [],
    busy: !!d?.busy || !!d?.cycles.some((c) => c.status === "running"),
    limits: d?.limits ?? null,
    leaderAccountId: d?.leader.accountId ?? null,
    block: null,
    readAt: demo.dataUpdatedAt || null,
    scannedMinutes: null,
    rpcError: false,
    isLoading: demo.isLoading,
  };
}

export type RunError = { title: string; body: string; until?: number };

/** Starts a demo or blocked cycle; maps rate limits and conflicts to plain messages. */
export function useRunDemo() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"trade" | "blocked" | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const run = useCallback(
    async (kind: "trade" | "blocked") => {
      setError(null);
      setBusy(kind);
      try {
        kind === "trade" ? await api.demoTrade() : await api.demoBlocked();
        qc.invalidateQueries({ queryKey: ["demo"] });
      } catch (e) {
        if (e instanceof ApiError) {
          const until = e.retryAfterSec ? Date.now() + e.retryAfterSec * 1000 : undefined;
          if (e.status === 429) setError({ title: e.code === "daily_cap" ? "Today's demo budget is used up" : "Demo limit reached", body: e.message, until });
          else if (e.status === 409) setError({ title: "A demo is already running", body: e.message, until });
          else if (e.isNetwork) setError({ title: failTitle("mirror"), body: `${serviceDownLine()}. Starting a demo needs it; the copies shown are read straight from Monad.` });
          else setError({ title: "Demo didn't start", body: e.message });
        } else setError({ title: "Demo didn't start", body: String(e) });
      } finally {
        setBusy(null);
      }
    },
    [qc],
  );
  return { run, busy, error };
}
