// Owner-signed stop-loss / take-profit levels (MirrorAccount.Level) and the stop-following plans.
// Pure functions: price <-> percent math in raw PNS integers, the contract's own level checks, and the
// owner actions each choice signs. Screens never build a Level or a stop plan by hand.
import { ACTION, LIMITS, encodeCloseAll, encodeCloseMarket, encodeSetLeaderDetached, encodeSetLevels, encodeSetPolicy } from "./contracts";
import { notionalCNS, parseUnits } from "./format";
import type { Hex, Level, MirrorAccount, Policy, Position, PositionLevel, Side } from "./types";
export type { PositionLevel };

/** Slippage bound (from mark) for the closing order when a level fires, and for "Close position". */
export const LEVEL_SLIPPAGE_BPS = 300;
export const CLOSE_SLIPPAGE_BPS = 300;
const BPS = 10_000n;

export type LevelKind = "sl" | "tp";
export type LevelMode = "price" | "pct";

const sideNum = (s: Side): 0 | 1 => (s === "short" ? 1 : 0);
const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

/** Engine `levels[]` (side "long"/"short" or 0/1) -> PositionLevel[]; zero levels are dropped. */
export function normalizeLevels(raw: unknown): PositionLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l: any) => ({
      perpId: Number(l?.perpId),
      side: (l?.side === 1 || String(l?.side).toLowerCase().startsWith("s") ? "short" : "long") as Side,
      stopLossPNS: big(l?.stopLossPNS).toString(),
      takeProfitPNS: big(l?.takeProfitPNS).toString(),
      slippageBps: Number(l?.slippageBps ?? 0),
    }))
    .filter((l) => Number.isFinite(l.perpId) && (l.stopLossPNS !== "0" || l.takeProfitPNS !== "0"));
}

/** The level protecting this position (same market and side), or null. */
export function levelFor(levels: PositionLevel[] | undefined, p: Pick<Position, "perpId" | "side">): PositionLevel | null {
  return levels?.find((l) => l.perpId === p.perpId && l.side === p.side) ?? null;
}

/** Markets where a level fired: opening copies are refused onchain until the next policy (engine `policy.markets[].halted`). */
export function haltedPerps(a: Pick<MirrorAccount, "policy">): number[] {
  const ms = (a.policy?.markets ?? []) as { perpId: number; halted?: boolean }[];
  return ms.filter((m) => m.halted).map((m) => Number(m.perpId));
}

/**
 * Price `pct` percent from entry, in the position's favour (tp) or against it (sl). `pct` is a magnitude
 * (8 = 8%). Long stop-loss = entry x (1 - pct), long take-profit = entry x (1 + pct); a short is mirrored.
 * Rounded to the nearest price unit.
 */
export function priceFromPct(entryPNS: bigint, pct: number, side: Side, kind: LevelKind): bigint {
  const b = BigInt(Math.round(Math.abs(pct) * 100));
  const up = (side === "long") === (kind === "tp");
  const num = entryPNS * (up ? BPS + b : BPS - b);
  return (num + BPS / 2n) / BPS;
}

/** Signed move from `fromPNS` to `toPNS` in percent, positive when it is in the position's favour. */
export function movePct(fromPNS: bigint, toPNS: bigint, side: Side): number {
  if (fromPNS <= 0n) return 0;
  const raw = (Number(toPNS - fromPNS) / Number(fromPNS)) * 100;
  return side === "long" ? raw : -raw;
}

/** PnL (CNS, signed) of `lots` closed at `atPNS`, before fees. */
export function pnlAtCNS(lotLNS: bigint, entryPNS: bigint, atPNS: bigint, side: Side, lotDecimals: number, priceDecimals: number): bigint {
  const diff = side === "long" ? atPNS - entryPNS : entryPNS - atPNS;
  const n = notionalCNS(lotLNS, diff < 0n ? -diff : diff, lotDecimals, priceDecimals);
  return diff < 0n ? -n : n;
}

/** Text typed in the editor -> PNS (0n for empty = no level), or null when it does not parse. */
export function parseLevelInput(text: string, mode: LevelMode, entryPNS: bigint, side: Side, kind: LevelKind, priceDecimals: number): bigint | null {
  const t = text.trim().replace(/[−–]/g, "-").replace(/^[+-]/, "").replace(/%$/, "").trim();
  if (t === "") return 0n;
  if (mode === "price") return parseUnits(t, priceDecimals);
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (kind === "sl" && n >= 100) return null;
  return priceFromPct(entryPNS, n, side, kind);
}

/** The editor's starting text for a saved level, in either mode ("" = none). */
export function levelText(pns: bigint, mode: LevelMode, entryPNS: bigint, side: Side, priceDecimals: number): string {
  if (pns === 0n) return "";
  if (mode === "pct") return Math.abs(movePct(entryPNS, pns, side)).toFixed(1);
  const s = pns.toString().padStart(priceDecimals + 1, "0");
  return priceDecimals ? `${s.slice(0, -priceDecimals)}.${s.slice(-priceDecimals)}` : s;
}

export interface LevelCheck {
  field: "sl" | "tp" | "slippage" | null;
  message: string;
}

/**
 * The contract's _setLevels checks (slippage 1..2000 bps, a long's stop below its take-profit, a short's above)
 * plus one the app adds: a level already reached at the mark would fire at once, for anyone, so it is refused.
 */
export function checkLevels(side: Side, markPNS: bigint, slPNS: bigint, tpPNS: bigint, slippageBps: number): LevelCheck | null {
  if (slPNS === 0n && tpPNS === 0n) return null; // clears the level
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > LIMITS.MAX_CLOSE_ALL_SLIPPAGE_BPS) return { field: "slippage", message: "Slippage between 0.01% and 20%" };
  const long = side === "long";
  if (slPNS !== 0n && tpPNS !== 0n && (long ? slPNS >= tpPNS : slPNS <= tpPNS)) return { field: "sl", message: long ? "Stop-loss must be below the take-profit" : "Stop-loss must be above the take-profit" };
  if (markPNS > 0n) {
    if (slPNS !== 0n && (long ? slPNS >= markPNS : slPNS <= markPNS)) return { field: "sl", message: long ? "Stop-loss must be below the mark, or it fires at once" : "Stop-loss must be above the mark, or it fires at once" };
    if (tpPNS !== 0n && (long ? tpPNS <= markPNS : tpPNS >= markPNS)) return { field: "tp", message: long ? "Take-profit must be above the mark, or it fires at once" : "Take-profit must be below the mark, or it fires at once" };
  }
  return null;
}

export function buildLevel(perpId: number, side: Side, slPNS: bigint, tpPNS: bigint, slippageBps = LEVEL_SLIPPAGE_BPS): Level {
  return { perpId, side: sideNum(side), stopLossPNS: slPNS.toString(), takeProfitPNS: tpPNS.toString(), slippageBps };
}
/** Both prices 0 clears the market's level onchain. */
export const clearLevel = (perpId: number, side: Side): Level => buildLevel(perpId, side, 0n, 0n, LEVEL_SLIPPAGE_BPS);

// ---------------------------------------------------------------- owner actions
export interface PlannedAction {
  kind: number;
  data: Hex;
}

export const setLevelsAction = (levels: Level[]): PlannedAction => ({ kind: ACTION.SET_LEVELS, data: encodeSetLevels(levels) });
export const closeMarketAction = (perpId: number, slippageBps = CLOSE_SLIPPAGE_BPS): PlannedAction => ({ kind: ACTION.CLOSE_MARKET, data: encodeCloseMarket(perpId, slippageBps) });

/** The engine's policy (with `stopped` / `halted` read-outs) as the contract's Policy struct, minus `dropLeader`. */
export function signablePolicy(p: Policy, dropLeader?: number): Policy {
  return {
    maxLeverageHdths: Number(p.maxLeverageHdths),
    maxSlippageBps: Number(p.maxSlippageBps),
    dailyLossBps: Number(p.dailyLossBps),
    drawdownBps: Number(p.drawdownBps),
    expiry: Number(p.expiry),
    maxEntryDeviationBps: Number(p.maxEntryDeviationBps ?? 0),
    stopSlippageBps: Number(p.stopSlippageBps || 300),
    flattenOnStop: !!p.flattenOnStop,
    maxBuilderFeePer100K: Number(p.maxBuilderFeePer100K ?? 0),
    leaders: p.leaders
      .filter((l) => l.accountId !== dropLeader)
      .map((l) => ({ accountId: Number(l.accountId), ratioBps: Number(l.ratioBps), budgetCNS: String(l.budgetCNS), lossStopBps: Number(l.lossStopBps ?? 0) })),
    markets: p.markets.map((m) => ({ perpId: Number(m.perpId), maxNotionalCNS: String(m.maxNotionalCNS) })),
  };
}

/** Saving the same limits again lifts every halted market (the contract resets `halted` on a new policy). */
export function resumeMarketsAction(a: Pick<MirrorAccount, "policy">, nowSec = Math.floor(Date.now() / 1000)): PlannedAction | { error: string } {
  if (!a.policy) return { error: "No limits on this account yet" };
  if (Number(a.policy.expiry) <= nowSec) return { error: "This follow has expired. Edit limits to set a new end date." };
  return { kind: ACTION.SET_POLICY, data: encodeSetPolicy(signablePolicy(a.policy)) };
}

export type StopChoice = "keep" | "close";
export interface StopPlan {
  choice: StopChoice;
  /**
   * "detach": ACTION_SET_LEADER_DETACHED(leader, true). The leader stays in the policy but the account's own
   * contract refuses every copy from it (opens and closes; Blocked LeaderDetached); its positions stay open.
   * "closeAll": the only leader, closed (pauses and closes every position). "removeAndClose": the leader leaves
   * the policy and each market it holds is closed.
   */
  how: "detach" | "closeAll" | "removeAndClose";
  actions: PlannedAction[];
  /** Positions this leader's copies opened (they stay, or are closed). */
  positions: Position[];
  error?: string;
}

const leaderIds = (a: Pick<MirrorAccount, "policy" | "leader">) => (a.policy?.leaders?.length ? a.policy.leaders.map((l) => Number(l.accountId)) : a.leader ? [a.leader.accountId] : []);

/** Positions held for `leaderId` (MirrorAccount.marketLeader); a single-leader account's are all of them. */
export function positionsOfLeader(a: Pick<MirrorAccount, "positions" | "policy" | "leader">, leaderId: number): Position[] {
  const only = leaderIds(a).length <= 1;
  return a.positions.filter((p) => only || p.leaderAccountId === leaderId);
}

/** ACTION_SET_LEADER_DETACHED: stop (true) or resume (false) copying one leader; positions are untouched. */
export function setLeaderDetachedAction(leaderId: number, detached: boolean): PlannedAction {
  return { kind: ACTION.SET_LEADER_DETACHED, data: encodeSetLeaderDetached(leaderId, detached) };
}

/**
 * "Stop following, keep my positions": ACTION_SET_LEADER_DETACHED(leader, true), one signed action. The account's
 * own contract then refuses every copy from this leader, opens and closes; nothing is paused and the other
 * leaders keep copying. The positions stay open with their stop-loss / take-profit.
 * "Stop and close": the only leader -> closeAll (pauses and closes every position); otherwise the leader
 * leaves the policy and each market it holds is closed (same passkey session, consecutive nonces).
 */
export function stopPlan(a: Pick<MirrorAccount, "positions" | "policy" | "leader" | "paused">, leaderId: number, choice: StopChoice, nowSec = Math.floor(Date.now() / 1000)): StopPlan {
  const positions = positionsOfLeader(a, leaderId);
  const ids = leaderIds(a);
  if (choice === "keep") {
    if (a.policy && !a.policy.leaders.some((l) => Number(l.accountId) === Number(leaderId))) return { choice, how: "detach", actions: [], positions, error: "This leader is not in your limits." };
    return { choice, how: "detach", actions: [setLeaderDetachedAction(leaderId, true)], positions };
  }
  if (ids.length <= 1) return { choice, how: "closeAll", actions: [{ kind: ACTION.CLOSE_ALL, data: encodeCloseAll(CLOSE_SLIPPAGE_BPS) }], positions };
  if (!a.policy || Number(a.policy.expiry) <= nowSec) return { choice, how: "removeAndClose", actions: [], positions, error: "This follow has expired. Edit limits first." };
  const remove: PlannedAction = { kind: ACTION.SET_POLICY, data: encodeSetPolicy(signablePolicy(a.policy, leaderId)) };
  return { choice, how: "removeAndClose", actions: [remove, ...positions.map((p) => closeMarketAction(p.perpId))], positions };
}
