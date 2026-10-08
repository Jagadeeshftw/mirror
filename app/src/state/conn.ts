// Connection state, checked separately for each side: the Mirror backend (API) and Monad (RPC).
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { blockNumber } from "../lib/chain";
import { backendPhase, classifyError, FAST_FAIL_MS, relayGate, type BackendPhase, type RelayGate } from "../lib/conn";
import { useConfig, useOwner } from "./data";
import { rpcConfig } from "./configCache";

/** Re-renders every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/** Monad RPC, checked directly from this device. */
export function useRpcHealth(intervalMs = 30_000) {
  const cfg = rpcConfig(useConfig().data);
  return useQuery({
    queryKey: ["rpcHealth", cfg.rpc],
    queryFn: async () => ({ ...(await blockNumber(cfg as any)), host: hostOf(cfg.rpc), at: Date.now() }),
    refetchInterval: intervalMs,
    retry: 0,
  });
}

/** The Mirror server's own health endpoint, timed from this device. */
export function useMirrorHealth(intervalMs = 30_000) {
  return useQuery({
    queryKey: ["mirrorHealth"],
    queryFn: async () => {
      const t0 = Date.now();
      const h = await api.health(FAST_FAIL_MS);
      return { ...h, ms: Date.now() - t0, at: Date.now() };
    },
    refetchInterval: intervalMs,
    retry: 0,
  });
}

export function hostOf(url: string): string {
  return url.replace(/^\w+:\/\//, "").replace(/\/.*$/, "");
}

/** Phase of the owner's account load from Mirror: connecting (5 s), slow (to 30 s), down, or ok. */
export function useBackendPhase(): { phase: BackendPhase; waitedMs: number; retry: () => void } {
  const owner = useOwner();
  const since = useRef(Date.now());
  const err = owner.failureReason ?? owner.error;
  const failed = owner.failureCount > 0 && !!err && classifyError(err).source === "mirror";
  const hasData = !!owner.data;
  const now = useNow(!hasData || failed);
  const phase = backendPhase({ hasData, failed: failed && (owner.isError || owner.failureCount > 0), since: since.current, now });
  return {
    phase,
    waitedMs: now - since.current,
    retry: () => {
      since.current = Date.now();
      void owner.refetch();
    },
  };
}

/**
 * Whether actions that need the relayer (follow, deposit, withdraw, send) can run. Buttons stay disabled with the
 * reason while Mirror's service doesn't answer, so no passkey prompt is shown for something that can't be sent.
 */
export function useRelayGate(): RelayGate {
  const h = useMirrorHealth(15_000);
  return relayGate({ ok: !!h.data && !h.isError, failed: h.isError, checking: h.isLoading });
}
