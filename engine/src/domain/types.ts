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
} as const;

export interface MirrorOrder {
  leaderAccountId: number;
  perpId: number;
  orderType: number;
  lotLNS: bigint;
  pricePNS: bigint;
  leverageHdths: number;
  maxMatches: number;
  leaderRef: Hex;
}

export interface LeaderRule {
  accountId: number;
  ratioBps: number;
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
  leaders: LeaderRule[];
  markets: MarketRule[];
}

export interface Position {
  side: Side;
  lots: bigint;
}

export const isOpen = (orderType: number) => orderType === OPEN_LONG || orderType === OPEN_SHORT;
export const isBid = (orderType: number) => orderType === OPEN_LONG || orderType === CLOSE_SHORT;
export const openTypeFor = (side: Side) => (side === LONG ? OPEN_LONG : OPEN_SHORT);
export const closeTypeFor = (side: Side) => (side === LONG ? CLOSE_LONG : CLOSE_SHORT);
