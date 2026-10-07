import type { Hex } from 'viem';

export const LONG = 0;
export const SHORT = 1;
export type Side = typeof LONG | typeof SHORT;

export const OPEN_LONG = 0;
export const OPEN_SHORT = 1;
export const CLOSE_LONG = 2;
export const CLOSE_SHORT = 3;

export const ORDER_TYPE_NAMES = ['OpenLong', 'OpenShort', 'CloseLong', 'CloseShort'] as const;

/** Mirrors MirrorAccount.BlockReason (index = enum value). */
export const BLOCK_REASONS = [
  'None',
  'Paused',
  'Expired',
  'LeaderNotAllowed',
  'LeaderSideMismatch',
  'MarketNotAllowed',
  'LeverageTooHigh',
  'SlippageTooHigh',
  'FlipNotAllowed',
  'StaleMark',
  'ExceedsLeaderTarget',
  'ExceedsMaxNotional',
  'DailyLossStop',
  'DrawdownStop',
  'LeverageTooLow',
  'EntryTooFar',
  'MarketHeldByOtherLeader',
  'LeaderBudgetExceeded',
  'LeaderLossStop',
  'MarketHalted',
  'CloseBelowTarget',
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const ACTION = {
  SET_POLICY: 1,
  SET_PAUSED: 2,
  CLOSE_ALL: 3,
  WITHDRAW: 4,
  EXCHANGE_CALL: 5,
  SWEEP: 6,
  FOLLOW: 7,
  MATCH_NOW: 8,
  SET_LEVELS: 9,
  CLOSE_MARKET: 10,
} as const;

/** Mirrors MirrorAccount.StopKind (index = enum value). */
export const STOP_KINDS = ['DailyLoss', 'Drawdown', 'LeaderLoss', 'StopLoss', 'TakeProfit'] as const;
export type StopKind = (typeof STOP_KINDS)[number];

export interface MirrorOrder {
  leaderAccountId: number;
  perpId: number;
  orderType: number;
  lotLNS: bigint;
  pricePNS: bigint;
  leverageHdths: number;
  maxMatches: number;
  leaderRef: Hex;
  /** The leader's fill price as observed by the engine (0 if unknown); statistics only. */
  leaderFillPNS: bigint;
}

export interface LeaderRule {
  accountId: number;
  ratioBps: number;
  /** Margin budget for this leader's positions, collateral units (6 decimals); must be > 0. */
  budgetCNS: bigint;
  /** Leader loss stop as bps of the budget (0 = off). */
  lossStopBps: number;
}

export interface MarketRule {
  perpId: number;
  maxNotionalCNS: bigint;
}

export interface Policy {
  maxLeverageHdths: number;
  maxSlippageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  expiry: number;
  /** Max distance of an opening copy's limit (and the mark) from the leader's average entry (0 = off). */
  maxEntryDeviationBps: number;
  /** Slippage bound for closes sent by triggered stops, 1..2000. */
  stopSlippageBps: number;
  /** Lets anyone flatten once an account or leader loss stop is hit. */
  flattenOnStop: boolean;
  leaders: LeaderRule[];
  markets: MarketRule[];
}

/** Owner stop-loss / take-profit on the position in one market (MirrorAccount.Level). */
export interface Level {
  perpId: number;
  side: Side;
  stopLossPNS: bigint;
  takeProfitPNS: bigint;
  slippageBps: number;
}

export interface Position {
  side: Side;
  lots: bigint;
}

export const isOpen = (orderType: number) => orderType === OPEN_LONG || orderType === OPEN_SHORT;
export const isBid = (orderType: number) => orderType === OPEN_LONG || orderType === CLOSE_SHORT;
export const openTypeFor = (side: Side) => (side === LONG ? OPEN_LONG : OPEN_SHORT);
export const closeTypeFor = (side: Side) => (side === LONG ? CLOSE_LONG : CLOSE_SHORT);
