// Which side failed, and how long we have waited. "Can't reach Mirror" is only for our backend
// (API errors); "Can't reach Monad" is only for the RPC (viem errors). Never mixed up.
import { ApiError } from "./api";

export type FailSource = "mirror" | "monad" | "other";
export type FailKind = "network" | "timeout" | "http" | "rate" | "unavailable" | "unknown";

export function classifyError(e: unknown): { source: FailSource; kind: FailKind; status?: number } {
  if (e instanceof ApiError || (e as any)?.name === "ApiError") {
    const status = (e as ApiError).status;
    if (status === 0) return { source: "mirror", kind: (e as ApiError).code === "timeout" ? "timeout" : "network", status };
    if (status === 429) return { source: "mirror", kind: "rate", status };
    if (status === 503) return { source: "mirror", kind: "unavailable", status };
    if (status >= 500) return { source: "mirror", kind: "http", status };
    return { source: "mirror", kind: "http", status };
  }
  const name = String((e as any)?.name ?? "");
  const msg = String((e as any)?.shortMessage ?? (e as any)?.message ?? "");
  if (/TimeoutError/.test(name) || /timed out|took too long/i.test(msg)) return { source: "monad", kind: "timeout" };
  if (/HttpRequestError|RpcRequestError|RpcError|WebSocketRequestError|ContractFunctionExecutionError|CallExecutionError/.test(name) || /HTTP request failed|fetch failed/i.test(msg)) {
    return { source: "monad", kind: "network" };
  }
  return { source: "other", kind: "unknown" };
}

export function failTitle(source: FailSource): string {
  return source === "monad" ? "Can't reach Monad" : source === "mirror" ? "Can't reach Mirror" : "Something went wrong";
}

export type BackendPhase = "ok" | "connecting" | "slow" | "down";
export const SLOW_AFTER_MS = 5_000;
export const DOWN_AFTER_MS = 30_000;

/**
 * Phase of the first answer from the Mirror backend.
 * - data and no failure: ok
 * - a definite failure (refused, 5xx, timeout): down, even with stale data (shown with a banner)
 * - no answer yet: connecting for 5 s, then slow, then down after 30 s
 */
export function backendPhase(s: { hasData: boolean; failed: boolean; since: number; now: number }): BackendPhase {
  if (s.failed) return "down";
  if (s.hasData) return "ok";
  const waited = s.now - s.since;
  if (waited < SLOW_AFTER_MS) return "connecting";
  if (waited < DOWN_AFTER_MS) return "slow";
  return "down";
}
