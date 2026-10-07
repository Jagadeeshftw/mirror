// "What if I had followed": request building and result shaping for POST /v1/leaders/:id/backtest.
// The engine picks the fill slippage itself (the leader's measured median copy deviation, else the
// protocol median, else 5 bps) and says which in `slippage.source`, so the app never sends `slippageBps`.
import { ApiError } from "./api";
import type { BacktestPeriod, BacktestRequest, BacktestResult } from "./engineTypes";
import { ruleWithLimit } from "./blockReasons";
import type { Policy } from "./types";

export const BACKTEST_PERIODS: BacktestPeriod[] = [7, 30, 90];

/** Body for the backtest from the policy the follow sheet would sign (single leader) and the deposit. */
export function backtestRequest(policy: Policy, depositCNS: bigint, period: BacktestPeriod, leaderAccountId?: number): BacktestRequest {
  const leader = (leaderAccountId !== undefined ? policy.leaders.find((l) => l.accountId === leaderAccountId) : undefined) ?? policy.leaders[0];
  if (!leader) throw new Error("Policy has no leader");
  return {
    ratioBps: leader.ratioBps,
    maxLeverageHdths: policy.maxLeverageHdths,
    maxSlippageBps: policy.maxSlippageBps,
    markets: policy.markets.map((m) => ({ perpId: m.perpId, maxNotionalCNS: String(m.maxNotionalCNS) })),
    maxEntryDeviationBps: policy.maxEntryDeviationBps,
    budgetCNS: String(leader.budgetCNS),
    lossStopBps: leader.lossStopBps,
    dailyLossBps: policy.dailyLossBps,
    drawdownBps: policy.drawdownBps,
    flattenOnStop: policy.flattenOnStop,
    depositCNS: depositCNS.toString(),
    period,
  };
}

/** Stable react-query key: the same limits give the same key (expiry is not an input). */
export function backtestKey(leaderAccountId: number, body: BacktestRequest): string {
  return JSON.stringify([leaderAccountId, body]);
}

export type BacktestFailure = { kind: "unavailable" | "rate" | "network" | "other"; message: string };

export function backtestFailure(e: unknown): BacktestFailure {
  if (e instanceof ApiError || (e as any)?.name === "ApiError") {
    const err = e as ApiError;
    const detail = typeof (err.body as any)?.error === "string" ? (err.body as any).error : err.message;
    if (err.status === 503) return { kind: "unavailable", message: detail };
    if (err.status === 429) return { kind: "rate", message: detail };
    if (err.status === 0) return { kind: "network", message: detail };
    return { kind: "other", message: detail };
  }
  return { kind: "other", message: String((e as any)?.message ?? e) };
}

/** Equity curve in AUSD (numbers are for drawing only). */
export function equitySeries(r: BacktestResult): number[] {
  return r.equityCurve.map((p) => Number(p.equityCNS) / 1e6);
}

/** Blocked trades by rule, biggest first, labelled with the user's own limit. */
export function blockedRows(r: BacktestResult, policy?: Policy | null): { reason: string; label: string; n: number }[] {
  return Object.entries(r.tradesBlocked)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => ({ reason, label: ruleWithLimit(reason, policy), n }));
}

/** Short source of the slippage the engine used. */
export function slippageSourceLabel(r: BacktestResult): string {
  const s = r.slippage.source.toLowerCase();
  if (/leader|this leader|real copies of this/.test(s)) return "this leader's measured median";
  if (/protocol|all copies|global/.test(s)) return "protocol median";
  if (/default/.test(s)) return "default 5 bps";
  return r.slippage.source;
}
