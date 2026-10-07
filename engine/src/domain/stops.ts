import { BPS_ONE, LONG, type Level, type Position } from './math.js';
import { mulDiv } from './planner.js';

/** MirrorAccount.MAX_MARK_ORACLE_GAP_BPS: triggers refuse to act when mark and a fresh oracle disagree more. */
export const MAX_MARK_ORACLE_GAP_BPS = 200n;

export interface PriceState {
  mark: bigint;
  markValid: boolean;
  oraclePNS: bigint;
  oracleFresh: boolean;
}

/** Same as MirrorAccount._trustedMark, without reverting: false where the trigger would revert UntrustedPrice. */
export function trustedMark(p: PriceState): boolean {
  if (!p.markValid || p.mark === 0n) return false;
  if (!p.oracleFresh) return true;
  const gap = p.mark > p.oraclePNS ? p.mark - p.oraclePNS : p.oraclePNS - p.mark;
  return gap * BPS_ONE <= p.oraclePNS * MAX_MARK_ORACLE_GAP_BPS;
}

/** MirrorAccount._reached: long stop-loss at or below the level, long take-profit at or above; short mirrored. */
function reached(long: boolean, profit: boolean, levelPNS: bigint, p: PriceState): boolean {
  const below = long !== profit;
  if (!(below ? p.mark <= levelPNS : p.mark >= levelPNS)) return false;
  if (!p.oracleFresh) return true;
  return below ? p.oraclePNS <= levelPNS : p.oraclePNS >= levelPNS;
}

/**
 * Which side of an owner level triggerLevel would execute now, in the contract's order (stop-loss first), or
 * undefined if it would revert StopNotTriggered / UntrustedPrice.
 */
export function levelHit(level: Level, position: Position, p: PriceState): 'StopLoss' | 'TakeProfit' | undefined {
  if (level.stopLossPNS === 0n && level.takeProfitPNS === 0n) return undefined;
  if (position.lots === 0n || position.side !== level.side) return undefined;
  if (!trustedMark(p)) return undefined;
  const long = level.side === LONG;
  if (level.stopLossPNS !== 0n && reached(long, false, level.stopLossPNS, p)) return 'StopLoss';
  if (level.takeProfitPNS !== 0n && reached(long, true, level.takeProfitPNS, p)) return 'TakeProfit';
  return undefined;
}

export interface AccountRiskState {
  now: number;
  equity: bigint;
  riskDay: number;
  dayStartEquity: bigint;
  highWaterEquity: bigint;
  dailyLossBps: number;
  drawdownBps: number;
}

/** MirrorAccount._checkLossStops as triggerAccountStop sees it: which account stop is hit now, if any. */
export function accountStopHit(s: AccountRiskState): 'DailyLoss' | 'Drawdown' | undefined {
  const today = Math.floor(s.now / 86_400);
  const dayStart = today !== s.riskDay ? s.equity : s.dayStartEquity;
  const hwm = s.equity > s.highWaterEquity ? s.equity : s.highWaterEquity;
  if (s.dailyLossBps !== 0 && s.equity < mulDiv(dayStart, BPS_ONE - BigInt(s.dailyLossBps), BPS_ONE)) return 'DailyLoss';
  if (s.drawdownBps !== 0 && s.equity < mulDiv(hwm, BPS_ONE - BigInt(s.drawdownBps), BPS_ONE)) return 'Drawdown';
  return undefined;
}

/** triggerLeaderStop's condition: realised since added + unrealised on the leader's markets < -lossStopBps x budget. */
export function leaderStopHit(realizedCNS: bigint, unrealizedCNS: bigint, budgetCNS: bigint, lossStopBps: number): boolean {
  if (lossStopBps === 0) return false;
  const lossLimit = mulDiv(budgetCNS, BigInt(lossStopBps), BPS_ONE);
  return realizedCNS + unrealizedCNS < -lossLimit;
}
