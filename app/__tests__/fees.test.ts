import { BUILDER_FEE_PER_100K, FEE_PCT, copyFeeCNS, feeFor, feeText, plannedFeeCNS } from "../src/lib/fees";

describe("builder fee", () => {
  it("is 0.02% of opening notional", () => {
    expect(BUILDER_FEE_PER_100K).toBe(20);
    expect(FEE_PCT).toBe("0.02%");
    expect(feeFor(11_840_000n)).toBe(2_368n);
    expect(feeText(feeFor(11_840_000n))).toBe("0.0024");
  });
  it("reads the fee from the copy proof and is 0 on closes", () => {
    const base = { id: "1", account: "0x1", txHash: "0x2", block: 1, timestamp: 0, commitState: "finalized" } as any;
    expect(copyFeeCNS({ ...base, kind: "Mirrored", orderType: 0, proof: { builderFeeCNS: "1700" } })).toBe(1700n);
    expect(copyFeeCNS({ ...base, kind: "Mirrored", orderType: 2, proof: { builderFeeCNS: "1700" } })).toBe(0n);
    expect(copyFeeCNS({ ...base, kind: "Mirrored", orderType: 1 })).toBeNull();
    expect(copyFeeCNS({ ...base, kind: "Blocked" })).toBeNull();
  });
  it("sums the planned fee over quote lines that will copy", () => {
    expect(plannedFeeCNS([{ notionalCNS: "10000000", wouldBlock: null, orderType: 0 }, { notionalCNS: "5000000", wouldBlock: { reason: "x", limit: "1", actual: "2" }, orderType: 1 }])).toBe(2_000n);
  });
});
