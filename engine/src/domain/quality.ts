import { isBid } from './types.js';

/** One executed copy with its quality figures (engine DB or indexer CopyEvent). */
export interface CopySample {
  txHash: string;
  account: string;
  leaderAccountId: number;
  perpId: number;
  orderType: number;
  lotLNS: string;
  leaderRef: string | null;
  leaderFillPNS: bigint | null;
  followerFillPNS: bigint | null;
  /** Follower fill vs leader fill, bps, positive = follower worse. */
  deviationBps: number | null;
  /** Leader log first seen by the engine -> copy receipt, engine clock. */
  latencyMs: number | null;
  /** Copy block - leader block. */
  latencyBlocks: number | null;
  block: number;
  timestamp: number | null;
  matchNow: boolean;
  teamRun: boolean;
  /** Builder fee Perpl charged on this copy (CopyProof.builderFeeCNS; 0 for closes and unknown). */
  builderFeeCNS: bigint;
}

export interface BlockSample {
  reason: string;
  leaderAccountId: number;
  timestamp: number | null;
  matchNow: boolean;
  teamRun: boolean;
}

export interface Dist {
  samples: number;
  median: number | null;
  p90: number | null;
}

export interface QualityAggregate {
  copies: number;
  matchNowCopies: number;
  opens: number;
  closes: number;
  blocked: number;
  deviationBps: Dist & { avg: number | null; worseThanLeader: number };
  latencyMs: Dist;
  latencyBlocks: Dist;
  /** Builder fees on every copy in scope, keeper and match-now (opening size only), collateral units. */
  builderFeesCNS: string;
}

/**
 * Follower fill against the leader fill in bps, positive when the follower got the worse price: paid more on
 * a buy (open long, close short), received less on a sell (open short, close long). Truncated toward zero.
 */
export function deviationBps(orderType: number, leaderFillPNS: bigint | null, followerFillPNS: bigint | null): number | null {
  if (!leaderFillPNS || !followerFillPNS || leaderFillPNS <= 0n || followerFillPNS <= 0n) return null;
  const diff = isBid(orderType) ? followerFillPNS - leaderFillPNS : leaderFillPNS - followerFillPNS;
  return Number((diff * 10_000n) / leaderFillPNS);
}

/** Nearest-rank percentile (same rule as the indexer): the ceil(p x n)-th smallest value. */
export function nearestRank(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * s.length));
  return s[Math.min(s.length, rank) - 1]!;
}

const dist = (xs: number[]): Dist => ({ samples: xs.length, median: nearestRank(xs, 0.5), p90: nearestRank(xs, 0.9) });
const nums = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null && Number.isFinite(x));

/**
 * Aggregates one scope. Deviation and latency samples come only from keeper copies (match-now orders have no
 * leader fill to copy), as in the indexer's CopyQualityStats.
 */
export function aggregateScope(copies: CopySample[], blocks: BlockSample[]): QualityAggregate {
  const keeper = copies.filter((c) => !c.matchNow);
  const devs = nums(keeper.map((c) => c.deviationBps));
  return {
    copies: keeper.length,
    matchNowCopies: copies.length - keeper.length,
    opens: keeper.filter((c) => c.orderType <= 1).length,
    closes: keeper.filter((c) => c.orderType >= 2).length,
    blocked: blocks.length,
    deviationBps: {
      ...dist(devs),
      avg: devs.length ? Math.round(devs.reduce((a, b) => a + b, 0) / devs.length) : null,
      worseThanLeader: devs.filter((d) => d > 0).length,
    },
    latencyMs: dist(nums(keeper.map((c) => c.latencyMs))),
    latencyBlocks: dist(nums(keeper.map((c) => c.latencyBlocks))),
    builderFeesCNS: copies.reduce((sum, c) => sum + c.builderFeeCNS, 0n).toString(),
  };
}

export function blocksByReason(blocks: BlockSample[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of blocks) out[b.reason] = (out[b.reason] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export interface QualityReport {
  aggregates: QualityAggregate;
  blockedByReason: Record<string, number>;
  copies: CopySample[];
}

/**
 * Splits samples into the public scope and the team-run scope (team-run follower or leader). The public
 * aggregates never include team-run copies; they are reported separately.
 */
export function buildQuality(copies: CopySample[], blocks: BlockSample[], listLimit = 50): { global: QualityReport; teamRun: QualityReport } {
  const scope = (team: boolean): QualityReport => {
    const c = copies.filter((x) => x.teamRun === team);
    const b = blocks.filter((x) => x.teamRun === team);
    const recent = [...c].sort((x, y) => y.block - x.block).slice(0, listLimit);
    return { aggregates: aggregateScope(c, b), blockedByReason: blocksByReason(b), copies: recent };
  };
  return { global: scope(false), teamRun: scope(true) };
}

export const PERIOD_SECONDS: Record<string, number | null> = { all: null, '7d': 7 * 86_400, '30d': 30 * 86_400 };

/** Unix-second lower bound for a period (null for all time). */
export function periodSince(period: string, nowSec: number): number | null {
  const s = PERIOD_SECONDS[period];
  return s ? nowSec - s : null;
}

export function sampleJson(c: CopySample) {
  return {
    txHash: c.txHash,
    account: c.account,
    leaderAccountId: c.leaderAccountId,
    perpId: c.perpId,
    orderType: c.orderType,
    lotLNS: c.lotLNS,
    leaderRef: c.leaderRef,
    leaderFillPNS: c.leaderFillPNS?.toString() ?? null,
    followerFillPNS: c.followerFillPNS?.toString() ?? null,
    deviationBps: c.deviationBps,
    latencyMs: c.latencyMs,
    latencyBlocks: c.latencyBlocks,
    block: c.block,
    timestamp: c.timestamp,
    matchNow: c.matchNow,
    builderFeeCNS: c.builderFeeCNS.toString(),
  };
}
