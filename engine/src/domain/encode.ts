import { decodeAbiParameters, encodeAbiParameters, getAbiItem, type Hex } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Level, MirrorOrder, Policy } from './types.js';

const followItem = getAbiItem({ abi: mirrorAccountAbi, name: 'follow' });
const policyParam = followItem.inputs[0];
const ordersParam = followItem.inputs[1];
const levelsParam = getAbiItem({ abi: mirrorAccountAbi, name: 'setLevels' }).inputs[0];

export type PolicyStruct = {
  maxLeverageHdths: number;
  maxSlippageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  expiry: number;
  maxEntryDeviationBps: number;
  stopSlippageBps: number;
  flattenOnStop: boolean;
  leaders: readonly { accountId: number; ratioBps: number; budgetCNS: bigint; lossStopBps: number }[];
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
  leaderFillPNS: bigint;
};

export const toPolicyStruct = (p: Policy): PolicyStruct => ({
  maxLeverageHdths: p.maxLeverageHdths,
  maxSlippageBps: p.maxSlippageBps,
  dailyLossBps: p.dailyLossBps,
  drawdownBps: p.drawdownBps,
  expiry: p.expiry,
  maxEntryDeviationBps: p.maxEntryDeviationBps,
  stopSlippageBps: p.stopSlippageBps,
  flattenOnStop: p.flattenOnStop,
  leaders: p.leaders.map((l) => ({ accountId: l.accountId, ratioBps: l.ratioBps, budgetCNS: l.budgetCNS, lossStopBps: l.lossStopBps })),
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
  leaderFillPNS: o.leaderFillPNS,
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

/** abi.encode(Level[]) — the ACTION_SET_LEVELS payload. A level with both prices zero clears that market. */
export function encodeLevels(levels: Level[]): Hex {
  return encodeAbiParameters([levelsParam], [levels.map((l) => ({ perpId: l.perpId, side: l.side, stopLossPNS: l.stopLossPNS, takeProfitPNS: l.takeProfitPNS, slippageBps: l.slippageBps }))]);
}

/** abi.encode(uint32 perpId, uint16 slippageBps) — the ACTION_CLOSE_MARKET payload. */
export function encodeCloseMarket(perpId: number, slippageBps: number): Hex {
  return encodeAbiParameters([{ type: 'uint32' }, { type: 'uint16' }], [perpId, slippageBps]);
}

export const ZERO_REF = `0x${'00'.repeat(32)}` as Hex;

/** Leader account ids in an ACTION_FOLLOW (Policy, MirrorOrder[]) or ACTION_SET_POLICY (Policy) payload. */
export function decodePolicyLeaders(kind: number, data: Hex): number[] {
  const params = kind === 7 ? [policyParam, ordersParam] : [policyParam];
  const [policy] = decodeAbiParameters(params, data) as unknown as [{ leaders: readonly { accountId: number }[] }];
  return policy.leaders.map((l) => Number(l.accountId));
}
