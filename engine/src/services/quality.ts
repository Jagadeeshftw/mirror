import type { Db } from '../db.js';
import {
  buildQuality,
  nearestRank,
  periodSince,
  sampleJson,
  type BlockSample,
  type CopySample,
  type QualityAggregate,
  type QualityReport,
} from '../domain/quality.js';
import { engineLatencyByTx, loadEngineSamples } from './quality-engine.js';
import type { IndexerClient } from './indexer.js';
import { indexerAggregate, ALL_QUERY, PERIOD_QUERY, type IdxCopy, type IdxBlock, type IdxStats } from './quality-indexer.js';

const ORDER_TYPES: Record<string, number> = { OPEN_LONG: 0, OPEN_SHORT: 1, CLOSE_LONG: 2, CLOSE_SHORT: 3 };
const big = (v: string | number | null | undefined) => (v === null || v === undefined || String(v) === '0' ? null : BigInt(v));

export type TeamRunFn = (account: string, owner: string | null, leaderId: number) => boolean;

/**
 * Public copy quality: per copy leader fill vs follower fill, deviation, latency (engine ms and blocks) and
 * blocks by reason, with aggregates. Indexer first (CopyQualityStats / CopyEvent / BlockReasonStats) when
 * INDEXER_GRAPHQL_URL is set, else the engine DB. Team-run copies are never in the public aggregates; they are
 * reported under `teamRun`.
 */
export class CopyQualityService {
  constructor(
    private readonly db: Db,
    private readonly indexer: IndexerClient,
    private readonly isTeamRun: TeamRunFn,
  ) {}

  async report(period: 'all' | '7d' | '30d', leaderId?: number, nowSec = Math.floor(Date.now() / 1000)) {
    const since = periodSince(period, nowSec);
    const fromIdx = this.indexer.enabled ? await this.fromIndexer(period, since, leaderId) : undefined;
    const src = fromIdx ?? { source: 'engine' as const, ...this.fromEngine(since, leaderId) };
    const view = (r: QualityReport) => ({ aggregates: r.aggregates, blockedByReason: r.blockedByReason, copies: r.copies.map(sampleJson) });
    return {
      source: src.source,
      period,
      since,
      leaderAccountId: leaderId ?? null,
      excludesTeamRun: true,
      definitions: {
        deviationBps: 'follower fill vs leader fill, positive = follower got the worse price',
        latencyMs: 'engine clock: leader event first seen (Proposed) to copy receipt',
        latencyBlocks: 'copy block - leader block',
        percentiles: 'nearest rank; samples from keeper copies only (match-now has no leader fill)',
        builderFeesCNS: 'builder fees Perpl charged on copies in scope (keeper and match-now, opening size only), collateral units',
      },
      ...view(src.global),
      teamRun: { label: 'team-run (demo leader / demo follower); excluded from every number above', ...view(src.teamRun) },
    };
  }

  private fromEngine(since: number | null, leaderId?: number) {
    const s = loadEngineSamples(this.db, { since, leaderId, isTeamRun: this.isTeamRun });
    return buildQuality(s.copies, s.blocks);
  }

  /** Median deviation (bps) of this leader's public keeper copies, all time; null under 3 samples. */
  async leaderMedianSlippageBps(leaderId: number): Promise<{ bps: number; samples: number; source: string } | null> {
    const r = await this.report('all', leaderId);
    const d = r.aggregates.deviationBps;
    return d.samples >= 3 && d.median !== null ? { bps: d.median, samples: d.samples, source: r.source } : null;
  }

  private toSample(c: IdxCopy, latency: Map<string, number>): CopySample {
    const orderType = ORDER_TYPES[String(c.orderType)] ?? 0;
    return {
      txHash: c.txHash,
      account: c.mirrorAccount_id.toLowerCase(),
      leaderAccountId: Number(c.leaderAccountId),
      perpId: Number(c.perpId),
      orderType,
      lotLNS: String(c.filledLotsLNS ?? c.lotLNS ?? '0'),
      leaderRef: c.leaderRef,
      leaderFillPNS: big(c.leaderFillActualPNS) ?? big(c.leaderFillReportedPNS),
      followerFillPNS: big(c.followerFillPNS),
      deviationBps: c.deviationBps === null || c.deviationBps === undefined ? null : Number(c.deviationBps),
      latencyMs: c.isMatchNow ? null : (latency.get(c.txHash.toLowerCase()) ?? null),
      latencyBlocks: c.latencyBlocks === null || c.latencyBlocks === undefined ? null : Number(c.latencyBlocks),
      block: Number(c.blockNumber),
      timestamp: Number(c.timestamp),
      matchNow: Boolean(c.isMatchNow),
      teamRun: Boolean(c.excludedFromStats),
      // Perpl's exact figure when the indexer linked it, else the contract's computed one.
      builderFeeCNS: BigInt(c.builderFeePerplCNS ?? c.builderFeeCNS ?? 0),
    };
  }

  private async fromIndexer(period: string, since: number | null, leaderId?: number) {
    const leader = leaderId !== undefined ? { leaderAccountId: { _eq: leaderId } } : {};
    if (period === 'all' || since === null) {
      const stats = (scope: string) => ({ scope: { _eq: scope }, period: { _eq: 'ALL_TIME' }, leaderAccountId: leaderId !== undefined ? { _eq: leaderId } : { _is_null: true } });
      const d = await this.indexer.query<{ global: IdxStats[]; team: IdxStats[]; blockedByReason: Array<{ reason: string; count: number }>; teamBlockedByReason: Array<{ reason: string; count: number }>; copies: IdxCopy[]; teamCopies: IdxCopy[] }>(
        ALL_QUERY,
        {
          statsWhere: stats('global'),
          teamWhere: stats('teamRun'),
          blockWhere: stats('global'),
          teamBlockWhere: stats('teamRun'),
          copyWhere: { excludedFromStats: { _eq: false }, ...leader },
          teamCopyWhere: { excludedFromStats: { _eq: true }, ...leader },
          limit: 50,
        },
        'copy quality (all time)',
      );
      if (!d) return undefined;
      const latency = engineLatencyByTx(this.db, [...d.copies, ...d.teamCopies].map((c) => c.txHash));
      // Engine-measured ms latency for the same scope (the indexer only has whole-second block times).
      const eng = loadEngineSamples(this.db, { since: null, leaderId, isTeamRun: this.isTeamRun });
      const msDist = (team: boolean) => {
        const xs = eng.copies.filter((c) => c.teamRun === team && !c.matchNow && c.latencyMs !== null).map((c) => c.latencyMs!);
        return { samples: xs.length, median: nearestRank(xs, 0.5), p90: nearestRank(xs, 0.9) };
      };
      const report = (s: IdxStats | undefined, blocks: Array<{ reason: string; count: number }>, copies: IdxCopy[], team: boolean): QualityReport => ({
        aggregates: indexerAggregate(s, msDist(team)) as QualityAggregate,
        blockedByReason: Object.fromEntries(blocks.map((b) => [b.reason, Number(b.count)])),
        copies: copies.map((c) => this.toSample(c, latency)),
      });
      return {
        source: 'indexer' as const,
        global: report(d.global[0], d.blockedByReason, d.copies, false),
        teamRun: report(d.team[0], d.teamBlockedByReason, d.teamCopies, true),
      };
    }
    const d = await this.indexer.query<{ copies: IdxCopy[]; blocks: IdxBlock[] }>(
      PERIOD_QUERY,
      { copyWhere: { timestamp: { _gte: since }, ...leader }, blockWhere: { timestamp: { _gte: since }, ...leader }, limit: 5_000 },
      'copy quality (period)',
    );
    if (!d) return undefined;
    const latency = engineLatencyByTx(this.db, d.copies.map((c) => c.txHash));
    const copies = d.copies.map((c) => this.toSample(c, latency));
    const blocks: BlockSample[] = d.blocks.map((b) => ({ reason: b.reason, leaderAccountId: Number(b.leaderAccountId), timestamp: Number(b.timestamp), matchNow: Boolean(b.isMatchNow), teamRun: Boolean(b.excludedFromStats) }));
    return { source: 'indexer' as const, ...buildQuality(copies, blocks) };
  }
}
