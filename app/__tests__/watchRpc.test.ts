import { encodeAbiParameters, encodeEventTopics, type Abi } from "viem";
import { WATCH_ABI, readWatchFromRpc } from "../src/lib/watchRpc";

const ACCOUNT = "0xde30f011000000000000000000000000000000a1" as const;
const ev = (name: string) => (WATCH_ABI as any[]).find((x) => x.type === "event" && x.name === name);

function log(name: string, args: Record<string, any>, block: bigint, i: number) {
  const e = ev(name);
  const indexed = e.inputs.filter((x: any) => x.indexed);
  const plain = e.inputs.filter((x: any) => !x.indexed);
  const topics = encodeEventTopics({ abi: [e] as Abi, eventName: name, args: Object.fromEntries(indexed.map((x: any) => [x.name, args[x.name]])) as any });
  return {
    address: ACCOUNT,
    topics,
    data: encodeAbiParameters(plain, plain.map((x: any) => args[x.name])),
    blockNumber: block,
    transactionHash: `0x${String(i).padStart(64, "0")}`,
    logIndex: i,
    blockHash: `0x${"ab".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

describe("readWatchFromRpc", () => {
  it("reads equity and the newest copies in 100-block chunks", async () => {
    const head = 1000n;
    const logs = [
      log("Mirrored", { keeper: ACCOUNT, leaderAccountId: 9001, perpId: 1, orderType: 0, lotLNS: 1n, pricePNS: 1184140n, leverageHdths: 200, lotsBefore: 0n, lotsAfter: 1n, leaderRef: `0x${"11".repeat(32)}`, proof: { leaderFillPNS: 1184020n, leaderEntryPNS: 1184020n, markPNS: 1184100n, fillPNS: 1184140n, entryDeviationBps: 1, builderFeeCNS: 237n } }, 999n, 1),
      log("Blocked", { keeper: ACCOUNT, leaderAccountId: 9001, perpId: 1, reason: 6, orderType: 0, lotLNS: 1n, limit: 500n, actual: 1200n, leaderRef: `0x${"22".repeat(32)}`, leaderFillPNS: 1183910n, markPNS: 1183900n }, 850n, 2),
    ];
    const ranges: [bigint, bigint][] = [];
    const client = {
      getBlockNumber: async () => head,
      readContract: async () => 9_870_000n,
      getLogs: async ({ fromBlock, toBlock }: any) => {
        ranges.push([fromBlock, toBlock]);
        return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
    };
    const snap = await readWatchFromRpc(client as any, ACCOUNT, { maxBlocks: 300, want: 2, now: 2_000_000 });
    expect(ranges[0]).toEqual([901n, 1000n]);
    expect(ranges.every(([f, t]) => t - f < 100n)).toBe(true);
    expect(snap.block).toBe(1000);
    expect(snap.equityCNS).toBe("9870000");
    expect(snap.events.map((e) => e.kind)).toEqual(["Mirrored", "Blocked"]);
    const m = snap.events[0];
    expect(m.proof?.fillPNS).toBe("1184140");
    expect(m.teamRun).toBe(true);
    expect(m.onchain).toBe(true);
    expect(m.commitState).toBe("voted");
    expect(m.timestamp).toBe(2_000_000 - 400);
    const b = snap.events[1];
    expect(b.blocked).toEqual({ reason: "LeverageTooHigh", reasonCode: 6, limit: "500", actual: "1200" });
    expect(b.commitState).toBe("finalized");
  });

  it("stops scanning at maxBlocks when there are no copies", async () => {
    let calls = 0;
    const client = { getBlockNumber: async () => 5000n, readContract: async () => 0n, getLogs: async () => (calls++, []) };
    const snap = await readWatchFromRpc(client as any, ACCOUNT, { maxBlocks: 250 });
    expect(calls).toBe(3);
    expect(snap.events).toEqual([]);
  });
});
