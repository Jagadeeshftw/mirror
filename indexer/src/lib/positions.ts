/**
 * The single code path for every Perpl position event: updates Position, Market, PositionEvent,
 * the account's performance aggregates, scope stats and, for MirrorAccounts, the FIFO lot queue
 * that attributes realized PnL to leaders.
 */
import type { Entity, Enum } from "envio";

import { UNATTRIBUTED_LEADER, sideOf } from "./constants.js";
import { EMPTY_QUEUE, allocateByLots, consumeLots, pushLots, totalLots, type LotQueue } from "./fifo.js";
import { exitPriceFromPnl, increaseFillPrice, max, notionalCNS, toQ16 } from "./math.js";
import {
  bumpDaily,
  bumpScope,
  ensureAccount,
  eventId,
  loadMarket,
  recordTrade,
  type Ctx,
  type Meta,
} from "./store.js";

type Kind = Enum<"PositionEventKind">;
type PriceSource = Enum<"PriceSource">;

export type PositionChange = {
  kind: Kind;
  perpId: bigint;
  accountId: bigint;
  positionType: bigint;
  /** Lots before the event; null = take from the tracked position. */
  lotsBefore: bigint | null;
  lotsAfter: bigint;
  /** Execution price when the event emits one. */
  eventPrice: bigint | null;
  /** New average entry (OPEN/INCREASE/INVERT) or the event's entry (DELEVERAGE). */
  entryPrice: bigint | null;
  entryResidueQ16: bigint;
  realizedPnl: bigint;
  funding: bigint;
  fee: bigint;
  leverage: bigint | null;
  depositBefore: bigint | null;
  depositAfter: bigint | null;
};

const CLOSING_KINDS: ReadonlySet<Kind> = new Set(["DECREASE", "CLOSE", "INVERT", "LIQUIDATION", "DELEVERAGE"]);

export async function applyPositionChange(ctx: Ctx, m: Meta, c: PositionChange): Promise<void> {
  const perpId = Number(c.perpId);
  const posId = `${c.accountId}-${perpId}`;
  const [account, market, pos, queueEntity] = await Promise.all([
    ensureAccount(ctx, c.accountId, m),
    loadMarket(ctx, perpId),
    ctx.Position.get(posId),
    ctx.FollowerLotQueue.get(posId),
  ]);

  const side = sideOf(c.positionType);
  const prevOpen = pos !== undefined && pos.isOpen;
  const prevKnown = prevOpen && pos.lotsKnown;

  // ---- lots
  let lotsBefore: bigint | null = c.lotsBefore;
  if (c.kind === "OPEN") lotsBefore = 0n;
  if (lotsBefore === null) lotsBefore = prevKnown ? pos.lotsLNS : null;
  const lotsKnown = lotsBefore !== null;
  const before = lotsBefore ?? 0n;
  let opened = 0n;
  let closed = 0n;
  switch (c.kind) {
    case "OPEN":
      opened = c.lotsAfter;
      break;
    case "INCREASE":
      opened = max(0n, c.lotsAfter - before);
      break;
    case "INVERT":
      closed = before;
      opened = c.lotsAfter;
      break;
    default:
      closed = lotsKnown ? max(0n, before - c.lotsAfter) : 0n;
  }

  // ---- execution price
  const entryBeforeQ16 = prevOpen && pos.entryPricePNS > 0n ? toQ16(pos.entryPricePNS, pos.entryResidueQ16) : 0n;
  let price = 0n;
  let source: PriceSource = "NONE";
  const fallback = () => {
    if (market.lastPricePNS > 0n) {
      price = market.lastPricePNS;
      source = "LAST_TRADE";
    }
  };
  if (c.kind === "INCREASE") {
    const fill =
      lotsKnown && entryBeforeQ16 > 0n && c.entryPrice !== null
        ? increaseFillPrice(entryBeforeQ16, before, toQ16(c.entryPrice, c.entryResidueQ16), c.lotsAfter)
        : null;
    if (fill !== null) {
      price = fill;
      source = "DERIVED_FROM_ENTRY";
    } else fallback();
  } else if (c.kind === "DECREASE") {
    const exit =
      entryBeforeQ16 > 0n
        ? exitPriceFromPnl(side, entryBeforeQ16, c.realizedPnl, closed, market.lotDecimals, market.priceDecimals)
        : null;
    if (exit !== null) {
      price = exit;
      source = "DERIVED_FROM_PNL";
    } else fallback();
  } else if (c.eventPrice !== null && c.eventPrice > 0n) {
    price = c.eventPrice;
    source = "EVENT";
  } else fallback();

  const value = (lots: bigint) =>
    market.decimalsKnown ? notionalCNS(lots, price, market.lotDecimals, market.priceDecimals) : 0n;
  const notional = value(opened + closed);
  const openingNotional = value(opened);
  const leverage = c.leverage ?? BigInt(pos?.leverageHdths ?? 0);
  const netPnl = c.realizedPnl + c.funding - c.fee;
  const closing = CLOSING_KINDS.has(c.kind);
  const outcome = c.realizedPnl + c.funding;

  // ---- position
  const isOpen = c.lotsAfter > 0n;
  let entryPrice = pos?.entryPricePNS ?? 0n;
  let entryResidue = pos?.entryResidueQ16 ?? 0n;
  if ((c.kind === "OPEN" || c.kind === "INCREASE" || c.kind === "INVERT") && c.entryPrice !== null) {
    entryPrice = c.entryPrice;
    entryResidue = c.entryResidueQ16;
  } else if (c.kind === "DELEVERAGE" && c.entryPrice !== null && c.entryPrice > 0n) {
    entryPrice = c.entryPrice;
    entryResidue = c.entryResidueQ16;
  }
  const newCycle = isOpen && (!prevOpen || c.kind === "INVERT" || c.kind === "OPEN");
  const position: Entity<"Position"> = {
    id: posId,
    account_id: account.id,
    market_id: market.id,
    perpId,
    side,
    lotsLNS: c.lotsAfter,
    entryPricePNS: isOpen ? entryPrice : 0n,
    entryResidueQ16: isOpen ? entryResidue : 0n,
    depositCNS: c.depositAfter ?? (isOpen ? (pos?.depositCNS ?? 0n) : 0n),
    leverageHdths: Number(leverage),
    isOpen,
    lotsKnown: true,
    openedAt: newCycle ? m.timestamp : (pos?.openedAt ?? m.timestamp),
    openedBlock: newCycle ? m.block : (pos?.openedBlock ?? m.block),
    updatedAt: m.timestamp,
    realizedPnlCNS: (pos?.realizedPnlCNS ?? 0n) + c.realizedPnl,
    fundingCNS: (pos?.fundingCNS ?? 0n) + c.funding,
    feesCNS: (pos?.feesCNS ?? 0n) + c.fee,
    trades: (pos?.trades ?? 0) + 1,
    lastExecPricePNS: price,
    lastTxHash: m.txHash,
    isMirrorAccount: account.isMirrorAccount,
    teamRun: account.teamRun,
    // Set by the Mirrored handler (later log, same tx); kept while the same position stays open.
    heldForLeaderAccountId: isOpen && !newCycle ? pos?.heldForLeaderAccountId : undefined,
  };
  ctx.Position.set(position);

  // ---- market (open interest only moves for sizes we have observed)
  let longLots = market.longLotsLNS;
  let shortLots = market.shortLotsLNS;
  if (prevKnown) {
    if (pos.side === "LONG") longLots -= pos.lotsLNS;
    else shortLots -= pos.lotsLNS;
  }
  if (isOpen) {
    if (side === "LONG") longLots += c.lotsAfter;
    else shortLots += c.lotsAfter;
  }
  const exactPrice = source === "EVENT" || source === "DERIVED_FROM_PNL" || source === "DERIVED_FROM_ENTRY";
  ctx.Market.set({
    ...market,
    lastPricePNS: exactPrice ? price : market.lastPricePNS,
    lastTradeAt: m.timestamp,
    volumeCNS: market.volumeCNS + notional,
    trades: market.trades + 1,
    longLotsLNS: max(0n, longLots),
    shortLotsLNS: max(0n, shortLots),
  });

  // ---- trade history
  ctx.PositionEvent.set({
    id: eventId(m),
    account_id: account.id,
    accountId: c.accountId,
    position_id: posId,
    market_id: market.id,
    perpId,
    kind: c.kind,
    side,
    lotsBeforeLNS: before,
    lotsAfterLNS: c.lotsAfter,
    lotsTradedLNS: opened + closed,
    lotsClosedLNS: closed,
    lotsOpenedLNS: opened,
    lotsKnown,
    pricePNS: price,
    priceSource: source,
    entryPricePNS: position.entryPricePNS,
    notionalCNS: notional,
    realizedPnlCNS: c.realizedPnl,
    fundingCNS: c.funding,
    feeCNS: c.fee,
    netPnlCNS: netPnl,
    leverageHdths: Number(leverage),
    depositBeforeCNS: c.depositBefore ?? pos?.depositCNS ?? 0n,
    depositAfterCNS: position.depositCNS,
    isMirrorAccount: account.isMirrorAccount,
    teamRun: account.teamRun,
    blockNumber: m.block,
    timestamp: m.timestamp,
    txHash: m.txHash,
    logIndex: m.logIndex,
  });

  // ---- performance aggregates
  await recordTrade(ctx, account, {
    perpId,
    block: m.block,
    timestamp: m.timestamp,
    trades: 1,
    openingTrades: opened > 0n ? 1 : 0,
    closingTrades: closing ? 1 : 0,
    wins: closing && outcome > 0n ? 1 : 0,
    losses: closing && outcome < 0n ? 1 : 0,
    liquidations: c.kind === "LIQUIDATION" ? 1 : 0,
    realizedPnlCNS: c.realizedPnl,
    fundingCNS: c.funding,
    feesCNS: c.fee,
    netPnlCNS: netPnl,
    volumeCNS: notional,
    openingNotionalCNS: openingNotional,
    leverageNotionalSum: leverage * openingNotional,
    openPositionsDelta: (isOpen ? 1 : 0) - (prevOpen ? 1 : 0),
  });

  // ---- scope stats
  await bumpScope(ctx, account.teamRun, m, (s) => ({
    ...s,
    perplTrades: s.perplTrades + 1,
    perplVolumeCNS: s.perplVolumeCNS + notional,
    followerRealizedPnlCNS: s.followerRealizedPnlCNS + (account.isMirrorAccount ? outcome : 0n),
  }));
  await bumpDaily(ctx, account.teamRun, m, (d) => ({
    ...d,
    perplTrades: d.perplTrades + 1,
    perplVolumeCNS: d.perplVolumeCNS + notional,
  }));

  // ---- follower FIFO attribution
  if (account.isMirrorAccount && account.mirrorAccount_id) {
    let queue: LotQueue = queueEntity ?? EMPTY_QUEUE;
    let pendingFee = queueEntity?.pendingFeeCNS ?? 0n;
    if (closing) {
      const toClose = c.kind === "INVERT" || c.lotsAfter === 0n ? max(closed, totalLots(queue)) : closed;
      const { queue: rest, parts } = consumeLots(queue, toClose);
      queue = rest;
      if (parts.length > 0) {
        const pnlShares = allocateByLots(c.realizedPnl, parts);
        const fundingShares = allocateByLots(c.funding, parts);
        for (let i = 0; i < parts.length; i++) {
          await attributeFollowerPnl(ctx, m, {
            mirrorAccountId: account.mirrorAccount_id,
            followerAccountId: c.accountId,
            leaderId: parts[i]!.leaderId,
            teamRun: account.teamRun,
            realized: pnlShares[i]!,
            funding: fundingShares[i]!,
          });
        }
      }
    }
    if (c.lotsAfter === 0n) queue = EMPTY_QUEUE;
    if (opened > 0n) {
      queue = pushLots(queue, UNATTRIBUTED_LEADER, opened);
      pendingFee += c.fee;
    }
    ctx.FollowerLotQueue.set({
      id: posId,
      mirrorAccountId: account.mirrorAccount_id,
      leaderIds: queue.leaderIds,
      lots: queue.lots,
      pendingFeeCNS: pendingFee,
    });
  }
}

export function newFollowerLeaderPnl(
  mirrorAccountId: string,
  followerAccountId: bigint,
  leaderId: string,
  teamRun: boolean,
  m: Meta,
): Entity<"FollowerLeaderPnl"> {
  return {
    id: `${mirrorAccountId}-${leaderId}`,
    mirrorAccount_id: mirrorAccountId,
    followerAccountId,
    leaderAccountId: BigInt(leaderId),
    leader_id: leaderId === UNATTRIBUTED_LEADER ? undefined : leaderId,
    realizedPnlCNS: 0n,
    fundingCNS: 0n,
    feesCNS: 0n,
    netPnlCNS: 0n,
    closedLotsFills: 0,
    wins: 0,
    losses: 0,
    copiedOpens: 0,
    copiedCloses: 0,
    copiedNotionalCNS: 0n,
    teamRun,
    updatedAt: m.timestamp,
  };
}

async function attributeFollowerPnl(
  ctx: Ctx,
  m: Meta,
  a: {
    mirrorAccountId: string;
    followerAccountId: bigint;
    leaderId: string;
    teamRun: boolean;
    realized: bigint;
    funding: bigint;
  },
): Promise<void> {
  const id = `${a.mirrorAccountId}-${a.leaderId}`;
  const cur =
    (await ctx.FollowerLeaderPnl.get(id)) ??
    newFollowerLeaderPnl(a.mirrorAccountId, a.followerAccountId, a.leaderId, a.teamRun, m);
  const outcome = a.realized + a.funding;
  ctx.FollowerLeaderPnl.set({
    ...cur,
    realizedPnlCNS: cur.realizedPnlCNS + a.realized,
    fundingCNS: cur.fundingCNS + a.funding,
    netPnlCNS: cur.netPnlCNS + outcome,
    closedLotsFills: cur.closedLotsFills + 1,
    wins: cur.wins + (outcome > 0n ? 1 : 0),
    losses: cur.losses + (outcome < 0n ? 1 : 0),
    updatedAt: m.timestamp,
  });
  if (a.leaderId !== UNATTRIBUTED_LEADER && !a.teamRun) {
    const leader = await ctx.LeaderStats.get(a.leaderId);
    if (leader) ctx.LeaderStats.set({ ...leader, followerPnlCNS: leader.followerPnlCNS + outcome });
  }
}
