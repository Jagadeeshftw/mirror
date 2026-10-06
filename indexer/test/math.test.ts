import { describe, expect, it } from "vitest";

import { MATCH_NOW_REF, blockReason } from "../src/lib/constants.js";
import { isTeamRun } from "../src/lib/env.js";
import {
  avgLeverageHdths,
  dateOf,
  dayOf,
  divRound,
  drawdownBps,
  exitPriceFromPnl,
  increaseFillPrice,
  notionalCNS,
  toQ16,
  winRateBps,
} from "../src/lib/math.js";
import { keccak256, toHex } from "viem";

describe("fixed-point math (checked against mainnet Perpl events)", () => {
  it("notional: 0.7 LIT at 3.93004 = 2.751028 AUSD", () => {
    // PositionOpenedV2 perp 60 (lotDecimals 1, priceDecimals 5), lot 7, price 393004
    expect(notionalCNS(7n, 393004n, 1, 5)).toBe(2_751_028n);
    // 1 ETH at 3000.00 (lotDecimals 3, priceDecimals 2)
    expect(notionalCNS(1000n, 300000n, 3, 2)).toBe(3_000_000_000n);
    // 0.00001 BTC at 100000.0 (lotDecimals 5, priceDecimals 1) = 1 AUSD
    expect(notionalCNS(1n, 1_000_000n, 5, 1)).toBe(1_000_000n);
    expect(notionalCNS(0n, 1n, 0, 0)).toBe(0n);
  });

  it("exit price from deltaPnl reproduces PositionClosed prices exactly", () => {
    // perp 60: open long 7 @ 393004, PositionClosed price 392807 deltaPnl -1379
    expect(exitPriceFromPnl("LONG", toQ16(393004n), -1379n, 7n, 1, 5)).toBe(392807n);
    // perp 60: open short 6 @ 393549, PositionClosed price 395050 deltaPnl -9006
    expect(exitPriceFromPnl("SHORT", toQ16(393549n), -9006n, 6n, 1, 5)).toBe(395050n);
    // perp 20 account 576: entry 269840 (+21845/65536), decrease 45->44, deltaPnl -5503; maker fill 269289
    const exit = exitPriceFromPnl("LONG", toQ16(269840n, 21845n), -5503n, 1n, 3, 2)!;
    expect(Number(exit - 269289n)).toBeLessThanOrEqual(1);
    expect(exitPriceFromPnl("LONG", 0n, 1n, 1n, 3, 2)).toBeNull();
    expect(exitPriceFromPnl("LONG", toQ16(100n), -1_000_000_000n, 1n, 3, 2)).toBeNull();
  });

  it("increase fill price from the average-entry change (with Q16 residue) matches the maker fill", () => {
    // perp 70 account 25: 15992 -> 16001 lots, entry 280719+22740/65536 -> 280718+14314/65536, maker fill 278713
    const fill = increaseFillPrice(toQ16(280719n, 22740n), 15992n, toQ16(280718n, 14314n), 16001n)!;
    expect(Number(fill > 278713n ? fill - 278713n : 278713n - fill)).toBeLessThanOrEqual(1);
    // without the residue the error is ~230 PNS, which is why the residue is tracked
    const coarse = increaseFillPrice(toQ16(280719n), 15992n, toQ16(280718n), 16001n)!;
    expect(Number(coarse - 278713n)).toBeGreaterThan(100);
    expect(increaseFillPrice(toQ16(300000n), 1000n, toQ16(305000n), 2000n)).toBe(310000n);
  });

  it("rounding, ratios, days", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(winRateBps(2, 1)).toBe(6667);
    expect(winRateBps(0, 0)).toBe(0);
    expect(avgLeverageHdths(500n * 3000n + 1000n * 3100n, 6100n)).toBe(754);
    expect(drawdownBps(300n, 1000n, 100n)).toBe(2727);
    expect(drawdownBps(1n, 0n, 0n)).toBe(0);
    expect(drawdownBps(300n, 0n, 100n)).toBe(0); // unknown capital base -> no ratio
    expect(dayOf(1_790_812_800)).toBe(20727);
    expect(dateOf(20727)).toBe("2026-10-01");
  });
});

describe("constants and env", () => {
  it("MATCH_NOW_REF is keccak256('MIRROR_MATCH_NOW')", () => {
    expect(MATCH_NOW_REF).toBe(keccak256(toHex("MIRROR_MATCH_NOW")));
  });

  it("decodes BlockReason in Solidity order", () => {
    expect(blockReason(0)).toBe("None");
    expect(blockReason(3)).toBe("LeaderNotAllowed");
    expect(blockReason(6)).toBe("LeverageTooHigh");
    expect(blockReason(13)).toBe("DrawdownStop");
    expect(blockReason(14)).toBe("LeverageTooLow");
    expect(blockReason(15)).toBe("Unknown");
  });

  it("team-run matching is case-insensitive on addresses and exact on account ids", () => {
    expect(isTeamRun({ addresses: ["0x00000000000000000000000000000000000000D1"] })).toBe(true);
    expect(isTeamRun({ addresses: [null, "0x00000000000000000000000000000000000000d3"] })).toBe(false);
    expect(isTeamRun({ accountId: 999n })).toBe(true);
    expect(isTeamRun({ accountId: 9990n })).toBe(false);
  });
});
