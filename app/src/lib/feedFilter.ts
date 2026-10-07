import type { FeedEvent } from "./types";

export type Filter = "all" | "copied" | "blocked" | "closes";

export function matchesFilter(e: FeedEvent, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "copied") return e.kind === "Mirrored" && (e.orderType ?? 0) <= 1;
  if (filter === "blocked") return e.kind === "Blocked" || e.kind === "EngineSkipped" || e.kind === "EngineShrunk";
  // Closes: the leader's copied closes, fired levels and stops, and closes you made yourself.
  return (e.kind === "Mirrored" && (e.orderType ?? 0) >= 2) || e.kind === "StopTriggered" || e.kind === "MarketClosed" || e.kind === "ClosedAll";
}
