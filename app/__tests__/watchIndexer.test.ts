import { blockedToEvent, copyToEvent, readWatchFromIndexer, type IndexerBlocked, type IndexerCopy } from "../src/lib/watchIndexer";

const A = "0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896" as const;
const copy: IndexerCopy = {
  id: "0xc14c-7", txHash: "0xc14cd15a3d3243263fc3b43cd2b7d1ae349c407622bf7479dc788ef7c873aa9b", timestamp: 1_791_470_000, blockNumber: 69_282_394,
  leaderAccountId: "1000", perpId: 16, orderType: "OPEN_LONG", lotLNS: "1", pricePNS: "834300", fillPricePNS: "826100", leverageHdths: 200,
  leaderRef: "0x7f88", leaderFillReportedPNS: "826000", leaderEntryPNS: "826000", markPNS: "826050", proofFillPNS: "826100", entryDeviationBps: 1,
  builderFeeCNS: "166", builderFeePerplCNS: "166", latencyBlocks: 2, latencySeconds: 1, teamRun: true,
};
const blocked: IndexerBlocked = {
  id: "0xcfee-3", txHash: "0xcfeeda062c5a5590e051c892d7c379c0019d93548f5f66f13043718f7a6d80aa", timestamp: 1_791_471_000, blockNumber: 69_284_000,
  leaderAccountId: "1000", perpId: 16, orderType: "OPEN_LONG", lotLNS: "20", reason: "LeverageTooHigh", reasonCode: 6, limit: "200", actual: "1000",
  leaderFillPNS: "0", markPNS: "826000", teamRun: true,
};

describe("watch mode from the indexer", () => {
  it("maps a CopyEvent to a Mirrored feed event with its proof, fee and latency", () => {
    const e = copyToEvent(copy, A);
    expect(e).toMatchObject({ kind: "Mirrored", orderType: 0, perpId: 16, leaderAccountId: 1000, txHash: copy.txHash, timestamp: copy.timestamp * 1000, latencyMs: 1000, latencyBlocks: 2, commitState: "finalized" });
    expect(e.proof).toMatchObject({ fillPNS: "826100", leaderEntryPNS: "826000", builderFeeCNS: "166", entryDeviationBps: 1 });
  });
  it("maps a BlockedCopy to a Blocked feed event with the rule and numbers", () => {
    const e = blockedToEvent(blocked, A);
    expect(e).toMatchObject({ kind: "Blocked", orderType: 0, txHash: blocked.txHash });
    expect(e.blocked).toMatchObject({ reason: "LeverageTooHigh", reasonCode: 6, limit: "200", actual: "1000" });
  });
  it("merges both newest first and caps the count; throws when the indexer can't answer", async () => {
    const ok = (async () => new Response(JSON.stringify({ data: { CopyEvent: [copy], BlockedCopy: [blocked] } }))) as unknown as typeof fetch;
    const out = await readWatchFromIndexer("https://idx", A, 5, ok);
    expect(out.map((e) => e.kind)).toEqual(["Blocked", "Mirrored"]);
    const down = (async () => new Response("bad", { status: 502 })) as unknown as typeof fetch;
    await expect(readWatchFromIndexer("https://idx", A, 5, down)).rejects.toThrow(/indexer 502/);
  });
});
