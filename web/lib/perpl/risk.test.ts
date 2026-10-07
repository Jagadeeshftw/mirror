import { describe, expect, it } from "vitest";
import {
  distanceToLiquidation,
  divergence,
  effectiveLeverage,
  equity,
  hhi,
  leverageBuckets,
  liquidationPrice,
  maintenanceFraction,
  marginUsed,
  topShare,
  type PositionInput,
} from "./risk";

const long: PositionInput = { side: "long", size: 1, entry: 100, mark: 100, deposit: 10 };
const short: PositionInput = { side: "short", size: 1, entry: 100, mark: 100, deposit: 10 };

describe("maintenanceFraction", () => {
  it("reads Perpl's leverage-in-hundredths (2000 = 20x = 5%)", () => {
    expect(maintenanceFraction(2000)).toBeCloseTo(0.05, 12);
    expect(maintenanceFraction(2500)).toBeCloseTo(0.04, 12);
  });
  it("adds the taker fee per 100k as a closing cost", () => {
    expect(maintenanceFraction(2000, 345)).toBeCloseTo(0.05345, 12);
  });
  it("returns null for a missing config", () => {
    expect(maintenanceFraction(0)).toBeNull();
    expect(maintenanceFraction(undefined)).toBeNull();
    expect(maintenanceFraction(-5)).toBeNull();
  });
});

describe("liquidationPrice", () => {
  it("long: equity equals maintenance at the liquidation price", () => {
    const px = liquidationPrice(long, 0.05)!;
    expect(px).toBeCloseTo(90 / 0.95, 9);
    // equity at px = 10 + (px - 100); maintenance = 0.05 * px
    expect(10 + (px - 100)).toBeCloseTo(0.05 * px, 9);
  });
  it("short: equity equals maintenance at the liquidation price", () => {
    const px = liquidationPrice(short, 0.05)!;
    expect(px).toBeCloseTo(110 / 1.05, 9);
    expect(10 + (100 - px)).toBeCloseTo(0.05 * px, 9);
  });
  it("accrued funding in pnl moves the liquidation price", () => {
    // mark = entry, so the whole pnl of -2 is funding paid: less collateral left, liquidation is closer.
    const paid = liquidationPrice({ ...long, pnl: -2 }, 0.05)!;
    expect(paid).toBeGreaterThan(liquidationPrice(long, 0.05)!);
    expect(paid).toBeCloseTo(92 / 0.95, 9);
  });
  it("a fully collateralised long has no positive liquidation price", () => {
    expect(liquidationPrice({ ...long, deposit: 100 }, 0.05)).toBeNull();
  });
  it("rejects bad inputs", () => {
    expect(liquidationPrice({ ...long, size: 0 }, 0.05)).toBeNull();
    expect(liquidationPrice(long, 1)).toBeNull();
  });
  it("a higher maintenance fraction (more conservative) brings liquidation closer", () => {
    expect(liquidationPrice(long, 0.06)!).toBeGreaterThan(liquidationPrice(long, 0.05)!);
    expect(liquidationPrice(short, 0.06)!).toBeLessThan(liquidationPrice(short, 0.05)!);
  });
  it("matches a mainnet MON long read with getPositionV2", () => {
    // Account 8 on perp 10: 15000 MON long at 0.028994, deposit 111.261849, pnlCNS -45.630899, mark 0.025961.
    const p: PositionInput = { side: "long", size: 15000, entry: 0.028994, mark: 0.025961, deposit: 111.261849, pnl: -45.630899 };
    const m = maintenanceFraction(2000)!;
    const px = liquidationPrice(p, m)!;
    const fundingNow = p.pnl! - 15000 * (0.025961 - 0.028994);
    expect(p.deposit + fundingNow + 15000 * (px - 0.028994)).toBeCloseTo(15000 * px * m, 6);
    expect(px).toBeLessThan(p.mark);
  });
});

describe("distanceToLiquidation", () => {
  it("is the adverse move as a fraction of the mark", () => {
    expect(distanceToLiquidation(long, 0.05)).toBeCloseTo((100 - 90 / 0.95) / 100, 9);
    expect(distanceToLiquidation(short, 0.05)).toBeCloseTo((110 / 1.05 - 100) / 100, 9);
  });
  it("is 0 once the mark is past the liquidation price", () => {
    expect(distanceToLiquidation({ ...long, mark: 80 }, 0.05)).toBe(0);
    expect(distanceToLiquidation({ ...short, mark: 120 }, 0.05)).toBe(0);
  });
  it("is null when there is no liquidation price or no mark", () => {
    expect(distanceToLiquidation({ ...long, deposit: 100 }, 0.05)).toBeNull();
    expect(distanceToLiquidation({ ...long, mark: 0 }, 0.05)).toBeNull();
  });
  it("10x long with 5% maintenance is about 5.3% from liquidation", () => {
    expect(distanceToLiquidation(long, 0.05)!).toBeCloseTo(0.0526, 3);
  });
});

describe("equity, margin used, leverage", () => {
  it("uses pnl when given, price PnL otherwise", () => {
    expect(equity({ ...long, mark: 105 })).toBeCloseTo(15, 9);
    expect(equity({ ...long, mark: 105, pnl: 4 })).toBeCloseTo(14, 9);
  });
  it("margin used is maintenance over equity", () => {
    expect(marginUsed(long, 0.05)).toBeCloseTo(0.5, 9);
    expect(marginUsed({ ...long, mark: 90 }, 0.05)).toBe(Infinity);
  });
  it("effective leverage is notional over equity", () => {
    expect(effectiveLeverage(long)).toBeCloseTo(10, 9);
    expect(effectiveLeverage({ ...short, mark: 95 })).toBeCloseTo(95 / 15, 9);
    expect(effectiveLeverage({ ...long, mark: 90 })).toBe(Infinity);
  });
});

describe("concentration", () => {
  it("top-n share of the total", () => {
    expect(topShare([50, 30, 10, 10], 1)).toBeCloseTo(0.5, 12);
    expect(topShare([50, 30, 10, 10], 2)).toBeCloseTo(0.8, 12);
    expect(topShare([5, 5], 10)).toBe(1);
  });
  it("ignores order, negatives and non-finite values", () => {
    expect(topShare([10, -5, 50, NaN, 40], 1)).toBeCloseTo(0.5, 12);
  });
  it("is null for an empty or zero total", () => {
    expect(topShare([])).toBeNull();
    expect(topShare([0, 0])).toBeNull();
  });
  it("hhi is 1 for one holder and 1/n for n equal holders", () => {
    expect(hhi([7])).toBe(1);
    expect(hhi([1, 1, 1, 1])).toBeCloseTo(0.25, 12);
    expect(hhi([])).toBeNull();
  });
});

describe("leverageBuckets", () => {
  it("assigns edges to the higher bucket and counts notional", () => {
    const b = leverageBuckets([
      { leverage: 0.5, notional: 1 },
      { leverage: 1.9, notional: 2 },
      { leverage: 2, notional: 4 },
      { leverage: 9.99, notional: 8 },
      { leverage: 10, notional: 16 },
      { leverage: 25, notional: 32 },
      { leverage: Infinity, notional: 64 },
    ]);
    expect(b.map((x) => x.label)).toEqual(["1-2x", "2-5x", "5-10x", "10-20x", "20x+"]);
    expect(b.map((x) => x.count)).toEqual([2, 1, 1, 1, 2]);
    expect(b.map((x) => x.notional)).toEqual([3, 4, 8, 16, 96]);
  });
  it("skips NaN and supports custom edges", () => {
    const b = leverageBuckets([{ leverage: NaN }, { leverage: 3 }], [5]);
    expect(b.map((x) => [x.label, x.count])).toEqual([
      ["1-5x", 1],
      ["5x+", 0],
    ]);
  });
});

describe("divergence", () => {
  it("is signed and relative to the oracle", () => {
    expect(divergence(101, 100)).toBeCloseTo(0.01, 12);
    expect(divergence(99, 100)).toBeCloseTo(-0.01, 12);
    expect(divergence(null, 100)).toBeNull();
    expect(divergence(1, 0)).toBeNull();
  });
});
