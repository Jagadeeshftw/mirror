// MirrorAccount ABI encoding and EIP-712 typed data, matching contracts/src/MirrorAccount.sol exactly.
import {
  encodeAbiParameters,
  encodePacked,
  getContractAddress,
  hashTypedData,
  keccak256,
  parseSignature,
  toHex,
  type TypedDataDomain,
} from "viem";
import type { Address, Hex, Level, MirrorOrderJson, Policy } from "./types";

export const ACTION = {
  SET_POLICY: 1,
  SET_PAUSED: 2,
  CLOSE_ALL: 3,
  WITHDRAW: 4,
  EXCHANGE_CALL: 5,
  SWEEP: 6,
  FOLLOW: 7,
  MATCH_NOW: 8,
  SET_LEVELS: 9,
  CLOSE_MARKET: 10,
} as const;
export type ActionKind = (typeof ACTION)[keyof typeof ACTION];

export const LIMITS = {
  MAX_LEADERS: 4,
  MAX_MARKETS: 16,
  MAX_RATIO_BPS: 10_000,
  MIN_LEVERAGE_HDTHS: 100,
  MAX_LEVERAGE_HDTHS: 10_000,
  MAX_SLIPPAGE_BPS: 1_000,
  MAX_CLOSE_ALL_SLIPPAGE_BPS: 2_000,
  MAX_MATCH_ORDERS: 16,
} as const;

/** keccak256("MIRROR_MATCH_NOW"): the contract overwrites leaderRef with this for match-now orders. */
export const MATCH_NOW_REF = keccak256(toHex("MIRROR_MATCH_NOW"));

export const BLOCK_REASONS = [
  "None",
  "Paused",
  "Expired",
  "LeaderNotAllowed",
  "LeaderSideMismatch",
  "MarketNotAllowed",
  "LeverageTooHigh",
  "SlippageTooHigh",
  "FlipNotAllowed",
  "StaleMark",
  "ExceedsLeaderTarget",
  "ExceedsMaxNotional",
  "DailyLossStop",
  "DrawdownStop",
  "LeverageTooLow",
  "EntryTooFar",
  "MarketHeldByOtherLeader",
  "LeaderBudgetExceeded",
  "LeaderLossStop",
  "MarketHalted",
  "CloseBelowTarget",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

// ---------- ABI parameter shapes ----------
export const LEADER_RULE_COMPONENTS = [
  { name: "accountId", type: "uint32" },
  { name: "ratioBps", type: "uint32" },
  { name: "budgetCNS", type: "uint64" },
  { name: "lossStopBps", type: "uint16" },
] as const;
export const MARKET_RULE_COMPONENTS = [
  { name: "perpId", type: "uint32" },
  { name: "maxNotionalCNS", type: "uint64" },
] as const;
export const POLICY_PARAM = {
  name: "p",
  type: "tuple",
  components: [
    { name: "maxLeverageHdths", type: "uint16" },
    { name: "maxSlippageBps", type: "uint16" },
    { name: "dailyLossBps", type: "uint16" },
    { name: "drawdownBps", type: "uint16" },
    { name: "expiry", type: "uint40" },
    { name: "maxEntryDeviationBps", type: "uint16" },
    { name: "stopSlippageBps", type: "uint16" },
    { name: "flattenOnStop", type: "bool" },
    { name: "leaders", type: "tuple[]", components: LEADER_RULE_COMPONENTS },
    { name: "markets", type: "tuple[]", components: MARKET_RULE_COMPONENTS },
  ],
} as const;
export const MIRROR_ORDER_COMPONENTS = [
  { name: "leaderAccountId", type: "uint32" },
  { name: "perpId", type: "uint32" },
  { name: "orderType", type: "uint8" },
  { name: "lotLNS", type: "uint64" },
  { name: "pricePNS", type: "uint64" },
  { name: "leverageHdths", type: "uint16" },
  { name: "maxMatches", type: "uint16" },
  { name: "leaderRef", type: "bytes32" },
  { name: "leaderFillPNS", type: "uint64" },
] as const;
export const LEVELS_PARAM = {
  name: "levels",
  type: "tuple[]",
  components: [
    { name: "perpId", type: "uint32" },
    { name: "side", type: "uint8" },
    { name: "stopLossPNS", type: "uint64" },
    { name: "takeProfitPNS", type: "uint64" },
    { name: "slippageBps", type: "uint16" },
  ],
} as const;
export const MIRROR_ORDERS_PARAM = { name: "m", type: "tuple[]", components: MIRROR_ORDER_COMPONENTS } as const;

function policyValue(p: Policy) {
  return {
    maxLeverageHdths: p.maxLeverageHdths,
    maxSlippageBps: p.maxSlippageBps,
    dailyLossBps: p.dailyLossBps,
    drawdownBps: p.drawdownBps,
    expiry: p.expiry,
    maxEntryDeviationBps: p.maxEntryDeviationBps,
    stopSlippageBps: p.stopSlippageBps,
    flattenOnStop: p.flattenOnStop,
    leaders: p.leaders.map((l) => ({ accountId: l.accountId, ratioBps: l.ratioBps, budgetCNS: BigInt(l.budgetCNS), lossStopBps: l.lossStopBps })),
    markets: p.markets.map((m) => ({ perpId: m.perpId, maxNotionalCNS: BigInt(m.maxNotionalCNS) })),
  };
}

function orderValue(o: MirrorOrderJson) {
  return {
    leaderAccountId: o.leaderAccountId,
    perpId: o.perpId,
    orderType: o.orderType,
    lotLNS: BigInt(o.lotLNS),
    pricePNS: BigInt(o.pricePNS),
    leverageHdths: o.leverageHdths,
    maxMatches: o.maxMatches,
    leaderRef: o.leaderRef,
    leaderFillPNS: BigInt(o.leaderFillPNS ?? "0"),
  };
}

/** abi.encode(Policy) for ACTION_SET_POLICY. */
export function encodeSetPolicy(p: Policy): Hex {
  return encodeAbiParameters([POLICY_PARAM], [policyValue(p)]);
}
/** abi.encode(Policy, MirrorOrder[]) for ACTION_FOLLOW. */
export function encodeFollow(p: Policy, orders: MirrorOrderJson[]): Hex {
  return encodeAbiParameters([POLICY_PARAM, MIRROR_ORDERS_PARAM], [policyValue(p), orders.map(orderValue)]);
}
/** abi.encode(MirrorOrder[]) for ACTION_MATCH_NOW. */
export function encodeMatchNow(orders: MirrorOrderJson[]): Hex {
  return encodeAbiParameters([MIRROR_ORDERS_PARAM], [orders.map(orderValue)]);
}
export function encodeOrders(orders: MirrorOrderJson[]): Hex {
  return encodeMatchNow(orders);
}
export function encodePaused(paused: boolean): Hex {
  return encodeAbiParameters([{ type: "bool" }], [paused]);
}
export function encodeCloseAll(slippageBps: number): Hex {
  return encodeAbiParameters([{ type: "uint16" }], [slippageBps]);
}
/** abi.encode(Level[]) for ACTION_SET_LEVELS; a level with both prices 0 clears that market. */
export function encodeSetLevels(levels: Level[]): Hex {
  return encodeAbiParameters(
    [LEVELS_PARAM],
    [levels.map((l) => ({ perpId: l.perpId, side: l.side, stopLossPNS: BigInt(l.stopLossPNS), takeProfitPNS: BigInt(l.takeProfitPNS), slippageBps: l.slippageBps }))],
  );
}
/** abi.encode(uint32 perpId, uint16 slippageBps) for ACTION_CLOSE_MARKET. */
export function encodeCloseMarket(perpId: number, slippageBps: number): Hex {
  return encodeAbiParameters([{ type: "uint32" }, { type: "uint16" }], [perpId, slippageBps]);
}
export function encodeWithdraw(amountCNS: bigint): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [amountCNS]);
}

// ---------- Policy validation (same checks as _setPolicy) ----------
export function validatePolicy(p: Policy, nowSec = Math.floor(Date.now() / 1000), selfAccountId?: number): string | null {
  if (p.maxLeverageHdths < LIMITS.MIN_LEVERAGE_HDTHS || p.maxLeverageHdths > LIMITS.MAX_LEVERAGE_HDTHS) return "maxLeverageHdths";
  if (p.maxSlippageBps === 0 || p.maxSlippageBps > LIMITS.MAX_SLIPPAGE_BPS) return "maxSlippageBps";
  if (p.dailyLossBps >= 10_000) return "dailyLossBps";
  if (p.drawdownBps >= 10_000) return "drawdownBps";
  if (p.expiry <= nowSec) return "expiry";
  if (p.maxEntryDeviationBps > 5_000) return "maxEntryDeviationBps";
  if (p.stopSlippageBps === 0 || p.stopSlippageBps > 2_000) return "stopSlippageBps";
  if (p.leaders.length === 0 || p.leaders.length > LIMITS.MAX_LEADERS) return "leaders";
  if (p.markets.length === 0 || p.markets.length > LIMITS.MAX_MARKETS) return "markets";
  const seen = new Set<number>();
  for (const l of p.leaders) {
    if (l.accountId === 0 || (selfAccountId && l.accountId === selfAccountId)) return "leader.accountId";
    if (l.ratioBps === 0 || l.ratioBps > LIMITS.MAX_RATIO_BPS) return "leader.ratioBps";
    if (BigInt(l.budgetCNS) === 0n) return "leader.budgetCNS";
    if (l.lossStopBps > 10_000) return "leader.lossStopBps";
    if (seen.has(l.accountId)) return "leader.duplicate";
    seen.add(l.accountId);
  }
  const seenM = new Set<number>();
  for (const m of p.markets) {
    if (BigInt(m.maxNotionalCNS) === 0n) return "market.maxNotionalCNS";
    if (seenM.has(m.perpId)) return "market.duplicate";
    seenM.add(m.perpId);
  }
  return null;
}

// ---------- EIP-712 ----------
export const ACTION_TYPES = {
  Action: [
    { name: "kind", type: "uint8" },
    { name: "data", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface ActionMessage {
  kind: number;
  data: Hex;
  nonce: bigint;
  deadline: bigint;
}

export function mirrorDomain(account: Address, chainId: number): TypedDataDomain {
  return { name: "Mirror Account", version: "1", chainId, verifyingContract: account };
}

export function actionTypedData(account: Address, chainId: number, a: ActionMessage) {
  return {
    domain: mirrorDomain(account, chainId),
    types: ACTION_TYPES,
    primaryType: "Action" as const,
    message: a,
  };
}

/** Same digest as MirrorAccount.actionDigest(a). */
export function actionDigest(account: Address, chainId: number, a: ActionMessage): Hex {
  return hashTypedData(actionTypedData(account, chainId, a));
}

export const AUSD_DOMAIN_NAME = "Agora Dollar";
export const AUSD_DOMAIN_VERSION = "1";
export function ausdDomain(token: Address, chainId: number): TypedDataDomain {
  return { name: AUSD_DOMAIN_NAME, version: AUSD_DOMAIN_VERSION, chainId, verifyingContract: token };
}

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function permitTypedData(
  token: Address,
  chainId: number,
  m: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
) {
  return { domain: ausdDomain(token, chainId), types: PERMIT_TYPES, primaryType: "Permit" as const, message: m };
}

const AUTH_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;
export const RECEIVE_AUTH_TYPES = { ReceiveWithAuthorization: AUTH_FIELDS } as const;
export const TRANSFER_AUTH_TYPES = { TransferWithAuthorization: AUTH_FIELDS } as const;

export interface AuthMessage {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export function receiveAuthTypedData(token: Address, chainId: number, m: AuthMessage) {
  return {
    domain: ausdDomain(token, chainId),
    types: RECEIVE_AUTH_TYPES,
    primaryType: "ReceiveWithAuthorization" as const,
    message: m,
  };
}
export function transferAuthTypedData(token: Address, chainId: number, m: AuthMessage) {
  return {
    domain: ausdDomain(token, chainId),
    types: TRANSFER_AUTH_TYPES,
    primaryType: "TransferWithAuthorization" as const,
    message: m,
  };
}

/** 65-byte signature → {v, r, s} for permit / ERC-3009 relays. */
export function splitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const p = parseSignature(sig);
  const v = p.v !== undefined ? Number(p.v) : 27 + (p.yParity ?? 0);
  return { v, r: p.r, s: p.s };
}

// ---------- Account address prediction (EIP-1167 clone via CREATE2, OZ Clones) ----------
export function cloneInitCode(implementation: Address): Hex {
  return encodePacked(
    ["bytes", "address", "bytes"],
    ["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, "0x5af43d82803e903d91602b57fd5bf3"],
  );
}
/** Same as MirrorAccountFactory.predictAccount(owner, salt). */
export function predictAccount(factory: Address, implementation: Address, owner: Address, salt: Hex): Address {
  const s = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, salt]));
  return getContractAddress({ opcode: "CREATE2", from: factory, salt: s, bytecode: cloneInitCode(implementation) });
}
/** Salt for the n-th follow account of an owner: bytes32(n). One MirrorAccount per follow. */
export function followSalt(index: number): Hex {
  return toHex(BigInt(index), { size: 32 });
}
