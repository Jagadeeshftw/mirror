import { normalizeFeedEvent } from "../src/lib/engineShape";
import { closedBy, levelSetTitle, marketClosedTitle, stopTitle } from "../src/lib/stopEvents";
import { matchesFilter } from "../src/lib/feedFilter";
import type { MarketConfig } from "../src/lib/types";

const BTC: MarketConfig = { perpId: 1, symbol: "BTC", lotDecimals: 5, priceDecimals: 1 };
const ACC = "0x00000000000000000000000000000000000000aa";
const STRANGER = "0x12f4a9c03b7e5d1a6c8e2f0b9d4a7c3e5b1f80ab";
// Engine feedJson shapes (engine/src/services/feed.ts; registry.ts for the data).
const wire = (id: number, kind: string, ts: number, extra: Record<string, unknown> = {}) =>
  normalizeFeedEvent({ id, account: ACC, kind, onchain: true, txHash: `0x${String(id).padStart(64, "0")}`, block: 100 + id, timestamp: ts, commitState: "finalized", ...extra });

const open = wire(1, "Mirrored", 1000, { perpId: 1, orderType: 0, lotLNS: "10", pricePNS: "1178800" });
const level = wire(2, "LevelSet", 1100, { perpId: 1, data: { side: 0, stopLossPNS: "1084500", takeProfitPNS: "1414560", slippageBps: 300 } });
const fired = wire(3, "StopTriggered", 1200, { perpId: 1, reason: "TakeProfit", keeper: STRANGER, limit: "1414560", actual: "1420000", data: { kind: "TakeProfit", scope: 1, caller: STRANGER, limit: "1414560", actual: "1420000", oraclePNS: "0", closed: "10" } });

describe("stop feed items", () => {
  it("StopTriggered names the stop and who executed it", () => {
    expect(fired.keeper).toBe(STRANGER);
    expect(stopTitle(fired)).toBe("Take-profit executed by 0x12f4…80ab");
  });
  it("keeper falls back to data.caller", () => {
    const e = wire(9, "StopTriggered", 1, { reason: "StopLoss", data: { kind: "StopLoss", caller: STRANGER } });
    expect(stopTitle(e)).toBe("Stop-loss executed by 0x12f4…80ab");
  });
  it("LevelSet and MarketClosed titles", () => {
    expect(levelSetTitle(level, BTC)).toBe("BTC take-profit 141,456.0 · stop-loss 108,450.0");
    expect(levelSetTitle(wire(4, "LevelSet", 1, { perpId: 1, data: { stopLossPNS: "0", takeProfitPNS: "0" } }), BTC)).toBe("BTC levels cleared");
    expect(marketClosedTitle(wire(5, "MarketClosed", 1, { perpId: 1, data: { lotsBefore: "10", lotsAfter: "0" } }), BTC)).toBe("Closed your BTC position");
  });
  it("the copy detail finds the level that closed the position", () => {
    expect(closedBy([fired, level, open], open)?.id).toBe("3");
    const leaderClose = wire(6, "Mirrored", 1150, { perpId: 1, orderType: 2 });
    expect(closedBy([fired, leaderClose, level, open], open)).toBeNull();
    expect(closedBy([level, open], open)).toBeNull();
  });
  it("the Closes filter includes fired levels and owner closes", () => {
    expect(matchesFilter(fired, "closes")).toBe(true);
    expect(matchesFilter(level, "closes")).toBe(false);
    expect(matchesFilter(open, "closes")).toBe(false);
  });
});
