/**
 * The simulation card's share URL carries the follower's limits, so the card re-runs the engine's backtest
 * (POST /v1/leaders/:id/backtest) instead of storing a result. Keys are short to keep the URL small; the app
 * writes them with app/src/lib/share.ts (simParams).
 *
 *   d  depositCNS        b  budgetCNS         r  ratioBps          l  maxLeverageHdths
 *   s  maxSlippageBps    e  maxEntryDeviationBps                    m  markets "perpId:maxNotionalCNS,..."
 *   p  period 7|30|90    ls lossStopBps       dl dailyLossBps      dd drawdownBps
 *   fl flattenOnStop 1|0 sl stopLossPct       tp takeProfitPct
 */
export interface BacktestBody {
  ratioBps: number;
  maxLeverageHdths: number;
  maxSlippageBps: number;
  markets: { perpId: number; maxNotionalCNS: string }[];
  maxEntryDeviationBps: number;
  budgetCNS: string;
  lossStopBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  flattenOnStop: boolean;
  depositCNS: string;
  period: 7 | 30 | 90;
  stopLossPct?: number;
  takeProfitPct?: number;
}

const int = (v: string | null, min: number, max: number): number | null => {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};
const uint = (v: string | null): string | null => (v !== null && /^\d{1,30}$/.test(v) ? v.replace(/^0+(?=\d)/, "") : null);

/** Parses the limits; null when a required one is missing or malformed (the card then says so). */
export function parseSimParams(q: URLSearchParams): BacktestBody | null {
  const depositCNS = uint(q.get("d"));
  const budgetCNS = uint(q.get("b")) ?? depositCNS;
  const ratioBps = int(q.get("r"), 1, 1_000_000);
  const maxLeverageHdths = int(q.get("l"), 100, 100_000);
  const period = int(q.get("p") ?? "30", 7, 90);
  const markets = (q.get("m") ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [id, cap] = pair.split(":");
      const perpId = int(id ?? null, 0, 1_000_000);
      const maxNotionalCNS = uint(cap ?? null);
      return perpId !== null && maxNotionalCNS !== null ? { perpId, maxNotionalCNS } : null;
    });
  if (!depositCNS || !budgetCNS || ratioBps === null || maxLeverageHdths === null || !markets.length || markets.some((m) => m === null)) return null;
  if (period !== 7 && period !== 30 && period !== 90) return null;
  const body: BacktestBody = {
    ratioBps,
    maxLeverageHdths,
    maxSlippageBps: int(q.get("s"), 1, 10_000) ?? 100,
    markets: markets as { perpId: number; maxNotionalCNS: string }[],
    maxEntryDeviationBps: int(q.get("e"), 0, 10_000) ?? 0,
    budgetCNS,
    lossStopBps: int(q.get("ls"), 0, 10_000) ?? 0,
    dailyLossBps: int(q.get("dl"), 0, 10_000) ?? 0,
    drawdownBps: int(q.get("dd"), 0, 10_000) ?? 0,
    flattenOnStop: q.get("fl") === "1",
    depositCNS,
    period,
  };
  const sl = Number(q.get("sl"));
  const tp = Number(q.get("tp"));
  if (q.get("sl") && Number.isFinite(sl) && sl > 0 && sl < 100) body.stopLossPct = sl;
  if (q.get("tp") && Number.isFinite(tp) && tp > 0 && tp < 1000) body.takeProfitPct = tp;
  return body;
}
