import abi from "../src/lib/MirrorAccount.json";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData } from "viem";
import { ACTION, LEVELS_PARAM, POLICY_PARAM, encodeCloseMarket, encodeSetLevels } from "../src/lib/contracts";
import {
  buildLevel,
  checkLevels,
  clearLevel,
  haltedPerps,
  levelFor,
  levelText,
  movePct,
  normalizeLevels,
  parseLevelInput,
  pnlAtCNS,
  priceFromPct,
  resumeMarketsAction,
  signablePolicy,
  stopPlan,
} from "../src/lib/levels";
import { normalizeAccount } from "../src/lib/engineShape";
import type { MirrorAccount, Policy, Position } from "../src/lib/types";

// BTC on Perpl: priceDecimals 1, lotDecimals 5.
const ENTRY = 1_178_800n; // 117,880.0
const fn = (name: string) => (abi as any[]).find((x) => x.type === "function" && x.name === name);
const shape = (c: any): string => (c.type.startsWith("tuple") ? `(${c.components.map(shape).join(",")})${c.type.slice(5)}` : c.type);

describe("level price <-> percent", () => {
  it("long: stop-loss below entry, take-profit above (the design's 108,450.0 / 141,456.0)", () => {
    expect(priceFromPct(ENTRY, 8, "long", "sl")).toBe(1_084_496n); // 108,449.6
    expect(priceFromPct(ENTRY, 20, "long", "tp")).toBe(1_414_560n); // 141,456.0
  });
  it("short is mirrored", () => {
    expect(priceFromPct(43_500_0n, 10, "short", "sl")).toBe(47_850_0n);
    expect(priceFromPct(43_500_0n, 10, "short", "tp")).toBe(39_150_0n);
  });
  it("rounds to the nearest price unit", () => {
    expect(priceFromPct(1001n, 0.5, "long", "tp")).toBe(1006n); // 1006.005
    expect(priceFromPct(999n, 0.25, "long", "sl")).toBe(997n); // 996.5025
  });
  it("movePct is signed in the position's favour", () => {
    expect(movePct(ENTRY, 1_414_560n, "long")).toBeCloseTo(20, 6);
    expect(movePct(ENTRY, 1_084_500n, "long")).toBeCloseTo(-8.0, 1);
    expect(movePct(43_500_0n, 47_850_0n, "short")).toBeCloseTo(-10, 6);
    expect(movePct(0n, 5n, "long")).toBe(0);
  });
  it("PnL at a level (0.0001 BTC long, 117,880.0 -> 141,456.0 is +2.36 AUSD)", () => {
    expect(pnlAtCNS(10n, ENTRY, 1_414_560n, "long", 5, 1)).toBe(2_357_600n);
    expect(pnlAtCNS(10n, ENTRY, 1_084_500n, "long", 5, 1)).toBe(-943_000n);
    expect(pnlAtCNS(10n, ENTRY, 1_084_500n, "short", 5, 1)).toBe(943_000n);
  });
});

describe("editor input", () => {
  it("parses a price with grouping and the market's decimals", () => {
    expect(parseLevelInput("141,456.0", "price", ENTRY, "long", "tp", 1)).toBe(1_414_560n);
    expect(parseLevelInput("141456.05", "price", ENTRY, "long", "tp", 1)).toBeNull();
  });
  it("parses a percent (sign and % ignored) into a price", () => {
    expect(parseLevelInput("−8%", "pct", ENTRY, "long", "sl", 1)).toBe(1_084_496n);
    expect(parseLevelInput("+20", "pct", ENTRY, "long", "tp", 1)).toBe(1_414_560n);
    expect(parseLevelInput("100", "pct", ENTRY, "long", "sl", 1)).toBeNull();
    expect(parseLevelInput("abc", "pct", ENTRY, "long", "sl", 1)).toBeNull();
  });
  it("empty means no level", () => {
    expect(parseLevelInput("  ", "price", ENTRY, "long", "sl", 1)).toBe(0n);
  });
  it("levelText round-trips", () => {
    expect(levelText(1_414_560n, "price", ENTRY, "long", 1)).toBe("141456.0");
    expect(levelText(1_414_560n, "pct", ENTRY, "long", 1)).toBe("20.0");
    expect(levelText(0n, "pct", ENTRY, "long", 1)).toBe("");
  });
});

describe("level checks (contract _setLevels + not already reached)", () => {
  const MARK = 1_184_205n;
  it("accepts the design's levels", () => expect(checkLevels("long", MARK, 1_084_500n, 1_414_560n, 300)).toBeNull());
  it("clearing needs no slippage", () => expect(checkLevels("long", MARK, 0n, 0n, 0)).toBeNull());
  it("slippage 1..2000 bps", () => {
    expect(checkLevels("long", MARK, 0n, 1_414_560n, 0)?.field).toBe("slippage");
    expect(checkLevels("long", MARK, 0n, 1_414_560n, 2001)?.field).toBe("slippage");
  });
  it("order: long stop below take-profit, short above", () => {
    expect(checkLevels("long", 0n, 1_500_000n, 1_414_560n, 300)?.field).toBe("sl");
    expect(checkLevels("short", 0n, 1_000_000n, 1_414_560n, 300)?.field).toBe("sl");
  });
  it("refuses a level already reached at the mark", () => {
    expect(checkLevels("long", MARK, 1_190_000n, 0n, 300)?.field).toBe("sl");
    expect(checkLevels("long", MARK, 0n, 1_180_000n, 300)?.field).toBe("tp");
    expect(checkLevels("short", MARK, 0n, 1_190_000n, 300)?.field).toBe("tp");
  });
});

describe("encoding", () => {
  it("setLevels(Level[]) matches the compiled ABI and ACTION_SET_LEVELS = 9", () => {
    expect(shape(fn("setLevels").inputs[0])).toBe(shape(LEVELS_PARAM));
    expect(ACTION.SET_LEVELS).toBe(9);
    expect(ACTION.CLOSE_MARKET).toBe(10);
  });
  it("a level encodes as the contract decodes it", () => {
    const lv = buildLevel(1, "long", 1_084_500n, 1_414_560n);
    const [out] = decodeAbiParameters([LEVELS_PARAM], encodeSetLevels([lv])) as any;
    expect(out[0]).toEqual({ perpId: 1, side: 0, stopLossPNS: 1_084_500n, takeProfitPNS: 1_414_560n, slippageBps: 300 });
    // Same bytes as the setLevels calldata body.
    const call = encodeFunctionData({ abi: abi as any, functionName: "setLevels", args: [[{ ...lv, stopLossPNS: 1_084_500n, takeProfitPNS: 1_414_560n }]] });
    expect(call.slice(10)).toBe(encodeSetLevels([lv]).slice(2));
  });
  it("clear = both prices 0 on that market and side", () => {
    expect(clearLevel(20, "short")).toEqual({ perpId: 20, side: 1, stopLossPNS: "0", takeProfitPNS: "0", slippageBps: 300 });
  });
  it("closeMarket(uint32, uint16)", () => {
    const call = encodeFunctionData({ abi: abi as any, functionName: "closeMarket", args: [1, 300] });
    expect(call.slice(10)).toBe(encodeCloseMarket(1, 300).slice(2));
  });
});

const POLICY: Policy & { markets: any[]; leaders: any[] } = {
  maxLeverageHdths: 500, maxSlippageBps: 50, dailyLossBps: 1000, drawdownBps: 2000, expiry: 4_000_000_000, maxEntryDeviationBps: 100, stopSlippageBps: 300,
  flattenOnStop: true, maxBuilderFeePer100K: 20,
  leaders: [{ accountId: 1043, ratioBps: 10, budgetCNS: "12000000", lossStopBps: 0, stopped: false }],
  markets: [{ perpId: 1, maxNotionalCNS: "12000000", halted: true }, { perpId: 20, maxNotionalCNS: "12000000", halted: false }],
};
const pos = (perpId: number, leaderAccountId: number): Position => ({ perpId, side: "long", lotLNS: "10", entryPNS: "1", markPNS: "1", liqPNS: "0", leverageHdths: 400, marginCNS: "1", notionalCNS: "1", upnlCNS: "0", leaderAccountId });
const acct = (p: any, positions: Position[]) => ({ policy: p, positions, leader: null, paused: false }) as unknown as MirrorAccount;

describe("engine account -> levels and halted markets", () => {
  const a = normalizeAccount({ address: "0x00000000000000000000000000000000000000aa", policy: POLICY, levels: [{ perpId: 1, side: "long", stopLossPNS: "1084500", takeProfitPNS: "1414560", slippageBps: 300 }, { perpId: 20, side: 1, stopLossPNS: "0", takeProfitPNS: "0", slippageBps: 0 }] });
  it("keeps non-zero levels with their side", () => {
    expect(a.levels).toEqual([{ perpId: 1, side: "long", stopLossPNS: "1084500", takeProfitPNS: "1414560", slippageBps: 300 }]);
    expect(levelFor(a.levels, { perpId: 1, side: "long" })?.takeProfitPNS).toBe("1414560");
    expect(levelFor(a.levels, { perpId: 1, side: "short" })).toBeNull();
    expect(normalizeLevels(null)).toEqual([]);
  });
  it("reads halted markets", () => expect(haltedPerps(a)).toEqual([1]));
  it("resume = the same policy signed again, without the read-outs", () => {
    const r = resumeMarketsAction(a, 1_000);
    if ("error" in r) throw new Error(r.error);
    expect(r.kind).toBe(ACTION.SET_POLICY);
    const [p] = decodeAbiParameters([POLICY_PARAM], r.data) as any;
    expect(p.markets.map((m: any) => Number(m.perpId))).toEqual([1, 20]);
    expect(p.leaders[0].accountId).toBe(1043);
    expect("error" in resumeMarketsAction(a, 4_000_000_001)).toBe(true);
  });
});

describe("stop following", () => {
  it("only leader: keep = ACTION_SET_LEADER_DETACHED(leader, true), close = closeAll", () => {
    const a = acct(POLICY, [pos(1, 1043)]);
    const k = stopPlan(a, 1043, "keep");
    expect(k.how).toBe("detach");
    expect(k.actions.map((x) => x.kind)).toEqual([ACTION.SET_LEADER_DETACHED]);
    expect(decodeAbiParameters([{ type: "uint32" }, { type: "bool" }], k.actions[0].data)).toEqual([1043, true]);
    const c = stopPlan(a, 1043, "close");
    expect(c.how).toBe("closeAll");
    expect(c.actions.map((x) => x.kind)).toEqual([ACTION.CLOSE_ALL]);
    expect(k.positions).toHaveLength(1);
  });
  it("two leaders: keep = ACTION 11 for that leader only (stays in the policy); close removes it and closes its markets", () => {
    const two = { ...POLICY, leaders: [...POLICY.leaders, { accountId: 877, ratioBps: 10, budgetCNS: "2000000", lossStopBps: 0 }] };
    const a = acct(two, [pos(1, 1043), pos(20, 877)]);
    const k = stopPlan(a, 877, "keep", 1_000);
    expect(k.how).toBe("detach");
    expect(k.actions.map((x) => x.kind)).toEqual([ACTION.SET_LEADER_DETACHED]);
    expect(decodeAbiParameters([{ type: "uint32" }, { type: "bool" }], k.actions[0].data)).toEqual([877, true]);
    expect(k.positions.map((x) => x.perpId)).toEqual([20]);
    const c = stopPlan(a, 877, "close", 1_000);
    const [p] = decodeAbiParameters([POLICY_PARAM], c.actions[0].data) as any;
    expect(p.leaders.map((l: any) => l.accountId)).toEqual([1043]);
    expect(c.actions.map((x) => x.kind)).toEqual([ACTION.SET_POLICY, ACTION.CLOSE_MARKET]);
    expect(decodeAbiParameters([{ type: "uint32" }, { type: "uint16" }], c.actions[1].data)).toEqual([20, 300]);
    expect(c.positions.map((x) => x.perpId)).toEqual([20]);
  });
  it("signablePolicy drops the engine read-outs", () => {
    const s = signablePolicy(POLICY as Policy);
    expect(Object.keys(s.markets[0])).toEqual(["perpId", "maxNotionalCNS"]);
    expect(Object.keys(s.leaders[0])).toEqual(["accountId", "ratioBps", "budgetCNS", "lossStopBps"]);
  });
});

it("decodes the contract's own setLevels calldata", () => {
  const data = encodeFunctionData({ abi: abi as any, functionName: "setLevels", args: [[{ perpId: 1, side: 1, stopLossPNS: 5n, takeProfitPNS: 3n, slippageBps: 300 }]] });
  const d = decodeFunctionData({ abi: abi as any, data }) as any;
  expect(d.functionName).toBe("setLevels");
});
