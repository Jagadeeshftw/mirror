import type { Enum } from "envio";

export const CHAIN_ID = 143;
export const PERPL_EXCHANGE = "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F";
export const COLLATERAL_DECIMALS = 6;

/** keccak256("MIRROR_MATCH_NOW"): MirrorAccount.MATCH_NOW_REF, marks owner match-now orders. */
export const MATCH_NOW_REF = "0xba0016f6adaf21b42d77802a90dc5029b55fb1e05349c9553b7e1c7ed60e7d12";

/**
 * Perpl builder id MirrorAccount opening orders carry (MirrorAccount.BUILDER_ID). Perpl TakerOrderFilledV2
 * fills with this builder id are attached to copies. ENVIO_MIRROR_BUILDER_ID overrides it (see env.ts).
 */
export const MIRROR_BUILDER_ID = 26n;

/** Leader id used for follower lots that no Mirrored event attributed (owner/manual trades). */
export const UNATTRIBUTED_LEADER = "0";

export type MarketInfo = { symbol: string; lotDecimals: number; priceDecimals: number };

/**
 * Perpl markets on Monad mainnet (mirrors shared/config.json). ContractAdded/ContractAddedV2 events
 * override or extend this table at runtime, so new markets are picked up without a redeploy.
 */
export const MARKETS: Record<number, MarketInfo> = {
  1: { symbol: "BTC", lotDecimals: 5, priceDecimals: 1 },
  10: { symbol: "MON", lotDecimals: 0, priceDecimals: 6 },
  20: { symbol: "ETH", lotDecimals: 3, priceDecimals: 2 },
  31: { symbol: "SOL", lotDecimals: 3, priceDecimals: 3 },
  40: { symbol: "HYPE", lotDecimals: 2, priceDecimals: 4 },
  50: { symbol: "ZEC", lotDecimals: 4, priceDecimals: 2 },
  60: { symbol: "LIT", lotDecimals: 1, priceDecimals: 5 },
  70: { symbol: "VVV", lotDecimals: 2, priceDecimals: 4 },
  90: { symbol: "PUMP", lotDecimals: 0, priceDecimals: 6 },
  100: { symbol: "NEAR", lotDecimals: 2, priceDecimals: 4 },
  110: { symbol: "UNI", lotDecimals: 2, priceDecimals: 4 },
};

/** MirrorAccount.BlockReason in Solidity declaration order. */
export const BLOCK_REASONS: readonly Enum<"BlockReason">[] = [
  "None",
  "Paused",
  "Expired",
  "LeaderNotAllowed",
  "LeaderSideMismatch",
  "MarketNotAllowed",
  "LeverageTooHigh",
  "SlippageTooHigh",
  "FlipNotAllowed",
  "StaleMark",
  "ExceedsLeaderTarget",
  "ExceedsMaxNotional",
  "DailyLossStop",
  "DrawdownStop",
  "LeverageTooLow",
  "EntryTooFar",
  "MarketHeldByOtherLeader",
  "LeaderBudgetExceeded",
  "LeaderLossStop",
  "MarketHalted",
  "CloseBelowTarget",
  "BuilderFeeTooHigh",
  "LeaderDetached",
];

export function blockReason(code: number): Enum<"BlockReason"> {
  return BLOCK_REASONS[code] ?? "Unknown";
}

/** MirrorAccount.StopKind in Solidity declaration order. */
export const STOP_KINDS: readonly Enum<"StopKind">[] = ["DailyLoss", "Drawdown", "LeaderLoss", "StopLoss", "TakeProfit"];

export function stopKind(code: number): Enum<"StopKind"> {
  return STOP_KINDS[code] ?? "Unknown";
}

/** Stop kinds whose scope is a perpId (owner levels). */
export function isLevelStop(kind: Enum<"StopKind">): boolean {
  return kind === "StopLoss" || kind === "TakeProfit";
}

export const ORDER_TYPES: readonly Enum<"MirrorOrderType">[] = [
  "OPEN_LONG",
  "OPEN_SHORT",
  "CLOSE_LONG",
  "CLOSE_SHORT",
];

export function orderType(code: number): Enum<"MirrorOrderType"> {
  return ORDER_TYPES[code] ?? "OPEN_LONG";
}

export function sideOf(positionType: bigint | number): Enum<"Side"> {
  return Number(positionType) === 1 ? "SHORT" : "LONG";
}

export const WINDOWS: readonly { window: Enum<"StatsWindow">; days: number }[] = [
  { window: "D7", days: 7 },
  { window: "D30", days: 30 },
  { window: "D90", days: 90 },
];

/**
 * Team-run accounts known at build time, mirroring `networks.mainnet.teamRun` in shared/config.json
 * (demo leader EOA and Perpl id, demo follower MirrorAccount). Fill these in when the demo accounts are
 * created; ENVIO_TEAM_RUN_ADDRESSES / ENVIO_TEAM_RUN_ACCOUNT_IDS add to them at runtime.
 */
export const TEAM_RUN_ADDRESSES: readonly string[] = [];
export const TEAM_RUN_ACCOUNT_IDS: readonly bigint[] = [];

export const SCOPE_GLOBAL = "global";
export const SCOPE_TEAM_RUN = "teamRun";
