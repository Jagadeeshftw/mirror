import type { Dist } from '../domain/quality.js';

/**
 * Indexer operations for copy quality, built on the entities used by indexer/queries/copy-quality.graphql
 * (CopyQualityStats, BlockReasonStats, CopyEvent, BlockedCopy) with leader and time filters passed as Hasura
 * bool_exp variables. Numeric (BigInt) values come back as strings.
 */

const QUALITY_FIELDS = `copies matchNowCopies opens closes blocked deviationSamples avgDeviationBps medianDeviationBps p90DeviationBps
  worseThanLeader latencySamples medianLatencyBlocks p90LatencyBlocks medianLatencySeconds p90LatencySeconds builderFeesCNS`;

const COPY_FIELDS = `txHash mirrorAccount_id leaderAccountId perpId orderType lotLNS filledLotsLNS leaderRef leaderFillReportedPNS
  leaderFillActualPNS followerFillPNS deviationBps latencyBlocks latencySeconds blockNumber timestamp isMatchNow excludedFromStats builderFeeCNS builderFeePerplCNS`;

export const ALL_QUERY = `query MirrorCopyQualityAll($statsWhere: CopyQualityStats_bool_exp!, $teamWhere: CopyQualityStats_bool_exp!,
  $blockWhere: BlockReasonStats_bool_exp!, $teamBlockWhere: BlockReasonStats_bool_exp!, $copyWhere: CopyEvent_bool_exp!,
  $teamCopyWhere: CopyEvent_bool_exp!, $limit: Int!) {
  global: CopyQualityStats(where: $statsWhere, limit: 1) { ${QUALITY_FIELDS} }
  team: CopyQualityStats(where: $teamWhere, limit: 1) { ${QUALITY_FIELDS} }
  blockedByReason: BlockReasonStats(where: $blockWhere, order_by: { count: desc }) { reason count }
  teamBlockedByReason: BlockReasonStats(where: $teamBlockWhere, order_by: { count: desc }) { reason count }
  copies: CopyEvent(where: $copyWhere, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $limit) { ${COPY_FIELDS} }
  teamCopies: CopyEvent(where: $teamCopyWhere, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $limit) { ${COPY_FIELDS} }
}`;

export const PERIOD_QUERY = `query MirrorCopyQualityPeriod($copyWhere: CopyEvent_bool_exp!, $blockWhere: BlockedCopy_bool_exp!, $limit: Int!) {
  copies: CopyEvent(where: $copyWhere, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $limit) { ${COPY_FIELDS} }
  blocks: BlockedCopy(where: $blockWhere, order_by: [{ blockNumber: desc }, { logIndex: desc }], limit: $limit) {
    reason leaderAccountId timestamp isMatchNow excludedFromStats
  }
}`;

type N = string | number | null | undefined;

export interface IdxStats {
  copies: N;
  matchNowCopies: N;
  opens: N;
  closes: N;
  blocked: N;
  deviationSamples: N;
  avgDeviationBps: N;
  medianDeviationBps: N;
  p90DeviationBps: N;
  worseThanLeader: N;
  latencySamples: N;
  medianLatencyBlocks: N;
  p90LatencyBlocks: N;
  medianLatencySeconds: N;
  p90LatencySeconds: N;
  builderFeesCNS?: N;
}

export interface IdxCopy {
  txHash: string;
  mirrorAccount_id: string;
  leaderAccountId: N;
  perpId: N;
  orderType: string;
  lotLNS?: N;
  filledLotsLNS?: N;
  leaderRef: string;
  leaderFillReportedPNS: N;
  leaderFillActualPNS: N;
  followerFillPNS: N;
  deviationBps: N;
  latencyBlocks: N;
  latencySeconds: N;
  blockNumber: N;
  timestamp: N;
  isMatchNow: boolean;
  excludedFromStats: boolean;
  /** MirrorAccount's computed fee (CopyProof) and Perpl's exact TakerOrderFilledV2 figure for the builder. */
  builderFeeCNS?: N;
  builderFeePerplCNS?: N;
}

export interface IdxBlock {
  reason: string;
  leaderAccountId: N;
  timestamp: N;
  isMatchNow: boolean;
  excludedFromStats: boolean;
}

const n = (v: N) => (v === null || v === undefined ? null : Number(v));
const z = (v: N) => n(v) ?? 0;

/** CopyQualityStats row in the shared aggregate shape; ms latency comes from the engine's own measurements. */
export function indexerAggregate(s: IdxStats | undefined, latencyMs: Dist) {
  return {
    copies: z(s?.copies),
    matchNowCopies: z(s?.matchNowCopies),
    opens: z(s?.opens),
    closes: z(s?.closes),
    blocked: z(s?.blocked),
    deviationBps: { samples: z(s?.deviationSamples), median: n(s?.medianDeviationBps), p90: n(s?.p90DeviationBps), avg: n(s?.avgDeviationBps), worseThanLeader: z(s?.worseThanLeader) },
    latencyMs,
    latencyBlocks: { samples: z(s?.latencySamples), median: n(s?.medianLatencyBlocks), p90: n(s?.p90LatencyBlocks) },
    latencySeconds: { samples: z(s?.latencySamples), median: n(s?.medianLatencySeconds), p90: n(s?.p90LatencySeconds) },
    builderFeesCNS: s?.builderFeesCNS === null || s?.builderFeesCNS === undefined ? '0' : String(s.builderFeesCNS),
  };
}
