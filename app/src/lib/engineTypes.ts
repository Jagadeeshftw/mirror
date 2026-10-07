// Engine API shapes added with the thin-book guard, copy quality and backtest (docs/api.md).
import type { Address, Hex } from "./types";

export type QualityPeriod = "all" | "7d" | "30d";

export interface Dist {
  samples: number;
  median: number | null;
  p90: number | null;
  avg?: number | null;
  worseThanLeader?: number;
}

export interface QualityAggregates {
  copies: number;
  matchNowCopies: number;
  opens: number;
  closes: number;
  blocked: number;
  deviationBps: Dist;
  latencyMs: Dist;
  latencyBlocks: Dist;
  latencySeconds?: Dist;
}

export interface QualityCopy {
  txHash: Hex;
  account: Address;
  leaderAccountId: number;
  perpId: number;
  orderType: 0 | 1 | 2 | 3;
  lotLNS: string;
  leaderRef: Hex | null;
  leaderFillPNS: string | null;
  followerFillPNS: string | null;
  deviationBps: number | null;
  latencyMs: number | null;
  latencyBlocks: number | null;
  block: number;
  timestamp: number;
  matchNow: boolean;
}

export interface CopyQuality {
  source: "engine" | "indexer";
  period: QualityPeriod;
  since: number | null;
  leaderAccountId: number | null;
  excludesTeamRun: boolean;
  definitions?: Record<string, string>;
  aggregates: QualityAggregates;
  blockedByReason: Record<string, number>;
  copies: QualityCopy[];
  teamRun?: { label: string; aggregates: QualityAggregates; blockedByReason: Record<string, number>; copies: QualityCopy[] };
}

export type BacktestPeriod = 7 | 30 | 90;

export interface BacktestRequest {
  ratioBps: number;
  maxLeverageHdths: number;
  maxSlippageBps: number;
  markets: { perpId: number; maxNotionalCNS: string }[];
  maxEntryDeviationBps: number;
  budgetCNS: string;
  lossStopBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  flattenOnStop: boolean;
  depositCNS: string;
  period: BacktestPeriod;
  stopLossPct?: number;
  takeProfitPct?: number;
}

export interface BacktestTrade {
  t: number;
  perpId: number;
  action: "open" | "close" | string;
  side: "long" | "short";
  lots: string;
  fillPNS: string;
  feeCNS: string;
  pnlCNS: string;
}

export interface BacktestResult {
  leaderAccountId: number;
  period: string;
  from: number;
  to: number;
  source: string;
  slippage: { bps: number; source: string };
  takerFeeBps: number;
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
  stops: { t: number; kind: string; perpId?: number }[];
  equityCurve: { day: number; date: string; equityCNS: string }[];
  openPositions: unknown[];
  trades: BacktestTrade[];
  eventsReplayed: number;
  assumptions: string[];
}
