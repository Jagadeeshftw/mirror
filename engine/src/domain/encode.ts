import { encodeAbiParameters, getAbiItem, type Hex } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { MirrorOrder, Policy } from './types.js';

const followItem = getAbiItem({ abi: mirrorAccountAbi, name: 'follow' });
const policyParam = followItem.inputs[0];
const ordersParam = followItem.inputs[1];

export type PolicyStruct = {
  maxLeverageHdths: number;
  maxSlippageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  expiry: number;
  leaders: readonly { accountId: number; ratioBps: number }[];
  markets: readonly { perpId: number; maxNotionalCNS: bigint }[];
};

export type OrderStruct = {
  leaderAccountId: number;
  perpId: number;
  orderType: number;
  lotLNS: bigint;
  pricePNS: bigint;
  leverageHdths: number;
  maxMatches: number;
  leaderRef: Hex;
};

export const toPolicyStruct = (p: Policy): PolicyStruct => ({
  maxLeverageHdths: p.maxLeverageHdths,
  maxSlippageBps: p.maxSlippageBps,
  dailyLossBps: p.dailyLossBps,
  drawdownBps: p.drawdownBps,
  expiry: p.expiry,
  leaders: p.leaders.map((l) => ({ accountId: l.accountId, ratioBps: l.ratioBps })),
  markets: p.markets.map((m) => ({ perpId: m.perpId, maxNotionalCNS: m.maxNotionalCNS })),
});

export const toOrderStruct = (o: MirrorOrder): OrderStruct => ({
  leaderAccountId: o.leaderAccountId,
  perpId: o.perpId,
  orderType: o.orderType,
  lotLNS: o.lotLNS,
  pricePNS: o.pricePNS,
  leverageHdths: o.leverageHdths,
  maxMatches: o.maxMatches,
  leaderRef: o.leaderRef,
});

/** abi.encode(MirrorOrder[]) — the ACTION_MATCH_NOW payload. */
export function encodeOrders(orders: MirrorOrder[]): Hex {
  return encodeAbiParameters([ordersParam], [orders.map(toOrderStruct)]);
}

/** abi.encode(Policy, MirrorOrder[]) — the ACTION_FOLLOW payload. */
export function encodeFollowData(p: Policy, orders: MirrorOrder[]): Hex {
  return encodeAbiParameters([policyParam, ordersParam], [toPolicyStruct(p), orders.map(toOrderStruct)]);
}

export function encodePolicy(p: Policy): Hex {
  return encodeAbiParameters([policyParam], [toPolicyStruct(p)]);
}

export const ZERO_REF = `0x${'00'.repeat(32)}` as Hex;
