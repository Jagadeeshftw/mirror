import { describe, expect, it } from "vitest";

import { EMPTY_QUEUE, allocateByLots, attributeNewestLots, consumeLots, pushLots, totalLots } from "../src/lib/fifo.js";

describe("FIFO lot queue", () => {
  it("push, attribute newest, consume oldest first", () => {
    let q = pushLots(EMPTY_QUEUE, "0", 300n);
    q = attributeNewestLots(q, 300n, "100").queue;
    q = pushLots(q, "0", 200n);
    q = attributeNewestLots(q, 200n, "200").queue;
    q = pushLots(q, "0", 100n);
    q = attributeNewestLots(q, 100n, "100").queue;
    expect(q).toEqual({ leaderIds: ["100", "200", "100"], lots: [300n, 200n, 100n] });

    const r = consumeLots(q, 400n);
    expect(r.parts).toEqual([
      { leaderId: "100", lots: 300n },
      { leaderId: "200", lots: 100n },
    ]);
    expect(r.queue).toEqual({ leaderIds: ["200", "100"], lots: [100n, 100n] });
    expect(totalLots(r.queue)).toBe(200n);
  });

  it("attribution only relabels trailing unattributed lots and splits a tranche when needed", () => {
    let q = pushLots(EMPTY_QUEUE, "7", 50n);
    q = pushLots(q, "0", 100n);
    const r = attributeNewestLots(q, 30n, "9");
    expect(r.relabelled).toBe(30n);
    expect(r.queue).toEqual({ leaderIds: ["7", "0", "9"], lots: [50n, 70n, 30n] });
    // asking for more than the unattributed tail never steals attributed lots
    const r2 = attributeNewestLots(r.queue, 500n, "5");
    expect(r2.queue).toEqual({ leaderIds: ["7", "0", "9"], lots: [50n, 70n, 30n] });
    expect(r2.relabelled).toBe(0n);
  });

  it("merges adjacent tranches of the same leader", () => {
    const q = pushLots(pushLots(EMPTY_QUEUE, "1", 10n), "1", 5n);
    expect(q).toEqual({ leaderIds: ["1"], lots: [15n] });
  });

  it("reports a shortfall as unattributed", () => {
    const r = consumeLots(pushLots(EMPTY_QUEUE, "1", 10n), 25n);
    expect(r.parts).toEqual([
      { leaderId: "1", lots: 10n },
      { leaderId: "0", lots: 15n },
    ]);
    expect(r.queue).toEqual(EMPTY_QUEUE);
  });

  it("allocates exactly, remainder to the last part", () => {
    const parts = [
      { leaderId: "a", lots: 1n },
      { leaderId: "b", lots: 1n },
      { leaderId: "c", lots: 1n },
    ];
    const shares = allocateByLots(100n, parts);
    expect(shares).toEqual([33n, 33n, 34n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(allocateByLots(-7n, [{ leaderId: "a", lots: 3n }, { leaderId: "b", lots: 1n }])).toEqual([-5n, -2n]);
  });
});
