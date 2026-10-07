// Follow sheet form model -> MirrorAccount.Policy. Sizing is only "% of leader size" (ratioBps).
import { parseUnits } from "./format";
import type { MarketConfig, Policy } from "./types";

export const MIN_FOLLOW_CNS = 10_000_000n; // Perpl's account minimum (minAccountOpenCNS)
export const BETA_CAP_CNS = 25_000_000n; // per MirrorAccount (one per follow)
export const ALL_MARKETS = ["BTC", "ETH", "SOL", "MON", "HYPE", "ZEC", "LIT", "VVV", "PUMP", "NEAR", "UNI"];

export interface FollowForm {
  allocationAusd: string;
  ratioBps: number;
  maxLeverage: number;
  maxSlippageBps: number;
  maxNotionalAusd: string;
  markets: string[];
  dailyLossPct: number;
  drawdownPct: number;
  expiryDays: number;
  /** "Only copy if within X% of the leader's entry" (0 = off). */
  entryFilterPct: number;
  /** Anyone may execute my loss stops (reduce-only) if Mirror is down. */
  flattenOnStop: boolean;
  matchNow: boolean;
  note: string;
}

export function defaultForm(): FollowForm {
  return {
    allocationAusd: "12.00",
    ratioBps: 10,
    maxLeverage: 5,
    maxSlippageBps: 50,
    maxNotionalAusd: "12.00",
    markets: ["BTC", "ETH", "SOL"],
    dailyLossPct: 10,
    drawdownPct: 15,
    expiryDays: 90,
    entryFilterPct: 0,
    flattenOnStop: true,
    matchNow: true,
    note: "",
  };
}

/** Slippage bound for closes sent by a triggered stop. */
export const STOP_SLIPPAGE_BPS = 300;

export function buildPolicy(form: FollowForm, leaderAccountId: number, markets: MarketConfig[], nowSec = Math.floor(Date.now() / 1000)): Policy {
  const cap = parseUnits(form.maxNotionalAusd, 6) ?? 0n;
  // Single-leader follow: the whole allocation is this leader's margin budget.
  const budget = parseUnits(form.allocationAusd, 6) ?? 0n;
  const bySymbol = new Map(markets.map((m) => [m.symbol, m]));
  return {
    maxLeverageHdths: Math.round(form.maxLeverage * 100),
    maxSlippageBps: Math.round(form.maxSlippageBps),
    dailyLossBps: Math.round(form.dailyLossPct * 100),
    drawdownBps: Math.round(form.drawdownPct * 100),
    expiry: nowSec + Math.round(form.expiryDays * 86400),
    maxEntryDeviationBps: Math.round(form.entryFilterPct * 100),
    stopSlippageBps: STOP_SLIPPAGE_BPS,
    flattenOnStop: form.flattenOnStop,
    leaders: [{ accountId: leaderAccountId, ratioBps: Math.round(form.ratioBps), budgetCNS: budget.toString(), lossStopBps: 0 }],
    markets: form.markets
      .map((s) => bySymbol.get(s))
      .filter((m): m is MarketConfig => !!m)
      .map((m) => ({ perpId: m.perpId, maxNotionalCNS: cap.toString() })),
  };
}

/** Largest ratio (bps, >= 1) that keeps the leader's biggest position under the per-market cap. */
export function suggestRatioBps(leaderMaxNotionalCNS: bigint, capCNS: bigint): number {
  if (leaderMaxNotionalCNS <= 0n) return 100;
  const r = (capCNS * 10_000n) / leaderMaxNotionalCNS;
  if (r < 1n) return 1;
  if (r > 10_000n) return 10_000;
  return Number(r);
}

/** Ratio presets in bps: 0.01% .. 10%. */
export function ratioPresets(): number[] {
  return [1, 2, 5, 10, 25, 50, 100, 250, 1000];
}

export const SLIPPAGE_PRESETS = [10, 25, 50, 100, 200];
export const EXPIRY_PRESETS = [7, 30, 90];

export function formErrors(form: FollowForm, walletCNS: bigint): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  const alloc = parseUnits(form.allocationAusd, 6);
  if (alloc === null) out.push({ field: "allocation", message: "Enter an amount" });
  else {
    if (alloc < MIN_FOLLOW_CNS) out.push({ field: "allocation", message: "Perpl needs at least 10 AUSD to open your trading account" });
    if (alloc > BETA_CAP_CNS) out.push({ field: "allocation", message: "Beta limit is 25 AUSD per follow" });
    if (alloc > walletCNS) out.push({ field: "allocation", message: "More than your wallet balance" });
  }
  const cap = parseUnits(form.maxNotionalAusd, 6);
  if (cap === null || cap === 0n) out.push({ field: "notional", message: "Set a max notional" });
  if (form.markets.length === 0) out.push({ field: "markets", message: "Allow at least one market" });
  if (form.maxSlippageBps < 1 || form.maxSlippageBps > 1000) out.push({ field: "slippage", message: "Between 0.01% and 10%" });
  if (form.ratioBps < 1 || form.ratioBps > 10_000) out.push({ field: "ratio", message: "Between 0.01% and 100%" });
  if (form.entryFilterPct < 0 || form.entryFilterPct > 50) out.push({ field: "entryFilter", message: "Between 0% (off) and 50%" });
  return out;
}
