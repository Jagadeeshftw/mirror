import abi from "../src/lib/MirrorAccount.json";
import { MIRROR_ORDER_COMPONENTS, POLICY_PARAM, validatePolicy, encodeSetPolicy, LIMITS } from "../src/lib/contracts";
import { buildPolicy, defaultForm, ratioPresets, suggestRatioBps } from "../src/lib/policy";
import { decodeAbiParameters } from "viem";
import type { MarketConfig } from "../src/lib/types";

const MARKETS: MarketConfig[] = [
  { perpId: 1, symbol: "BTC", lotDecimals: 5, priceDecimals: 1, maxLeverage: 15 },
  { perpId: 20, symbol: "ETH", lotDecimals: 3, priceDecimals: 2, maxLeverage: 15 },
  { perpId: 31, symbol: "SOL", lotDecimals: 3, priceDecimals: 3, maxLeverage: 10 },
];

function shape(c: any): string {
  return c.type.startsWith("tuple") ? `(${c.components.map(shape).join(",")})${c.type.slice(5)}` : c.type;
}

describe("struct shapes match the compiled MirrorAccount ABI", () => {
  const fn = (name: string) => (abi as any[]).find((x) => x.type === "function" && x.name === name);
  it("follow(Policy, MirrorOrder[])", () => {
    const f = fn("follow");
    expect(shape(f.inputs[0])).toBe(shape(POLICY_PARAM));
    expect(shape(f.inputs[1])).toBe(shape({ type: "tuple[]", components: MIRROR_ORDER_COMPONENTS }));
  });
  it("execute(Action, bytes)", () => {
    const f = fn("execute");
    expect(shape(f.inputs[0])).toBe("(uint8,bytes,uint256,uint256)");
  });
  it("action kind constants", () => {
    for (const name of ["ACTION_SET_POLICY", "ACTION_SET_PAUSED", "ACTION_CLOSE_ALL", "ACTION_WITHDRAW", "ACTION_FOLLOW", "ACTION_MATCH_NOW"]) {
      expect(fn(name)).toBeTruthy();
    }
  });
});

describe("policy builder", () => {
  const now = 1_790_000_000;
  it("builds a valid policy from the follow form (ratio sizing only)", () => {
    const form = { ...defaultForm(), ratioBps: 25, maxLeverage: 5, maxSlippageBps: 50, maxNotionalAusd: "12", markets: ["BTC", "ETH"], dailyLossPct: 10, drawdownPct: 15, expiryDays: 90 };
    const p = buildPolicy(form, 1043, MARKETS, now);
    expect(p).toEqual({
      maxLeverageHdths: 500,
      maxSlippageBps: 50,
      dailyLossBps: 1000,
      drawdownBps: 1500,
      expiry: now + 90 * 86400,
      leaders: [{ accountId: 1043, ratioBps: 25 }],
      markets: [
        { perpId: 1, maxNotionalCNS: "12000000" },
        { perpId: 20, maxNotionalCNS: "12000000" },
      ],
    });
    expect(validatePolicy(p, now)).toBeNull();
    const [dec] = decodeAbiParameters([POLICY_PARAM], encodeSetPolicy(p));
    expect(Number(dec.expiry)).toBe(now + 90 * 86400);
  });
  it("rejects what the contract would reject", () => {
    const base = buildPolicy({ ...defaultForm(), markets: ["BTC"] }, 7, MARKETS, now);
    expect(validatePolicy({ ...base, maxSlippageBps: 0 }, now)).toBe("maxSlippageBps");
    expect(validatePolicy({ ...base, maxSlippageBps: 1001 }, now)).toBe("maxSlippageBps");
    expect(validatePolicy({ ...base, maxLeverageHdths: 99 }, now)).toBe("maxLeverageHdths");
    expect(validatePolicy({ ...base, expiry: now }, now)).toBe("expiry");
    expect(validatePolicy({ ...base, markets: [] }, now)).toBe("markets");
    expect(validatePolicy({ ...base, leaders: [{ accountId: 7, ratioBps: 10_001 }] }, now)).toBe("leader.ratioBps");
    expect(LIMITS.MAX_SLIPPAGE_BPS).toBe(1000);
  });
  it("suggests a ratio that keeps the leader's largest position inside the per-market cap", () => {
    // Leader holds 1.5 BTC @ 118,400 = 177,600 AUSD notional. Cap 12 AUSD -> ratio <= 0.0068% -> 0 bps floor is invalid, min 1 bps.
    expect(suggestRatioBps(177_600_000_000n, 12_000_000n)).toBe(1);
    // Leader notional 20,000 AUSD, cap 12 -> 6 bps (0.06%).
    expect(suggestRatioBps(20_000_000_000n, 12_000_000n)).toBe(6);
    expect(ratioPresets().every((b) => b >= 1 && b <= 10_000)).toBe(true);
  });
});
