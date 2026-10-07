// Feed items for owner levels and stops (engine feed: StopTriggered, LevelSet, MarketClosed, ClosedAll):
// titles in plain words and the close that ended a copied position.
import { price as fmtPrice, shortAddr } from "./format";
import type { FeedEvent, MarketConfig } from "./types";

export const STOP_FEED_KINDS = new Set(["StopTriggered", "LevelSet", "MarketClosed", "ClosedAll", "LeaderStopped"]);
export const isStopKind = (k: string) => STOP_FEED_KINDS.has(k);

const STOP_NAMES: Record<string, string> = {
  StopLoss: "Stop-loss",
  TakeProfit: "Take-profit",
  DailyLoss: "Daily loss stop",
  Drawdown: "Account loss stop",
  LeaderLoss: "Leader loss stop",
};
/** StopTriggered.kind -> "Take-profit" / "Stop-loss" / "Account loss stop" ... */
export const stopName = (e: Pick<FeedEvent, "reason" | "data">) => STOP_NAMES[String(e.reason ?? e.data?.kind ?? "")] ?? "Stop";
export const isLevelStop = (e: Pick<FeedEvent, "reason" | "data">) => /^(StopLoss|TakeProfit)$/.test(String(e.reason ?? e.data?.kind ?? ""));

const P = (m: MarketConfig | undefined, v: unknown) => (m && v !== undefined && v !== null ? fmtPrice(String(v), m.priceDecimals) : String(v ?? ""));

/** "Take-profit executed by 0x12…ab" (+ the level and the mark it fired at). */
export function stopTitle(e: FeedEvent): string {
  const who = e.keeper ? shortAddr(e.keeper) : "an address";
  return `${stopName(e)} executed by ${who}`;
}
export function stopDetail(e: FeedEvent, m: MarketConfig | undefined): string {
  if (!isLevelStop(e)) return `${e.data?.closed ?? e.positionsClosed ?? 0} position(s) closed, reduce-only`;
  return `${m?.symbol ?? ""} level ${P(m, e.limit ?? e.data?.limit)} · mark ${P(m, e.actual ?? e.data?.actual)} · reduce-only, caller paid nothing`.trim();
}

/** "BTC take-profit 141,456.0 · stop-loss 108,450.0" or "BTC levels cleared". */
export function levelSetTitle(e: FeedEvent, m: MarketConfig | undefined): string {
  const sl = String(e.data?.stopLossPNS ?? "0");
  const tp = String(e.data?.takeProfitPNS ?? "0");
  const sym = m?.symbol ?? "";
  if (sl === "0" && tp === "0") return `${sym} levels cleared`.trim();
  const parts = [tp !== "0" ? `take-profit ${P(m, tp)}` : null, sl !== "0" ? `stop-loss ${P(m, sl)}` : null].filter(Boolean);
  return `${sym} ${parts.join(" · ")}`.trim();
}

export function marketClosedTitle(e: FeedEvent, m: MarketConfig | undefined): string {
  const left = String(e.data?.lotsAfter ?? "0");
  return `Closed your ${m?.symbol ?? ""} position${left !== "0" ? " (partly filled)" : ""}`.replace("  ", " ");
}

/**
 * The event that closed a copied position after `copy`: a fired level or a market close in the same market,
 * or a close-all / account stop on the same account. Null while the position is still open or closed by the
 * leader's own close (a Mirrored close).
 */
export function closedBy(events: FeedEvent[], copy: FeedEvent): FeedEvent | null {
  const later = events
    .filter((x) => x.account.toLowerCase() === copy.account.toLowerCase() && x.timestamp >= copy.timestamp && x.id !== copy.id)
    .sort((a, b) => a.timestamp - b.timestamp || a.block - b.block);
  for (const x of later) {
    if (x.kind === "Mirrored" && x.perpId === copy.perpId && (x.orderType ?? 0) >= 2) return null;
    if (x.kind === "StopTriggered" && (isLevelStop(x) ? x.perpId === copy.perpId : true)) return x;
    if (x.kind === "MarketClosed" && x.perpId === copy.perpId) return x;
    if (x.kind === "ClosedAll") return x;
  }
  return null;
}
