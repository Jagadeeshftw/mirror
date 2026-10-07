import { bpsText, deviationBps, entryBoundPNS, entryUsed, fillDeviationBps, isBuy, worseByPNS } from "../src/lib/proof";

const proof = { leaderFillPNS: "1184020", leaderEntryPNS: "1184020", markPNS: "1184100", fillPNS: "1184140", entryDeviationBps: 1 };

describe("copy proof", () => {
  it("knows the buy side", () => {
    expect([0, 1, 2, 3].map(isBuy)).toEqual([true, false, false, true]);
  });
  it("signs deviation against the follower", () => {
    // open long, paid 12.0 more than the leader on 118,402.0: +1.01 bps
    expect(fillDeviationBps(proof, 0)).toBeCloseTo(1.01, 2);
    // the same prices on a sell are better for the follower
    expect(fillDeviationBps(proof, 2)).toBeCloseTo(-1.01, 2);
    expect(worseByPNS(proof, 0)).toBe(120n);
  });
  it("has no price difference for a close (no recorded fill)", () => {
    expect(worseByPNS({ ...proof, fillPNS: "0" }, 2)).toBeNull();
  });
  it("has no deviation without a leader fill", () => {
    expect(deviationBps("0", "100", 0)).toBeNull();
  });
  it("computes the entry filter bound like the contract", () => {
    expect(entryBoundPNS(1184020n, 100, true)).toBe(1195860n);
    expect(entryBoundPNS(19810n, 100, false)).toBe(19612n);
  });
  it("reports the allowance used", () => {
    expect(entryUsed(proof, 100)).toBeCloseTo(0.01);
    expect(entryUsed(proof, 0)).toBeNull();
  });
  it("formats bps with a true minus", () => {
    expect(bpsText(1.04)).toBe("+1.0");
    expect(bpsText(-0.7)).toBe("−0.7");
    expect(bpsText(null)).toBe("—");
  });
});
