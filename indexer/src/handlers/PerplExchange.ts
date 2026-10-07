/**
 * Perpl Exchange handlers. Position events are normalised into a PositionChange and folded by
 * applyPositionChange; account, collateral, funding and market-listing events update their entities.
 */
import { indexer } from "envio";

import { MARKETS } from "../lib/constants.js";
import { mirrorBuilderId } from "../lib/env.js";
import { applyPositionChange } from "../lib/positions.js";
import { checksum, ensureAccount, eventId, loadMarket, metaOf, type Ctx, type Meta } from "../lib/store.js";

// ---------------------------------------------------------------------------------------------
// Accounts and collateral
// ---------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "PerplExchange", event: "AccountCreated" }, async ({ event, context }) => {
  const m = metaOf(event);
  const address = checksum(event.params.account);
  const [account, mirror] = await Promise.all([
    ensureAccount(context, event.params.id, m, address),
    context.MirrorAccount.get(address),
  ]);
  context.PerplAccount.set({
    ...account,
    address,
    createdAt: m.timestamp,
    createdBlock: m.block,
    isMirrorAccount: account.isMirrorAccount || mirror !== undefined,
    mirrorAccount_id: account.mirrorAccount_id ?? mirror?.id,
    teamRun: account.teamRun || (mirror?.teamRun ?? false),
  });
});

async function onCollateral(
  context: Ctx,
  m: Meta,
  accountId: bigint,
  amount: bigint,
  balance: bigint,
  deposit: boolean,
): Promise<void> {
  const account = await ensureAccount(context, accountId, m);
  const totalDeposited = account.totalDepositedCNS + (deposit ? amount : 0n);
  const totalWithdrawn = account.totalWithdrawnCNS + (deposit ? 0n : amount);
  const net = totalDeposited - totalWithdrawn;
  context.PerplAccount.set({
    ...account,
    balanceCNS: balance,
    totalDepositedCNS: totalDeposited,
    totalWithdrawnCNS: totalWithdrawn,
    netDepositedCNS: net,
  });
  const stats = await context.LeaderStats.get(account.id);
  if (stats && net > stats.capitalBaseCNS) context.LeaderStats.set({ ...stats, capitalBaseCNS: net });
}

indexer.onEvent({ contract: "PerplExchange", event: "CollateralDeposit" }, async ({ event, context }) => {
  const p = event.params;
  await onCollateral(context, metaOf(event), p.accountId, p.amountCNS, p.balanceCNS, true);
});

indexer.onEvent({ contract: "PerplExchange", event: "CollateralWithdrawal" }, async ({ event, context }) => {
  const p = event.params;
  await onCollateral(context, metaOf(event), p.accountId, p.amountCNS, p.balanceCNS, false);
});

// ---------------------------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "PerplExchange", event: "PositionOpened" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "OPEN",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: 0n,
    lotsAfter: p.lotLNS,
    eventPrice: p.pricePNS,
    entryPrice: p.pricePNS,
    entryResidueQ16: 0n,
    realizedPnl: 0n,
    funding: 0n,
    fee: p.insFeeCNS + p.protFeeCNS,
    leverage: p.leverageHdths,
    depositBefore: 0n,
    depositAfter: p.depositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionOpenedV2" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "OPEN",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: 0n,
    lotsAfter: p.lotLNS,
    eventPrice: p.pricePNS,
    entryPrice: p.pricePNS,
    entryResidueQ16: p.priceResiduePNSQ16,
    realizedPnl: 0n,
    funding: 0n,
    fee: p.insFeeCNS + p.protFeeCNS,
    leverage: p.leverageHdths,
    depositBefore: 0n,
    depositAfter: p.depositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionIncreased" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "INCREASE",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: p.startLotLNS,
    lotsAfter: p.endLotLNS,
    eventPrice: null,
    entryPrice: p.pricePNS,
    entryResidueQ16: 0n,
    realizedPnl: 0n,
    funding: 0n,
    fee: p.insFeeCNS + p.protFeeCNS,
    leverage: p.leverageHdths,
    depositBefore: p.startDepositCNS,
    depositAfter: p.endDepositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionIncreasedV2" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "INCREASE",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: p.startLotLNS,
    lotsAfter: p.endLotLNS,
    eventPrice: null,
    entryPrice: p.pricePNS,
    entryResidueQ16: p.priceResiduePNSQ16,
    realizedPnl: 0n,
    funding: 0n,
    fee: p.insFeeCNS + p.protFeeCNS,
    leverage: p.leverageHdths,
    depositBefore: p.startDepositCNS,
    depositAfter: p.endDepositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionDecreased" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "DECREASE",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: p.startLotLNS,
    lotsAfter: p.endLotLNS,
    eventPrice: null,
    entryPrice: null,
    entryResidueQ16: 0n,
    realizedPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
    fee: 0n,
    leverage: null,
    depositBefore: p.startDepositCNS,
    depositAfter: p.endDepositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionClosed" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "CLOSE",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: null,
    lotsAfter: 0n,
    eventPrice: p.pricePNS,
    entryPrice: null,
    entryResidueQ16: 0n,
    realizedPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
    fee: 0n,
    leverage: null,
    depositBefore: null,
    depositAfter: 0n,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionInverted" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "INVERT",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: p.startLotLNS,
    lotsAfter: p.endLotLNS,
    eventPrice: p.pricePNS,
    entryPrice: p.pricePNS,
    entryResidueQ16: 0n,
    realizedPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
    fee: p.insFeeCNS + p.protFeeCNS,
    leverage: p.leverageHdths,
    depositBefore: p.startDepositCNS,
    depositAfter: p.endDepositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionLiquidated" }, async ({ event, context }) => {
  const p = event.params;
  // posLotLNS / posDepositCNS are the values left after the liquidation (0 when fully liquidated).
  await applyPositionChange(context, metaOf(event), {
    kind: "LIQUIDATION",
    perpId: p.perpId,
    accountId: p.posAccountId,
    positionType: p.positionType,
    lotsBefore: p.posLotLNS + p.liqLotLNS,
    lotsAfter: p.posLotLNS,
    eventPrice: p.liqPricePNS,
    entryPrice: null,
    entryResidueQ16: 0n,
    realizedPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
    fee: 0n,
    leverage: null,
    depositBefore: null,
    depositAfter: p.posDepositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionDeleveraged" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "DELEVERAGE",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: p.startLotLNS,
    lotsAfter: p.endLotLNS,
    eventPrice: p.deleveragePricePNS,
    entryPrice: p.entryPricePNS,
    entryResidueQ16: 0n,
    realizedPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
    fee: 0n,
    leverage: null,
    depositBefore: p.startDepositCNS,
    depositAfter: p.endDepositCNS,
  });
});

indexer.onEvent({ contract: "PerplExchange", event: "PositionDeleveragedV2" }, async ({ event, context }) => {
  const p = event.params;
  await applyPositionChange(context, metaOf(event), {
    kind: "DELEVERAGE",
    perpId: p.perpId,
    accountId: p.accountId,
    positionType: p.positionType,
    lotsBefore: p.startLotLNS,
    lotsAfter: p.endLotLNS,
    eventPrice: p.deleveragePricePNS,
    entryPrice: p.entryPricePNS,
    entryResidueQ16: p.priceResiduePNSQ16,
    realizedPnl: p.deltaPnlCNS,
    funding: p.fundingCNS,
    fee: 0n,
    leverage: null,
    depositBefore: p.startDepositCNS,
    depositAfter: p.endDepositCNS,
  });
});

/** Withdrawing collateral from a position moves Perpl's entry price; keep it in sync. */
indexer.onEvent({ contract: "PerplExchange", event: "PositionCollateralDecreased" }, async ({ event, context }) => {
  const p = event.params;
  const pos = await context.Position.get(`${p.accountId}-${Number(p.perpId)}`);
  if (!pos || !pos.isOpen) return;
  context.Position.set({
    ...pos,
    entryPricePNS: p.endEntryPricePNS,
    entryResidueQ16: 0n,
    depositCNS: p.endDepositCNS,
    updatedAt: event.block.timestamp,
  });
});

// ---------------------------------------------------------------------------------------------
// Builder fees
// ---------------------------------------------------------------------------------------------

/**
 * Taker fills attributed to Mirror's builder id. The event has no account or perp, so the fill is linked
 * by transaction: the Mirrored handler claims the unclaimed fills logged before it in the same tx (the
 * normal order, since Perpl fills inside execOrderV2 before Mirrored is emitted). Fallback, should a
 * Mirrored log ever be processed first: attach the fill to the nearest later copy in the same tx.
 */
indexer.onEvent({ contract: "PerplExchange", event: "TakerOrderFilledV2" }, async ({ event, context }) => {
  const p = event.params;
  if (p.builderId !== mirrorBuilderId()) return;
  const m = metaOf(event);
  const later = (await context.CopyEvent.getWhere({ txHash: { _eq: m.txHash } }))
    .filter((c) => c.logIndex > m.logIndex)
    .sort((a, b) => a.logIndex - b.logIndex)[0];
  if (later) {
    context.CopyEvent.set({ ...later, builderFeePerplCNS: (later.builderFeePerplCNS ?? 0n) + p.builderFeeCNS });
  }
  context.BuilderFeeFill.set({
    id: eventId(m),
    builderId: p.builderId,
    builderFeeCNS: p.builderFeeCNS,
    feeCNS: p.feeCNS,
    lotLNS: p.lotLNS,
    entryPricePNS: p.entryPricePNS,
    copy_id: later?.id,
    blockNumber: m.block,
    timestamp: m.timestamp,
    txHash: m.txHash,
    logIndex: m.logIndex,
  });
});

// ---------------------------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "PerplExchange", event: "FundingEventCompleted" }, async ({ event, context }) => {
  const market = await loadMarket(context, Number(event.params.perpId));
  context.Market.set({
    ...market,
    fundingEvents: market.fundingEvents + 1,
    lastFundingRatePct100k: event.params.actualRatePct100k,
    lastFundingAt: event.block.timestamp,
  });
});

async function onContractAdded(
  context: Ctx,
  perpId: number,
  symbol: string,
  lotDecimals: number,
  priceDecimals: number,
): Promise<void> {
  const market = await loadMarket(context, perpId);
  context.Market.set({
    ...market,
    symbol: symbol || MARKETS[perpId]?.symbol || market.symbol,
    lotDecimals,
    priceDecimals,
    decimalsKnown: true,
  });
}

indexer.onEvent({ contract: "PerplExchange", event: "ContractAdded" }, async ({ event, context }) => {
  const p = event.params;
  await onContractAdded(context, Number(p.perpId), p.symbol, Number(p.lotDecimals), Number(p.priceDecimals));
});

indexer.onEvent({ contract: "PerplExchange", event: "ContractAddedV2" }, async ({ event, context }) => {
  const p = event.params;
  await onContractAdded(context, Number(p.perpId), p.symbol, Number(p.lotDecimals), Number(p.priceDecimals));
});
