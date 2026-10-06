import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { getAddress } from "viem";

import { DAY, ETH, LONG, MATCH_NOW, T0, Timeline, addr, chain143, usd } from "./helpers.js";

const OWNER = addr(0xa1);
const CLONE = getAddress(addr(0xc1));
const FOLLOWER = 500n;
const L1 = 100n;
const L2 = 200n;
const TEAM_LEADER = 999n; // in ENVIO_TEAM_RUN_ACCOUNT_IDS
const DAY0 = Math.floor(T0 / DAY);
const DAY1 = DAY0 + 1;
const UNKNOWN_REF = `0x${"ef".repeat(32)}`;

/** Factory create, policy (budgets and loss stops), deposit, Perpl account creation. */
function onboard(tl: Timeline, owner = OWNER, clone = CLONE, perplId = FOLLOWER, leaders: bigint[] = [L1, L2]) {
  tl.tx(T0 + 10).createMirror(owner, clone).mirror(clone, "OwnerInitialized", { owner });
  tl.tx(T0 + 20).policy(
    clone,
    leaders.map((l) => [l, 5000n, usd(100), 2000n] as [bigint, bigint, bigint, bigint]),
    [[ETH, usd(10_000)]],
    { maxEntryDev: 100n, flatten: true },
  );
  tl.tx(T0 + 30)
    .mirror(clone, "Deposited", { from: owner, amount: usd(500), netDeposits: usd(500) })
    .perplAccountCreated(clone, perplId)
    .deposit(perplId, usd(500), usd(500))
    .mirror(clone, "PerplAccountCreated", { perplAccountId: perplId });
}

describe("copy quality", () => {
  it("proves each copy from chain data and aggregates deviation, latency and blocks", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    onboard(tl);

    // Day 0. Leader opens 1 ETH @ 3000.00.
    tl.tx(T0 + 100).open(L1, ETH, LONG, 1000n, 300000n);
    const leaderOpenTx = tl.txHash;
    // Copy 3 blocks / 2 s later: follower fills 0.5 ETH @ 3003.00 (proof), +10 bps worse.
    tl.tx(T0 + 102, 3)
      .open(FOLLOWER, ETH, LONG, 500n, 300300n)
      .mirrored(CLONE, {
        leader: L1, perpId: ETH, orderType: 0n, lot: 500n, price: 301000n, before: 0n, after: 500n, ref: leaderOpenTx,
        proof: { leaderFillPNS: 300000n, leaderEntryPNS: 300000n, markPNS: 300200n, fillPNS: 300300n, entryDeviationBps: 10n },
      });
    const openCopyBlock = tl.block;

    // Leader reduces 1000 -> 400 lots, +60 USD: exit derived from PnL = 3100.00.
    tl.tx(T0 + 200).decrease(L1, ETH, LONG, 1000n, 400n, usd(60));
    const leaderDecTx = tl.txHash;
    // Close copy 1 block / 1 s later: follower 500 -> 200, +28.17 USD -> exit 3096.90 (derived), +10 bps worse.
    // The keeper misreports the leader fill as 3105.00.
    tl.tx(T0 + 201)
      .decrease(FOLLOWER, ETH, LONG, 500n, 200n, usd(28.17))
      .mirrored(CLONE, {
        leader: L1, perpId: ETH, orderType: 2n, lot: 300n, price: 309000n, before: 500n, after: 200n, ref: leaderDecTx,
        proof: { leaderFillPNS: 310500n, markPNS: 310000n },
      });

    // Leader closes; the copy references a tx the indexer never saw, so only the reported fill is usable.
    tl.tx(T0 + 300).close(L1, ETH, LONG, 305000n, usd(30));
    tl.tx(T0 + 302)
      .close(FOLLOWER, ETH, LONG, 305153n, usd(9.706))
      .mirrored(CLONE, {
        leader: L1, perpId: ETH, orderType: 2n, lot: 200n, price: 304000n, before: 200n, after: 0n, ref: UNKNOWN_REF,
        proof: { leaderFillPNS: 305000n, markPNS: 305100n },
      });

    // Day 1. Leader opens again; copy 5 blocks / 2 s later, +40 bps worse.
    tl.tx(T0 + DAY + 100).open(L1, ETH, LONG, 1000n, 300000n);
    const leaderOpen2Tx = tl.txHash;
    tl.tx(T0 + DAY + 102, 5)
      .open(FOLLOWER, ETH, LONG, 100n, 301200n)
      .mirrored(CLONE, {
        leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 301500n, before: 0n, after: 100n, ref: leaderOpen2Tx,
        proof: { leaderFillPNS: 300000n, leaderEntryPNS: 300000n, markPNS: 301000n, fillPNS: 301200n, entryDeviationBps: 40n },
      });
    // Owner match-now: counted as a copy, never a deviation or latency sample.
    tl.tx(T0 + DAY + 200)
      .increase(FOLLOWER, ETH, LONG, 100n, 200n, 301100n)
      .mirrored(CLONE, {
        leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 301500n, before: 100n, after: 200n, ref: MATCH_NOW,
        proof: { leaderEntryPNS: 300000n, markPNS: 301000n, fillPNS: 301000n, entryDeviationBps: 33n },
      });
    tl.tx(T0 + DAY + 300).blocked(CLONE, { leader: L1, perpId: ETH, reason: 15n, limit: 303000n, actual: 304000n, leaderFill: 300000n, mark: 304000n });
    tl.tx(T0 + DAY + 400).blocked(CLONE, { leader: L2, perpId: ETH, reason: 16n, limit: L2, actual: L1 });

    await indexer.process(chain143(tl.items));

    // ---- per-copy proof
    const copies = (await indexer.CopyEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(copies).toHaveLength(5);
    const [open, dec, close, open2, matchNow] = copies as [typeof copies[0], typeof copies[0], typeof copies[0], typeof copies[0], typeof copies[0]];

    expect(open.leaderFillReportedPNS).toBe(300000n);
    expect(open.leaderFillActualPNS).toBe(300000n);
    expect(open.leaderEvent_id).toBe(`${leaderOpenTx}-0`);
    expect([open.leaderFillBasis, open.leaderFillMismatch, open.leaderFillDiffBps]).toEqual(["ACTUAL", false, 0]);
    expect([open.followerFillPNS, open.followerFillSource]).toEqual([300300n, "PROOF"]);
    expect([open.leaderEntryPNS, open.markPNS, open.proofFillPNS, open.entryDeviationBps]).toEqual([300000n, 300200n, 300300n, 10]);
    expect(open.deviationBps).toBe(10);
    expect([open.latencyBlocks, open.latencySeconds]).toEqual([3, 2]);
    expect(open.blockNumber).toBe(openCopyBlock);
    expect(open.excludedFromStats).toBe(false);

    // close priced from the follower's own PositionDecreased (derived from PnL) in the same tx
    expect(dec.leaderFillActualPNS).toBe(310000n);
    expect(dec.leaderFillReportedPNS).toBe(310500n);
    expect([dec.leaderFillMismatch, dec.leaderFillDiffBps]).toEqual([true, 16]);
    expect([dec.followerFillPNS, dec.followerFillSource, dec.proofFillPNS]).toEqual([309690n, "PERPL_EVENT", 0n]);
    expect(dec.followerEvent_id).toBe(`${dec.txHash}-0`);
    expect(dec.fillPricePNS).toBe(309690n);
    expect([dec.leaderFillBasis, dec.deviationBps, dec.latencyBlocks, dec.latencySeconds]).toEqual(["ACTUAL", 10, 1, 1]);

    // leaderRef not indexed: no actual fill, no latency; deviation against the reported fill (follower better)
    expect([close.leaderFillActualPNS, close.leaderEvent_id, close.latencyBlocks, close.latencySeconds]).toEqual([undefined, undefined, undefined, undefined]);
    expect([close.followerFillPNS, close.followerFillSource]).toEqual([305153n, "PERPL_EVENT"]);
    expect([close.leaderFillBasis, close.deviationBps, close.leaderFillMismatch]).toEqual(["REPORTED", -5, false]);

    expect([open2.deviationBps, open2.latencyBlocks, open2.latencySeconds]).toEqual([40, 5, 2]);
    expect([matchNow.isMatchNow, matchNow.leaderFillBasis, matchNow.deviationBps, matchNow.latencyBlocks]).toEqual([true, "NONE", undefined, undefined]);
    expect([matchNow.followerFillPNS, matchNow.entryDeviationBps]).toEqual([301000n, 33]);

    const blocked = (await indexer.BlockedCopy.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(blocked.map((b) => [b.reason, b.reasonCode, b.leaderFillPNS, b.markPNS])).toEqual([
      ["EntryTooFar", 15, 300000n, 304000n],
      ["MarketHeldByOtherLeader", 16, 0n, 0n],
    ]);

    // ---- the market belongs to the leader whose copy opened it, until flat
    const pos = await indexer.Position.getOrThrow(`${FOLLOWER}-20`);
    expect([pos.isOpen, pos.lotsLNS, pos.heldForLeaderAccountId]).toEqual([true, 200n, L1]);

    // ---- aggregates
    const all = await indexer.CopyQualityStats.getOrThrow("global-all-all");
    expect([all.period, all.day, all.leaderAccountId]).toEqual(["ALL_TIME", undefined, undefined]);
    expect([all.copies, all.matchNowCopies, all.opens, all.closes, all.blocked]).toEqual([5, 1, 3, 2, 2]);
    // deviation samples [-5, 10, 10, 40]
    expect([all.deviationSamples, all.deviationSamplesActual, all.deviationSumBps]).toEqual([4, 3, 55n]);
    expect([all.avgDeviationBps, all.medianDeviationBps, all.p90DeviationBps, all.worseThanLeader]).toEqual([14, 10, 40, 3]);
    // latency samples: blocks [1, 3, 5], seconds [1, 2, 2]
    expect([all.latencySamples, all.medianLatencyBlocks, all.p90LatencyBlocks]).toEqual([3, 3, 5]);
    expect([all.medianLatencySeconds, all.p90LatencySeconds]).toEqual([2, 2]);
    expect([all.leaderFillVerified, all.leaderFillMismatches]).toEqual([3, 1]);

    const d0 = await indexer.CopyQualityStats.getOrThrow(`global-all-${DAY0}`);
    expect([d0.period, d0.day, d0.date, d0.copies, d0.blocked]).toEqual(["DAY", DAY0, "2026-10-01", 3, 0]);
    expect([d0.deviationSamples, d0.medianDeviationBps, d0.p90DeviationBps, d0.medianLatencyBlocks]).toEqual([3, 10, 10, 1]);
    const d1 = await indexer.CopyQualityStats.getOrThrow(`global-all-${DAY1}`);
    expect([d1.copies, d1.matchNowCopies, d1.blocked, d1.medianDeviationBps, d1.medianLatencyBlocks]).toEqual([2, 1, 2, 40, 5]);

    const l1 = await indexer.CopyQualityStats.getOrThrow(`global-${L1}-all`);
    expect([l1.leaderAccountId, l1.leader_id, l1.copies, l1.blocked, l1.medianDeviationBps]).toEqual([L1, String(L1), 5, 1, 10]);
    const l2 = await indexer.CopyQualityStats.getOrThrow(`global-${L2}-${DAY1}`);
    expect([l2.copies, l2.blocked, l2.medianDeviationBps]).toEqual([0, 1, undefined]);

    expect((await indexer.BlockReasonStats.getOrThrow("global-all-all-EntryTooFar")).count).toBe(1);
    expect((await indexer.BlockReasonStats.getOrThrow(`global-all-${DAY1}-MarketHeldByOtherLeader`)).count).toBe(1);
    const r = await indexer.BlockReasonStats.getOrThrow(`global-${L2}-${DAY1}-MarketHeldByOtherLeader`);
    expect([r.leaderAccountId, r.period, r.day, r.count]).toEqual([L2, "DAY", DAY1, 1]);
    expect(await indexer.BlockReasonStats.get(`global-${L1}-all-MarketHeldByOtherLeader`)).toBeUndefined();
    expect(await indexer.CopyQualityStats.get("teamRun-all-all")).toBeUndefined();
  });

  it("keeps copies of team-run followers and of team-run leaders out of the public aggregates", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const teamClone = getAddress(addr(0xc2));
    onboard(tl, addr(0xd1), teamClone, 600n, [L1]); // team-run follower (owner in ENVIO_TEAM_RUN_ADDRESSES)
    onboard(tl, addr(0xa2), CLONE, FOLLOWER, [TEAM_LEADER]); // regular follower of the team-run demo leader

    tl.tx(T0 + 100).open(L1, ETH, LONG, 1000n, 300000n);
    const l1Tx = tl.txHash;
    tl.tx(T0 + 101)
      .open(600n, ETH, LONG, 100n, 300000n)
      .mirrored(teamClone, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 0n, after: 100n, ref: l1Tx, proof: { fillPNS: 300000n } });
    tl.tx(T0 + 200).open(TEAM_LEADER, ETH, LONG, 1000n, 300000n);
    const teamTx = tl.txHash;
    tl.tx(T0 + 202, 2)
      .open(FOLLOWER, ETH, LONG, 100n, 300300n)
      .mirrored(CLONE, { leader: TEAM_LEADER, perpId: ETH, orderType: 0n, lot: 100n, price: 300500n, before: 0n, after: 100n, ref: teamTx, proof: { fillPNS: 300300n } });
    tl.tx(T0 + 300).blocked(CLONE, { leader: TEAM_LEADER, perpId: ETH, reason: 17n, limit: usd(100), actual: usd(120) });
    await indexer.process(chain143(tl.items));

    const copies = (await indexer.CopyEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(copies.map((c) => [c.teamRun, c.excludedFromStats])).toEqual([
      [true, true],
      [false, true], // the follower is a real user, but the leader is team-run
    ]);
    // still fully proven and visible
    expect(copies.map((c) => [c.deviationBps, c.latencyBlocks])).toEqual([[0, 1], [10, 2]]);
    expect((await indexer.BlockedCopy.getAll()).map((b) => [b.reason, b.teamRun, b.excludedFromStats])).toEqual([
      ["LeaderBudgetExceeded", false, true],
    ]);

    expect(await indexer.CopyQualityStats.get("global-all-all")).toBeUndefined();
    expect(await indexer.BlockReasonStats.get("global-all-all-LeaderBudgetExceeded")).toBeUndefined();
    const team = await indexer.CopyQualityStats.getOrThrow("teamRun-all-all");
    expect([team.copies, team.blocked, team.deviationSamples, team.medianDeviationBps, team.p90DeviationBps]).toEqual([2, 1, 2, 0, 10]);
    expect((await indexer.BlockReasonStats.getOrThrow("teamRun-all-all-LeaderBudgetExceeded")).count).toBe(1);
  });
});

/** One leader with a budget and loss stop, a level, a leader stop, a level stop and a single-market close. */
function stopsScenario(tl: Timeline) {
  onboard(tl, OWNER, CLONE, FOLLOWER, [L1]);

  tl.tx(T0 + 100)
    .open(FOLLOWER, ETH, LONG, 100n, 300000n)
    .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 0n, after: 100n });
  tl.tx(T0 + 110).mirror(CLONE, "LevelSet", { perpId: ETH, side: 0n, stopLossPNS: 290000n, takeProfitPNS: 320000n, slippageBps: 100n });
  // leader loss stop fires: LeaderStopped, the reduce-only close, then StopTriggered
  tl.tx(T0 + 200)
    .mirror(CLONE, "LeaderStopped", { leaderAccountId: L1, pnlCNS: -usd(25), limitCNS: usd(20) })
    .close(FOLLOWER, ETH, LONG, 295000n, -usd(5))
    .mirror(CLONE, "StopTriggered", { caller: addr(0x77), kind: 2n, scope: L1, limit: usd(20), actual: usd(25), oraclePNS: 0n, positionsClosed: 1n });
  // a later position hits the owner's stop-loss
  tl.tx(T0 + 300)
    .open(FOLLOWER, ETH, LONG, 100n, 300000n)
    .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 0n, after: 100n });
  tl.tx(T0 + 400)
    .close(FOLLOWER, ETH, LONG, 289000n, -usd(11))
    .mirror(CLONE, "StopTriggered", { caller: addr(0x77), kind: 3n, scope: ETH, limit: 290000n, actual: 289000n, oraclePNS: 289100n, positionsClosed: 100n });
  tl.tx(T0 + 500).mirror(CLONE, "MarketClosed", { perpId: ETH, slippageBps: 200n, lotsBefore: 0n, lotsAfter: 0n });
}

describe("stops, levels and per-leader policy", () => {
  it("indexes budgets, loss stops, levels, stop triggers and single-market closes", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    stopsScenario(tl);
    await indexer.process(chain143(tl.items));

    const ma = await indexer.MirrorAccount.getOrThrow(CLONE);
    expect([ma.maxEntryDeviationBps, ma.stopSlippageBps, ma.flattenOnStop]).toEqual([100, 300, true]);
    expect([ma.leaderAccountIds, ma.leaderRatiosBps, ma.leaderBudgetsCNS, ma.leaderLossStopsBps]).toEqual([[L1], [5000], [usd(100)], [2000]]);
    expect([ma.stopsTriggered, ma.leaderStops, ma.marketCloseCount]).toEqual([2, 1, 1]);

    const rule = await indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${L1}`);
    expect([rule.budgetCNS, rule.lossStopBps, rule.stopped, rule.stopCount]).toEqual([usd(100), 2000, true, 1]);
    expect([rule.stoppedAt, rule.stopPnlCNS, rule.stopLimitCNS]).toEqual([T0 + 200, -usd(25), usd(20)]);
    expect((await indexer.LeaderStats.getOrThrow(String(L1))).followerLeaderStops).toBe(1);

    const stops = (await indexer.StopTrigger.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(stops.map((s) => [s.kind, s.kindCode, s.scope, s.perpId, s.leaderAccountId, s.positionsClosed, s.lotsClosedLNS])).toEqual([
      ["LeaderLoss", 2, 100, undefined, L1, 1, undefined],
      ["StopLoss", 3, 20, 20, undefined, undefined, 100n],
    ]);
    expect([stops[1]!.limit, stops[1]!.actual, stops[1]!.oraclePNS, stops[1]!.caller]).toEqual([290000n, 289000n, 289100n, getAddress(addr(0x77))]);

    const level = await indexer.MirrorLevel.getOrThrow(`${CLONE}-20`);
    expect([level.side, level.stopLossPNS, level.takeProfitPNS, level.slippageBps]).toEqual(["LONG", 290000n, 320000n, 100]);
    expect([level.active, level.triggeredKind, level.triggeredAt]).toEqual([false, "StopLoss", T0 + 400]);
    const market = await indexer.MirrorMarketRule.getOrThrow(`${CLONE}-20`);
    expect([market.halted, market.haltedAt]).toEqual([true, T0 + 400]);
    expect((await indexer.Position.getOrThrow(`${FOLLOWER}-20`)).heldForLeaderAccountId).toBeUndefined();

    const g = await indexer.GlobalStats.getOrThrow("global");
    expect([g.stopsTriggered, g.leaderStops]).toEqual([2, 1]);

    const feed = (await indexer.MirrorActivity.getAll()).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    expect(feed.map((f) => f.kind).slice(4)).toEqual([
      "MIRRORED", "LEVEL_SET", "LEADER_STOPPED", "STOP_TRIGGERED", "MIRRORED", "STOP_TRIGGERED", "MARKET_CLOSED",
    ]);
    const stopRow = feed.find((f) => f.kind === "STOP_TRIGGERED")!;
    expect(stopRow.stop_id).toBe(stops[0]!.id);
    expect(JSON.parse(stopRow.detail!)).toMatchObject({ kind: "LeaderLoss", positionsClosed: "1" });

  });

  it("a new policy re-arms a stopped leader and lifts a market halt", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    stopsScenario(tl);
    tl.tx(T0 + 600).policy(CLONE, [[L1, 5000n, usd(50), 1000n]], [[ETH, usd(10_000)]]);
    await indexer.process(chain143(tl.items));
    const rule = await indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${L1}`);
    expect([rule.stopped, rule.stopCount, rule.budgetCNS, rule.lossStopBps, rule.stopPnlCNS]).toEqual([false, 1, usd(50), 1000, -usd(25)]);
    const market = await indexer.MirrorMarketRule.getOrThrow(`${CLONE}-20`);
    expect([market.halted, market.haltedAt]).toEqual([false, undefined]);
    const ma = await indexer.MirrorAccount.getOrThrow(CLONE);
    expect([ma.leaderBudgetsCNS, ma.leaderLossStopsBps, ma.policyVersion]).toEqual([[usd(50)], [1000], 2]);
  });
});
