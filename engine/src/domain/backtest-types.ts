import type { Side } from './types.js';

export type BtKind = 'OPEN' | 'INCREASE' | 'DECREASE' | 'CLOSE' | 'INVERT' | 'LIQUIDATION' | 'DELEVERAGE';

/** One leader position event (indexer PositionEvent), in chain order. */
export interface BtEvent {
  perpId: number;
  kind: BtKind;
  /** Side after the event (the closed side for CLOSE, the new side for INVERT). */
  side: Side;
  lotsAfter: bigint;
  lotsKnown: boolean;
  /** The leader's fill price; also used as the mark at that moment. */
  pricePNS: bigint;
  /** The leader's average entry after the event (for the entry guard). */
  entryPricePNS: bigint;
  leverageHdths: number;
  timestamp: number;
  block: number;
}

export interface BtMarket {
  perpId: number;
  lotDecimals: number;
  priceDecimals: number;
  /** Last trade price, to value positions still open at the end (else the last event price is used). */
  lastPricePNS: bigint | null;
}

export interface BtParams {
  leaderAccountId: number;
  ratioBps: number;
  maxLeverageHdths: number;
  maxSlippageBps: number;
  maxEntryDeviationBps: number;
  markets: Array<{ perpId: number; maxNotionalCNS: bigint }>;
  budgetCNS: bigint;
  lossStopBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  /** Owner stop-loss / take-profit distance from the follower's average entry, percent (undefined = none). */
  stopLossPct?: number;
  takeProfitPct?: number;
  flattenOnStop: boolean;
  depositCNS: bigint;
  /** Follower fill = leader price moved this far against the follower (bps, may be fractional). */
  slippageBps: number;
  takerFeeBps: number;
  /** The keeper's slippage safety margin (SLIPPAGE_SAFETY_BPS). */
  safetyBps: number;
  startTs: number;
  endTs: number;
}

export interface BtTrade {
  t: number;
  perpId: number;
  action: 'open' | 'close' | 'stop';
  side: 'long' | 'short';
  lots: string;
  fillPNS: string;
  feeCNS: string;
  pnlCNS: string;
  note?: string;
}

export interface BtResult {
  simulation: true;
  depositCNS: string;
  finalEquityCNS: string;
  pnlCNS: string;
  pnlPct: number;
  feesCNS: string;
  maxDrawdownCNS: string;
  maxDrawdownBps: number;
  tradesCopied: number;
  tradesBlocked: Record<string, number>;
  tradesBlockedTotal: number;
  skipped: Record<string, number>;
  stops: Array<{ t: number; kind: string; perpId: number | null }>;
  equityCurve: Array<{ day: number; date: string; equityCNS: string }>;
  openPositions: Array<{ perpId: number; side: 'long' | 'short'; lots: string; entryPNS: string; markPNS: string }>;
  trades: BtTrade[];
  eventsReplayed: number;
}
