/**
 * MirrorAccountFactory + MirrorAccount handlers. Clones are registered dynamically from the
 * factory's AccountCreated event.
 */
import { indexer, type Entity, type Enum } from "envio";

import { MATCH_NOW_REF, blockReason, isLevelStop, orderType, sideOf, stopKind } from "../lib/constants.js";
import { isTeamRun } from "../lib/env.js";
import { attributeNewestLots, EMPTY_QUEUE } from "../lib/fifo.js";
import { abs, notionalCNS } from "../lib/math.js";
import { newFollowerLeaderPnl } from "../lib/positions.js";
import {
  EXACT_PRICE_SOURCES,
  deviationBps,
  isBuyOrder,
  leaderFillBasis,
  leaderFillDiffBps,
  leaderFillMismatch,
  weightedFillPrice,
} from "../lib/quality.js";
import {
  bumpDaily,
  bumpScope,
  checksum,
  ensureAccount,
  eventId,
  loadMarket,
  metaOf,
  recordBlockQuality,
  recordCopyQuality,
  updateLeaderStats,
  type Ctx,
  type Meta,
  type MirrorAccount,
} from "../lib/store.js";

const ZERO_REF = `0x${"00".repeat(32)}`;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function newMirrorAccount(address: string, owner: string, m: Meta): MirrorAccount {
  return {
    id: address,
    address,
    owner,
    salt: "",
    perplAccount_id: undefined,
    perplAccountId: undefined,
    teamRun: isTeamRun({ addresses: [address, owner] }),
    createdAt: m.timestamp,
    createdBlock: m.block,
    createdTx: "",
    paused: false,
    maxLeverageHdths: 0,
    maxSlippageBps: 0,
    dailyLossBps: 0,
    drawdownBps: 0,
    expiry: 0n,
    maxEntryDeviationBps: 0,
    stopSlippageBps: 0,
    flattenOnStop: false,
    leaderAccountIds: [],
    leaderRatiosBps: [],
    leaderBudgetsCNS: [],
    leaderLossStopsBps: [],
    marketIds: [],
    marketMaxNotionalsCNS: [],
    policyVersion: 0,
    policyUpdatedAt: 0,
    netDepositsCNS: 0n,
    totalDepositedCNS: 0n,
    totalWithdrawnCNS: 0n,
    funded: false,
    copiesExecuted: 0,
    copiesBlocked: 0,
    matchNowCopies: 0,
    copiedNotionalCNS: 0n,
    closeAllCount: 0,
    marketCloseCount: 0,
    stopsTriggered: 0,
    leaderStops: 0,
    lastCopyAt: 0,
    lastActivityAt: m.timestamp,
  };
}

async function loadMirror(ctx: Ctx, rawAddress: string, m: Meta, rawOwner = ""): Promise<MirrorAccount> {
  const address = checksum(rawAddress);
  const owner = rawOwner ? checksum(rawOwner) : "";
  const existing = await ctx.MirrorAccount.get(address);
  if (!existing) return newMirrorAccount(address, owner, m);
  if (owner && !existing.owner) {
    return { ...existing, owner, teamRun: existing.teamRun || isTeamRun({ addresses: [address, owner] }) };
  }
  return existing;
}

function activity(
  ctx: Ctx,
  ma: MirrorAccount,
  m: Meta,
  kind: Enum<"ActivityKind">,
  extra: Partial<Pick<Entity<"MirrorActivity">, "amountCNS" | "copy_id" | "blocked_id" | "stop_id" | "detail">> = {},
): void {
  ctx.MirrorActivity.set({
    id: eventId(m),
    mirrorAccount_id: ma.id,
    kind,
    amountCNS: extra.amountCNS,
    copy_id: extra.copy_id,
    blocked_id: extra.blocked_id,
    stop_id: extra.stop_id,
    detail: extra.detail,
    teamRun: ma.teamRun,
    blockNumber: m.block,
    timestamp: m.timestamp,
    txHash: m.txHash,
    logIndex: m.logIndex,
  });
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------

indexer.contractRegister({ contract: "MirrorAccountFactory", event: "AccountCreated" }, async ({ event, context }) => {
  context.chain.MirrorAccount.add(event.params.account);
});

indexer.onEvent({ contract: "MirrorAccountFactory", event: "AccountCreated" }, async ({ event, context }) => {
  const m = metaOf(event);
  const ma = await loadMirror(context, event.params.account, m, event.params.owner);
  const firstSeen = ma.createdTx === "";
  const created: MirrorAccount = {
    ...ma,
    owner: checksum(event.params.owner),
    salt: event.params.salt,
    createdAt: m.timestamp,
    createdBlock: m.block,
    createdTx: m.txHash,
    lastActivityAt: m.timestamp,
  };
  context.MirrorAccount.set(created);
  if (firstSeen) {
    await bumpScope(context, created.teamRun, m, (s) => ({ ...s, mirrorAccounts: s.mirrorAccounts + 1 }));
    await bumpDaily(context, created.teamRun, m, (d) => ({ ...d, newMirrorAccounts: d.newMirrorAccounts + 1 }));
  }
  activity(context, created, m, "CREATED", { detail: event.params.salt });
});

// ---------------------------------------------------------------------------------------------
// MirrorAccount lifecycle
// ---------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "MirrorAccount", event: "OwnerInitialized" }, async ({ event, context }) => {
  const m = metaOf(event);
  const ma = await loadMirror(context, event.srcAddress, m, event.params.owner);
  context.MirrorAccount.set(ma);
});

indexer.onEvent({ contract: "MirrorAccount", event: "PerplAccountCreated" }, async ({ event, context }) => {
  const m = metaOf(event);
  const ma = await loadMirror(context, event.srcAddress, m);
  const perplId = event.params.perplAccountId;
  const account = await ensureAccount(context, perplId, m, ma.address);
  const teamRun = account.teamRun || ma.teamRun;
  context.PerplAccount.set({ ...account, isMirrorAccount: true, mirrorAccount_id: ma.id, teamRun });
  const stats = await context.LeaderStats.get(account.id);
  if (stats) context.LeaderStats.set({ ...stats, isMirrorAccount: true, teamRun });
  const updated: MirrorAccount = {
    ...ma,
    perplAccount_id: account.id,
    perplAccountId: perplId,
    teamRun,
    lastActivityAt: m.timestamp,
  };
  context.MirrorAccount.set(updated);
  activity(context, updated, m, "PERPL_ACCOUNT_CREATED", { detail: perplId.toString() });
});

indexer.onEvent({ contract: "MirrorAccount", event: "PolicyUpdated" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const oldLeaders = new Set(ma.leaderAccountIds.map((x) => x.toString()));
  const newLeaders = new Map(p.leaders.map((l) => [l.accountId.toString(), l]));
  const oldMarkets = new Set(ma.marketIds);
  const newMarkets = new Map(p.markets.map((r) => [Number(r.perpId), r.maxNotionalCNS]));

  // leader rules + follower counts
  for (const id of oldLeaders) {
    if (newLeaders.has(id)) continue;
    const ruleId = `${ma.id}-${id}`;
    const rule = await context.MirrorLeaderRule.get(ruleId);
    if (rule) context.MirrorLeaderRule.set({ ...rule, active: false, updatedAt: m.timestamp });
    if (!ma.teamRun) {
      await updateLeaderStats(context, BigInt(id), m, (s) => ({ ...s, followers: Math.max(0, s.followers - 1) }));
    }
  }
  for (const [id, l] of newLeaders) {
    await ensureAccount(context, BigInt(id), m);
    const ruleId = `${ma.id}-${id}`;
    const prev = await context.MirrorLeaderRule.get(ruleId);
    // setPolicy re-arms a stopped leader and resets a newly added one, so no listed leader is stopped.
    context.MirrorLeaderRule.set({
      id: ruleId,
      mirrorAccount_id: ma.id,
      leaderAccountId: BigInt(id),
      leader_id: id,
      ratioBps: Number(l.ratioBps),
      budgetCNS: l.budgetCNS,
      lossStopBps: Number(l.lossStopBps),
      stopped: false,
      stoppedAt: prev?.stoppedAt,
      stopPnlCNS: prev?.stopPnlCNS,
      stopLimitCNS: prev?.stopLimitCNS,
      stopCount: prev?.stopCount ?? 0,
      active: true,
      updatedAt: m.timestamp,
    });
    if (!oldLeaders.has(id) && !ma.teamRun) {
      await updateLeaderStats(context, BigInt(id), m, (s) => ({ ...s, followers: s.followers + 1 }));
    }
  }

  // market rules
  for (const perpId of oldMarkets) {
    if (newMarkets.has(perpId)) continue;
    const rule = await context.MirrorMarketRule.get(`${ma.id}-${perpId}`);
    if (rule) context.MirrorMarketRule.set({ ...rule, active: false, updatedAt: m.timestamp });
  }
  for (const [perpId, maxNotional] of newMarkets) {
    const market = await loadMarket(context, perpId);
    context.Market.set(market);
    context.MirrorMarketRule.set({
      id: `${ma.id}-${perpId}`,
      mirrorAccount_id: ma.id,
      perpId,
      market_id: market.id,
      maxNotionalCNS: maxNotional,
      // setPolicy rebuilds every market, which clears a halt left by a fired level.
      halted: false,
      haltedAt: undefined,
      active: true,
      updatedAt: m.timestamp,
    });
  }

  const updated: MirrorAccount = {
    ...ma,
    maxLeverageHdths: Number(p.maxLeverageHdths),
    maxSlippageBps: Number(p.maxSlippageBps),
    dailyLossBps: Number(p.dailyLossBps),
    drawdownBps: Number(p.drawdownBps),
    expiry: p.expiry,
    maxEntryDeviationBps: Number(p.maxEntryDeviationBps),
    stopSlippageBps: Number(p.stopSlippageBps),
    flattenOnStop: p.flattenOnStop,
    leaderAccountIds: p.leaders.map((l) => l.accountId),
    leaderRatiosBps: p.leaders.map((l) => Number(l.ratioBps)),
    leaderBudgetsCNS: p.leaders.map((l) => l.budgetCNS),
    leaderLossStopsBps: p.leaders.map((l) => Number(l.lossStopBps)),
    marketIds: p.markets.map((r) => Number(r.perpId)),
    marketMaxNotionalsCNS: p.markets.map((r) => r.maxNotionalCNS),
    policyVersion: ma.policyVersion + 1,
    policyUpdatedAt: m.timestamp,
    lastActivityAt: m.timestamp,
  };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({ ...s, policyUpdates: s.policyUpdates + 1 }));
  activity(context, updated, m, "POLICY_UPDATED", {
    detail: JSON.stringify({
      maxLeverageHdths: updated.maxLeverageHdths,
      maxSlippageBps: updated.maxSlippageBps,
      dailyLossBps: updated.dailyLossBps,
      drawdownBps: updated.drawdownBps,
      expiry: updated.expiry.toString(),
      maxEntryDeviationBps: updated.maxEntryDeviationBps,
      stopSlippageBps: updated.stopSlippageBps,
      flattenOnStop: updated.flattenOnStop,
      leaders: p.leaders.map((l) => ({
        accountId: l.accountId.toString(),
        ratioBps: Number(l.ratioBps),
        budgetCNS: l.budgetCNS.toString(),
        lossStopBps: Number(l.lossStopBps),
      })),
      markets: p.markets.map((r) => ({ perpId: Number(r.perpId), maxNotionalCNS: r.maxNotionalCNS.toString() })),
    }),
  });
});

indexer.onEvent({ contract: "MirrorAccount", event: "PausedSet" }, async ({ event, context }) => {
  const m = metaOf(event);
  const ma = await loadMirror(context, event.srcAddress, m);
  const paused = event.params.paused;
  if (paused !== ma.paused) {
    await bumpScope(context, ma.teamRun, m, (s) => ({ ...s, pausedAccounts: Math.max(0, s.pausedAccounts + (paused ? 1 : -1)) }));
  }
  const updated = { ...ma, paused, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  activity(context, updated, m, paused ? "PAUSED" : "UNPAUSED");
});

indexer.onEvent({ contract: "MirrorAccount", event: "Deposited" }, async ({ event, context }) => {
  const m = metaOf(event);
  const { amount, netDeposits } = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const nowFunded = !ma.funded && netDeposits > 0n;
  const updated: MirrorAccount = {
    ...ma,
    netDepositsCNS: netDeposits,
    totalDepositedCNS: ma.totalDepositedCNS + amount,
    funded: ma.funded || netDeposits > 0n,
    lastActivityAt: m.timestamp,
  };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({
    ...s,
    fundedAccounts: s.fundedAccounts + (nowFunded ? 1 : 0),
    netDepositsCNS: s.netDepositsCNS + (netDeposits - ma.netDepositsCNS),
    totalDepositedCNS: s.totalDepositedCNS + amount,
  }));
  await bumpDaily(context, ma.teamRun, m, (d) => ({ ...d, depositsCNS: d.depositsCNS + amount }));
  activity(context, updated, m, "DEPOSITED", { amountCNS: amount });
});

indexer.onEvent({ contract: "MirrorAccount", event: "Withdrawn" }, async ({ event, context }) => {
  const m = metaOf(event);
  const { amount, netDeposits } = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const updated: MirrorAccount = {
    ...ma,
    netDepositsCNS: netDeposits,
    totalWithdrawnCNS: ma.totalWithdrawnCNS + amount,
    lastActivityAt: m.timestamp,
  };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({
    ...s,
    netDepositsCNS: s.netDepositsCNS + (netDeposits - ma.netDepositsCNS),
    totalWithdrawnCNS: s.totalWithdrawnCNS + amount,
  }));
  await bumpDaily(context, ma.teamRun, m, (d) => ({ ...d, withdrawalsCNS: d.withdrawalsCNS + amount }));
  activity(context, updated, m, "WITHDRAWN", { amountCNS: amount });
});

indexer.onEvent({ contract: "MirrorAccount", event: "ClosedAll" }, async ({ event, context }) => {
  const m = metaOf(event);
  const ma = await loadMirror(context, event.srcAddress, m);
  const updated = { ...ma, closeAllCount: ma.closeAllCount + 1, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({ ...s, closeAllCount: s.closeAllCount + 1 }));
  activity(context, updated, m, "CLOSED_ALL", {
    detail: JSON.stringify({ slippageBps: Number(event.params.slippageBps), positionsClosed: event.params.positionsClosed.toString() }),
  });
});

indexer.onEvent({ contract: "MirrorAccount", event: "Followed" }, async ({ event, context }) => {
  const m = metaOf(event);
  const ma = await loadMirror(context, event.srcAddress, m);
  const updated = { ...ma, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  activity(context, updated, m, "FOLLOWED", {
    detail: JSON.stringify({ matchOrders: event.params.matchOrders.toString(), matchesExecuted: event.params.matchesExecuted.toString() }),
  });
});

// ---------------------------------------------------------------------------------------------
// Copies
// ---------------------------------------------------------------------------------------------

type CopyQualityFields = Pick<
  Entity<"CopyEvent">,
  | "leaderFillReportedPNS"
  | "leaderFillActualPNS"
  | "leaderEvent_id"
  | "leaderBlock"
  | "leaderTimestamp"
  | "leaderFillMismatch"
  | "leaderFillDiffBps"
  | "leaderEntryPNS"
  | "markPNS"
  | "proofFillPNS"
  | "entryDeviationBps"
  | "followerFillPNS"
  | "followerFillSource"
  | "followerEvent_id"
  | "leaderFillBasis"
  | "deviationBps"
  | "latencyBlocks"
  | "latencySeconds"
>;

/**
 * Per-copy quality figures. The leader's actual fill and timing come from the leader's own Perpl
 * position event(s) in this market in the `leaderRef` transaction (when that tx was indexed). The
 * follower's fill is the proof's fill for opens and the follower's own Perpl event in this tx (an
 * earlier log, already priced by applyPositionChange) for closes.
 */
async function copyQuality(
  context: Ctx,
  m: Meta,
  c: {
    followerId: bigint | undefined;
    leaderAccountId: bigint;
    perpId: number;
    orderTypeCode: number;
    isOpen: boolean;
    filled: bigint;
    ref: string;
    isMatchNow: boolean;
    proof: { leaderFillPNS: bigint; leaderEntryPNS: bigint; markPNS: bigint; fillPNS: bigint; entryDeviationBps: bigint };
  },
): Promise<CopyQualityFields> {
  const hasRef = !c.isMatchNow && c.ref !== ZERO_REF;
  const [ownEvents, refEvents] = await Promise.all([
    c.followerId !== undefined ? context.PositionEvent.getWhere({ txHash: { _eq: m.txHash } }) : Promise.resolve([]),
    hasRef ? context.PositionEvent.getWhere({ txHash: { _eq: c.ref } }) : Promise.resolve([]),
  ]);

  const followerEvent = ownEvents
    .filter((e) => e.accountId === c.followerId && e.perpId === c.perpId && e.logIndex < m.logIndex)
    .sort((a, b) => b.logIndex - a.logIndex)[0];
  const leaderEvents = refEvents
    .filter((e) => e.accountId === c.leaderAccountId && e.perpId === c.perpId)
    .sort((a, b) => a.logIndex - b.logIndex);
  const leaderFirst = leaderEvents[0];
  const actual = weightedFillPrice(
    leaderEvents.map((e) => ({ pricePNS: e.pricePNS, lotsLNS: e.lotsTradedLNS, priceSource: e.priceSource })),
  );

  let followerFill: bigint | null = null;
  let followerSource: Entity<"CopyEvent">["followerFillSource"] = "NONE";
  if (c.filled > 0n) {
    if (c.isOpen && c.proof.fillPNS > 0n) {
      followerFill = c.proof.fillPNS;
      followerSource = "PROOF";
    } else if (followerEvent && followerEvent.pricePNS > 0n && EXACT_PRICE_SOURCES.has(followerEvent.priceSource)) {
      followerFill = followerEvent.pricePNS;
      followerSource = "PERPL_EVENT";
    }
  }

  const reported = c.proof.leaderFillPNS;
  const basis = leaderFillBasis(c.isMatchNow, actual, reported);
  return {
    leaderFillReportedPNS: reported,
    leaderFillActualPNS: actual ?? undefined,
    leaderEvent_id: leaderFirst?.id,
    leaderBlock: leaderFirst?.blockNumber,
    leaderTimestamp: leaderFirst?.timestamp,
    leaderFillMismatch: leaderFillMismatch(reported, actual),
    leaderFillDiffBps: leaderFillDiffBps(reported, actual) ?? undefined,
    leaderEntryPNS: c.proof.leaderEntryPNS,
    markPNS: c.proof.markPNS,
    proofFillPNS: c.proof.fillPNS,
    entryDeviationBps: Number(c.proof.entryDeviationBps),
    followerFillPNS: followerFill ?? undefined,
    followerFillSource: followerSource,
    followerEvent_id: followerEvent?.id,
    leaderFillBasis: basis.basis,
    deviationBps: deviationBps(followerFill, basis.pricePNS, isBuyOrder(c.orderTypeCode)) ?? undefined,
    latencyBlocks: leaderFirst ? m.block - leaderFirst.blockNumber : undefined,
    latencySeconds: leaderFirst ? m.timestamp - leaderFirst.timestamp : undefined,
  };
}

indexer.onEvent({ contract: "MirrorAccount", event: "Mirrored" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const perpId = Number(p.perpId);
  const leaderId = p.leaderAccountId.toString();
  const followerId = ma.perplAccountId?.toString();
  const posId = followerId ? `${followerId}-${perpId}` : undefined;
  const [market, pos, queueEntity] = await Promise.all([
    loadMarket(context, perpId),
    posId ? context.Position.get(posId) : Promise.resolve(undefined),
    posId ? context.FollowerLotQueue.get(posId) : Promise.resolve(undefined),
  ]);
  const leaderAccount = await ensureAccount(context, p.leaderAccountId, m);
  const excluded = ma.teamRun || leaderAccount.teamRun;

  const code = Number(p.orderType);
  const isOpen = code <= 1;
  const filled = abs(p.lotsAfter - p.lotsBefore);
  const fillPrice = pos && pos.lastTxHash === m.txHash && pos.lastExecPricePNS > 0n ? pos.lastExecPricePNS : p.pricePNS;
  const notional = market.decimalsKnown ? notionalCNS(filled, fillPrice, market.lotDecimals, market.priceDecimals) : 0n;
  const ref = p.leaderRef.toLowerCase();
  const isMatchNow = ref === MATCH_NOW_REF;
  const id = eventId(m);

  // ---- copy-quality proof, from chain data only
  const q = await copyQuality(context, m, {
    followerId: ma.perplAccountId,
    leaderAccountId: p.leaderAccountId,
    perpId,
    orderTypeCode: code,
    isOpen,
    filled,
    ref,
    isMatchNow,
    proof: p.proof,
  });

  context.CopyEvent.set({
    id,
    mirrorAccount_id: ma.id,
    follower_id: followerId,
    keeper: checksum(p.keeper),
    leaderAccountId: p.leaderAccountId,
    leader_id: leaderId,
    perpId,
    market_id: market.id,
    orderType: orderType(code),
    isOpen,
    lotLNS: p.lotLNS,
    pricePNS: p.pricePNS,
    fillPricePNS: fillPrice,
    leverageHdths: Number(p.leverageHdths),
    lotsBeforeLNS: p.lotsBefore,
    lotsAfterLNS: p.lotsAfter,
    filledLotsLNS: filled,
    notionalCNS: notional,
    leaderRef: p.leaderRef,
    isMatchNow,
    teamRun: ma.teamRun,
    ...q,
    excludedFromStats: excluded,
    blockNumber: m.block,
    timestamp: m.timestamp,
    txHash: m.txHash,
    logIndex: m.logIndex,
  });
  context.Market.set(market);
  // The copy that adds lots owns the market until the position is flat (MirrorAccount.marketLeader).
  if (pos && isOpen && p.lotsAfter > p.lotsBefore && pos.isOpen) {
    context.Position.set({ ...pos, heldForLeaderAccountId: p.leaderAccountId });
  }
  await recordCopyQuality(context, excluded, p.leaderAccountId, m, {
    isMatchNow,
    isOpen,
    notionalCNS: notional,
    deviationBps: q.deviationBps ?? null,
    deviationActual: q.leaderFillBasis === "ACTUAL",
    latencyBlocks: q.latencyBlocks ?? null,
    latencySeconds: q.latencySeconds ?? null,
    leaderFillVerified: q.leaderFillActualPNS !== undefined,
    leaderFillMismatch: q.leaderFillMismatch,
  });

  // FIFO: the follower's Perpl opening leg (same tx, earlier log) pushed unattributed lots; label them.
  let openFee = 0n;
  if (posId && isOpen && filled > 0n) {
    const queue = queueEntity ?? { ...EMPTY_QUEUE, pendingFeeCNS: 0n };
    const { queue: next } = attributeNewestLots(queue, filled, leaderId);
    openFee = queueEntity?.pendingFeeCNS ?? 0n;
    context.FollowerLotQueue.set({
      id: posId,
      mirrorAccountId: ma.id,
      leaderIds: next.leaderIds,
      lots: next.lots,
      pendingFeeCNS: 0n,
    });
  }

  if (followerId) {
    const flpId = `${ma.id}-${leaderId}`;
    const flp =
      (await context.FollowerLeaderPnl.get(flpId)) ??
      newFollowerLeaderPnl(ma.id, BigInt(followerId), leaderId, ma.teamRun, m);
    context.FollowerLeaderPnl.set({
      ...flp,
      copiedOpens: flp.copiedOpens + (isOpen ? 1 : 0),
      copiedCloses: flp.copiedCloses + (isOpen ? 0 : 1),
      copiedNotionalCNS: flp.copiedNotionalCNS + notional,
      feesCNS: flp.feesCNS + openFee,
      netPnlCNS: flp.netPnlCNS - openFee,
      updatedAt: m.timestamp,
    });
  }

  if (!ma.teamRun) {
    await updateLeaderStats(context, p.leaderAccountId, m, (s) => ({
      ...s,
      copiesExecuted: s.copiesExecuted + 1,
      copiedNotionalCNS: s.copiedNotionalCNS + notional,
    }));
  }

  const updated: MirrorAccount = {
    ...ma,
    copiesExecuted: ma.copiesExecuted + 1,
    matchNowCopies: ma.matchNowCopies + (isMatchNow ? 1 : 0),
    copiedNotionalCNS: ma.copiedNotionalCNS + notional,
    lastCopyAt: m.timestamp,
    lastActivityAt: m.timestamp,
  };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({
    ...s,
    copiesExecuted: s.copiesExecuted + 1,
    matchNowCopies: s.matchNowCopies + (isMatchNow ? 1 : 0),
    copiedNotionalCNS: s.copiedNotionalCNS + notional,
  }));
  await bumpDaily(context, ma.teamRun, m, (d) => ({
    ...d,
    copiesExecuted: d.copiesExecuted + 1,
    matchNowCopies: d.matchNowCopies + (isMatchNow ? 1 : 0),
    copiedNotionalCNS: d.copiedNotionalCNS + notional,
  }));
  activity(context, updated, m, "MIRRORED", { copy_id: id, amountCNS: notional });
});

indexer.onEvent({ contract: "MirrorAccount", event: "Blocked" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const perpId = Number(p.perpId);
  const market = await loadMarket(context, perpId);
  const leaderAccount = await ensureAccount(context, p.leaderAccountId, m);
  const excluded = ma.teamRun || leaderAccount.teamRun;
  const code = Number(p.reason);
  const reason = blockReason(code);
  const id = eventId(m);
  const isMatchNow = p.leaderRef.toLowerCase() === MATCH_NOW_REF;

  context.Market.set(market);
  context.BlockedCopy.set({
    id,
    mirrorAccount_id: ma.id,
    keeper: checksum(p.keeper),
    leaderAccountId: p.leaderAccountId,
    leader_id: p.leaderAccountId.toString(),
    perpId,
    market_id: market.id,
    reason,
    reasonCode: code,
    orderType: orderType(Number(p.orderType)),
    lotLNS: p.lotLNS,
    limit: p.limit,
    actual: p.actual,
    leaderRef: p.leaderRef,
    leaderFillPNS: p.leaderFillPNS,
    markPNS: p.markPNS,
    isMatchNow,
    teamRun: ma.teamRun,
    excludedFromStats: excluded,
    blockNumber: m.block,
    timestamp: m.timestamp,
    txHash: m.txHash,
    logIndex: m.logIndex,
  });

  const scope = ma.teamRun ? "teamRun" : "global";
  const countId = `${scope}-${reason}`;
  const count = await context.BlockReasonCount.get(countId);
  context.BlockReasonCount.set({ id: countId, scope, reason, count: (count?.count ?? 0) + 1 });
  await recordBlockQuality(context, excluded, p.leaderAccountId, reason, m);

  if (!ma.teamRun) {
    await updateLeaderStats(context, p.leaderAccountId, m, (s) => ({ ...s, copiesBlocked: s.copiesBlocked + 1 }));
  }
  const updated = { ...ma, copiesBlocked: ma.copiesBlocked + 1, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({ ...s, copiesBlocked: s.copiesBlocked + 1 }));
  await bumpDaily(context, ma.teamRun, m, (d) => ({ ...d, copiesBlocked: d.copiesBlocked + 1 }));
  activity(context, updated, m, "BLOCKED", {
    blocked_id: id,
    detail: JSON.stringify({ reason, limit: p.limit.toString(), actual: p.actual.toString() }),
  });
});

// ---------------------------------------------------------------------------------------------
// Stops, levels, single-market close
// ---------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "MirrorAccount", event: "StopTriggered" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const kindCode = Number(p.kind);
  const kind = stopKind(kindCode);
  const scope = Number(p.scope);
  const level = isLevelStop(kind);
  const leaderStop = kind === "LeaderLoss";
  const id = eventId(m);

  let marketId: string | undefined;
  if (level) {
    const market = await loadMarket(context, scope);
    context.Market.set(market);
    marketId = market.id;
  }
  if (leaderStop) await ensureAccount(context, p.scope, m);

  context.StopTrigger.set({
    id,
    mirrorAccount_id: ma.id,
    caller: checksum(p.caller),
    kind,
    kindCode,
    scope,
    perpId: level ? scope : undefined,
    market_id: marketId,
    leaderAccountId: leaderStop ? p.scope : undefined,
    leader_id: leaderStop ? p.scope.toString() : undefined,
    limit: p.limit,
    actual: p.actual,
    oraclePNS: p.oraclePNS,
    // The last field is a position count for account/leader stops and a lot count for levels.
    positionsClosed: level ? undefined : Number(p.positionsClosed),
    lotsClosedLNS: level ? p.positionsClosed : undefined,
    teamRun: ma.teamRun,
    blockNumber: m.block,
    timestamp: m.timestamp,
    txHash: m.txHash,
    logIndex: m.logIndex,
  });

  if (level) {
    // triggerLevel halts the market and deletes the level once the position is fully closed.
    const rule = await context.MirrorMarketRule.get(`${ma.id}-${scope}`);
    if (rule) context.MirrorMarketRule.set({ ...rule, halted: true, haltedAt: m.timestamp, updatedAt: m.timestamp });
    const lv = await context.MirrorLevel.get(`${ma.id}-${scope}`);
    if (lv) {
      const pos = ma.perplAccountId !== undefined ? await context.Position.get(`${ma.perplAccountId}-${scope}`) : undefined;
      context.MirrorLevel.set({
        ...lv,
        active: pos?.isOpen ?? false,
        triggeredAt: m.timestamp,
        triggeredKind: kind,
        updatedAt: m.timestamp,
      });
    }
  }

  const updated = { ...ma, stopsTriggered: ma.stopsTriggered + 1, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({ ...s, stopsTriggered: s.stopsTriggered + 1 }));
  activity(context, updated, m, "STOP_TRIGGERED", {
    stop_id: id,
    detail: JSON.stringify({
      kind,
      scope,
      limit: p.limit.toString(),
      actual: p.actual.toString(),
      oraclePNS: p.oraclePNS.toString(),
      [level ? "lotsClosed" : "positionsClosed"]: p.positionsClosed.toString(),
    }),
  });
});

indexer.onEvent({ contract: "MirrorAccount", event: "LeaderStopped" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const leaderId = p.leaderAccountId.toString();
  const rule = await context.MirrorLeaderRule.get(`${ma.id}-${leaderId}`);
  if (rule) {
    context.MirrorLeaderRule.set({
      ...rule,
      stopped: true,
      stoppedAt: m.timestamp,
      stopPnlCNS: p.pnlCNS,
      stopLimitCNS: p.limitCNS,
      stopCount: rule.stopCount + 1,
      updatedAt: m.timestamp,
    });
  }
  if (!ma.teamRun) {
    await updateLeaderStats(context, p.leaderAccountId, m, (s) => ({ ...s, followerLeaderStops: s.followerLeaderStops + 1 }));
  }
  const updated = { ...ma, leaderStops: ma.leaderStops + 1, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  await bumpScope(context, ma.teamRun, m, (s) => ({ ...s, leaderStops: s.leaderStops + 1 }));
  activity(context, updated, m, "LEADER_STOPPED", {
    detail: JSON.stringify({ leaderAccountId: leaderId, pnlCNS: p.pnlCNS.toString(), limitCNS: p.limitCNS.toString() }),
  });
});

indexer.onEvent({ contract: "MirrorAccount", event: "LevelSet" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const perpId = Number(p.perpId);
  const market = await loadMarket(context, perpId);
  context.Market.set(market);
  const id = `${ma.id}-${perpId}`;
  const prev = await context.MirrorLevel.get(id);
  const active = p.stopLossPNS > 0n || p.takeProfitPNS > 0n;
  context.MirrorLevel.set({
    id,
    mirrorAccount_id: ma.id,
    perpId,
    market_id: market.id,
    side: sideOf(p.side),
    stopLossPNS: p.stopLossPNS,
    takeProfitPNS: p.takeProfitPNS,
    slippageBps: Number(p.slippageBps),
    active,
    setAt: active ? m.timestamp : (prev?.setAt ?? m.timestamp),
    triggeredAt: active ? undefined : prev?.triggeredAt,
    triggeredKind: active ? undefined : prev?.triggeredKind,
    updatedAt: m.timestamp,
  });
  const updated = { ...ma, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  activity(context, updated, m, "LEVEL_SET", {
    detail: JSON.stringify({
      perpId,
      side: sideOf(p.side),
      stopLossPNS: p.stopLossPNS.toString(),
      takeProfitPNS: p.takeProfitPNS.toString(),
      slippageBps: Number(p.slippageBps),
    }),
  });
});

indexer.onEvent({ contract: "MirrorAccount", event: "MarketClosed" }, async ({ event, context }) => {
  const m = metaOf(event);
  const p = event.params;
  const ma = await loadMirror(context, event.srcAddress, m);
  const updated = { ...ma, marketCloseCount: ma.marketCloseCount + 1, lastActivityAt: m.timestamp };
  context.MirrorAccount.set(updated);
  activity(context, updated, m, "MARKET_CLOSED", {
    detail: JSON.stringify({
      perpId: Number(p.perpId),
      slippageBps: Number(p.slippageBps),
      lotsBefore: p.lotsBefore.toString(),
      lotsAfter: p.lotsAfter.toString(),
    }),
  });
});
