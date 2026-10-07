// Plain names for every reason a copy can be refused: the contract's BlockReason enum, the engine's
// thin-book guard, and the backtest's skipped events. Used by the feed, the blocked detail and the what-if.
import { bps, leverage, ausd } from "./format";
import type { Policy } from "./types";

export const RULE_NAMES: Record<string, string> = {
  LeverageTooHigh: "Max leverage",
  LeverageTooLow: "Leverage safety",
  MarketNotAllowed: "Market not allowed",
  ExceedsMaxNotional: "Max notional",
  SlippageTooHigh: "Max slippage",
  DailyLossStop: "Daily loss stop",
  DrawdownStop: "Account loss stop",
  Paused: "Paused",
  Expired: "Expired",
  LeaderNotAllowed: "Leader not followed",
  LeaderSideMismatch: "Leader position changed",
  FlipNotAllowed: "No flip",
  StaleMark: "Stale price",
  ExceedsLeaderTarget: "Copy ratio",
  EntryTooFar: "Entry filter",
  MarketHeldByOtherLeader: "Market held by another leader",
  LeaderBudgetExceeded: "Budget",
  LeaderLossStop: "Leader loss stop",
  MarketHalted: "Market halted by a stop",
  CloseBelowTarget: "Close below target",
  BuilderFeeTooHigh: "Fee cap",
  LeaderDetached: "Stopped following this leader (positions kept)",
  ThinBook: "Thin book",
  BookUnavailable: "Book unavailable",
  LeaderSizeOrPriceUnknown: "Leader size or price unknown",
};

export function ruleName(reason: string): string {
  return RULE_NAMES[reason] ?? reason.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** "Max leverage 5x", "Entry filter 1%", "Max notional 6.00": the rule with the user's own number when known. */
export function ruleWithLimit(reason: string, policy?: Pick<Policy, "maxLeverageHdths" | "maxEntryDeviationBps" | "maxSlippageBps" | "markets" | "dailyLossBps" | "drawdownBps"> | null): string {
  const name = ruleName(reason);
  if (!policy) return name;
  switch (reason) {
    case "LeverageTooHigh":
      return `${name} ${leverage(policy.maxLeverageHdths)}`;
    case "EntryTooFar":
      return policy.maxEntryDeviationBps ? `${name} ${bps(policy.maxEntryDeviationBps)}` : name;
    case "SlippageTooHigh":
      return `${name} ${bps(policy.maxSlippageBps)}`;
    case "ExceedsMaxNotional":
      return policy.markets[0] ? `${name} ${ausd(policy.markets[0].maxNotionalCNS)}` : name;
    case "DailyLossStop":
      return `${name} ${bps(policy.dailyLossBps)}`;
    case "DrawdownStop":
      return `${name} ${bps(policy.drawdownBps)}`;
    default:
      return name;
  }
}

/** Engine-side (offchain) guard events never have a transaction. */
export function isEngineKind(kind: string): boolean {
  return kind === "EngineShrunk" || kind === "EngineSkipped";
}
