jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
import { ApiError } from "../src/lib/api";
import { backtestFailure, backtestKey, backtestRequest, blockedRows, equitySeries, slippageSourceLabel } from "../src/lib/backtest";
import type { BacktestResult } from "../src/lib/engineTypes";
import { buildPolicy, defaultForm } from "../src/lib/policy";
import { MAINNET } from "../src/lib/chain";

const markets = MAINNET.markets as any;

describe("backtestRequest", () => {
  const form = { ...defaultForm(), allocationAusd: "12.00", ratioBps: 25, maxLeverage: 5, maxNotionalAusd: "6.00", markets: ["BTC", "SOL"], entryFilterPct: 1, dailyLossPct: 10, drawdownPct: 20 };
  const policy = buildPolicy(form, 1588, markets, 1_800_000_000);

  it("sends the form's limits, the deposit and the period, and no slippage override", () => {
    const body = backtestRequest(policy, 12_000_000n, 30);
    expect(body).toEqual({
      ratioBps: 25,
      maxLeverageHdths: 500,
      maxSlippageBps: 50,
      markets: [
        { perpId: 1, maxNotionalCNS: "6000000" },
        { perpId: 31, maxNotionalCNS: "6000000" },
      ],
      maxEntryDeviationBps: 100,
      budgetCNS: "12000000",
      lossStopBps: 0,
      dailyLossBps: 1000,
      drawdownBps: 2000,
      flattenOnStop: true,
      depositCNS: "12000000",
      period: 30,
    });
    expect("slippageBps" in body).toBe(false);
  });

  it("gives the same key for the same limits whatever the expiry", () => {
    const later = buildPolicy(form, 1588, markets, 1_900_000_000);
    expect(backtestKey(1588, backtestRequest(policy, 12_000_000n, 7))).toBe(backtestKey(1588, backtestRequest(later, 12_000_000n, 7)));
    expect(backtestKey(1588, backtestRequest(policy, 12_000_000n, 7))).not.toBe(backtestKey(1588, backtestRequest(policy, 12_000_000n, 90)));
  });
});

describe("backtest results", () => {
  const r = {
    tradesBlocked: { EntryTooFar: 4, LeverageTooHigh: 9, MarketNotAllowed: 0 },
    equityCurve: [{ day: 1, date: "2026-09-07", equityCNS: "12000000" }, { day: 2, date: "2026-09-08", equityCNS: "12410000" }],
    slippage: { bps: 3, source: "median copy deviation measured on 40 real copies of this leader (indexer), floored at 0" },
  } as unknown as BacktestResult;
  it("orders blocked trades by count with the user's limits", () => {
    const policy = buildPolicy({ ...defaultForm(), entryFilterPct: 1 }, 1, markets);
    expect(blockedRows(r, policy)).toEqual([
      { reason: "LeverageTooHigh", label: "Max leverage 5x", n: 9 },
      { reason: "EntryTooFar", label: "Entry filter 1%", n: 4 },
    ]);
  });
  it("draws the equity curve in AUSD", () => {
    expect(equitySeries(r)).toEqual([12, 12.41]);
  });
  it("names the slippage source", () => {
    expect(slippageSourceLabel(r)).toBe("this leader's measured median");
    expect(slippageSourceLabel({ ...r, slippage: { bps: 5, source: "default BACKTEST_DEFAULT_SLIPPAGE_BPS" } })).toBe("default 5 bps");
  });
  it("treats 503 as history unavailable", () => {
    const e = new ApiError(503, "history unavailable: no indexer", "Request failed (503)", { body: { error: "history unavailable: no indexer" } });
    expect(backtestFailure(e)).toEqual({ kind: "unavailable", message: "history unavailable: no indexer" });
    expect(backtestFailure(new ApiError(429, "rate_limited", "slow down")).kind).toBe("rate");
  });
});
