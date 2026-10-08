import { encodeAbiParameters, encodeEventTopics, type Abi } from "viem";
import { DOWN_SCAN_BLOCKS, MAX_LOG_REQUESTS, WATCH_ABI, discoverOwnAccounts, readOwnFromRpc, readWatchFromRpc, scannedMinutes } from "../src/lib/watchRpc";
import { followSalt, predictAccount } from "../src/lib/contracts";

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

  it("with Mirror down scans further back, bounded: <= 28 eth_getLogs calls (<= 30 requests in all)", async () => {
    let logCalls = 0;
    let other = 0;
    const client = { getBlockNumber: async () => (other++, 1_000_000n), readContract: async () => (other++, 0n), getLogs: async () => (logCalls++, []) };
    const snap = await readWatchFromRpc(client as any, ACCOUNT, { maxBlocks: DOWN_SCAN_BLOCKS });
    expect(logCalls).toBe(MAX_LOG_REQUESTS);
    expect(logCalls + other).toBeLessThanOrEqual(30);
    expect(snap.logRequests).toBe(MAX_LOG_REQUESTS);
    expect(snap.fromBlock).toBe(1_000_000 - DOWN_SCAN_BLOCKS + 1);
    expect(scannedMinutes(snap)).toBe(19);
    expect(snap.events).toEqual([]);
  });

  it("never exceeds the request cap even when asked for more blocks", async () => {
    let calls = 0;
    const client = { getBlockNumber: async () => 10_000_000n, readContract: async () => 0n, getLogs: async () => (calls++, []) };
    await readWatchFromRpc(client as any, ACCOUNT, { maxBlocks: 1_000_000 });
    expect(calls).toBe(MAX_LOG_REQUESTS);
  });

  it("refreshes scan only the blocks since the previous read, and keep earlier copies", async () => {
    const old = log("Mirrored", { keeper: ACCOUNT, leaderAccountId: 9001, perpId: 16, orderType: 0, lotLNS: 1n, pricePNS: 1n, leverageHdths: 200, lotsBefore: 0n, lotsAfter: 1n, leaderRef: `0x${"11".repeat(32)}`, proof: { leaderFillPNS: 1n, leaderEntryPNS: 1n, markPNS: 1n, fillPNS: 1n, entryDeviationBps: 0, builderFeeCNS: 0n } }, 1000n, 1);
    const neu = log("Blocked", { keeper: ACCOUNT, leaderAccountId: 9001, perpId: 16, reason: 6, orderType: 0, lotLNS: 1n, limit: 500n, actual: 1200n, leaderRef: `0x${"22".repeat(32)}`, leaderFillPNS: 1n, markPNS: 1n }, 1150n, 2);
    let head = 1100n;
    const ranges: [bigint, bigint][] = [];
    const all = [old, neu];
    const client = { getBlockNumber: async () => head, readContract: async () => 5n, getLogs: async ({ fromBlock, toBlock }: any) => (ranges.push([fromBlock, toBlock]), all.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && l.blockNumber <= head)) };
    const first = await readWatchFromRpc(client as any, ACCOUNT, { maxBlocks: DOWN_SCAN_BLOCKS });
    expect(first.events.map((e) => e.kind)).toEqual(["Mirrored"]);
    ranges.length = 0;
    head = 1200n;
    const next = await readWatchFromRpc(client as any, ACCOUNT, { maxBlocks: DOWN_SCAN_BLOCKS, prev: first });
    expect(ranges).toEqual([[1101n, 1200n]]);
    expect(next.events.map((e) => e.kind)).toEqual(["Blocked", "Mirrored"]);
    expect(next.fromBlock).toBe(first.fromBlock);
  });
});

describe("own accounts without Mirror's service", () => {
  const FACTORY = "0x82B769500E34362a76DF81150e12C746093D954F" as const;
  const IMPL = "0xBE6566b6d79dF8EA95b2619478019333aA758BE8" as const;
  const OWNER = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as const;
  const cfg = { contracts: { factory: FACTORY, implementation: IMPL, keeperRegistry: null, perplExchange: ACCOUNT, collateral: ACCOUNT } } as any;
  const a0 = predictAccount(FACTORY, IMPL, OWNER, followSalt(0));
  const a1 = predictAccount(FACTORY, IMPL, OWNER, followSalt(1));

  it("finds follow accounts at the factory's CREATE2 addresses while code is deployed", async () => {
    const deployed = new Set([a0.toLowerCase(), a1.toLowerCase()]);
    const asked: string[] = [];
    const client = { getCode: async ({ address }: any) => (asked.push(address), deployed.has(address.toLowerCase()) ? "0x6001" : undefined) };
    expect(await discoverOwnAccounts(client as any, cfg, OWNER)).toEqual([a0, a1]);
    expect(asked).toHaveLength(3);
  });

  it("none without a factory in the config (no contract known)", async () => {
    expect(await discoverOwnAccounts({ getCode: async () => "0x60" } as any, { contracts: { factory: null, implementation: null } } as any, OWNER)).toEqual([]);
  });

  it("reads equity and copies for each account, own copies not marked team-run, within the request budget", async () => {
    let logCalls = 0;
    let calls = 0;
    const m = (acct: string, block: bigint, i: number) => ({ ...log("Mirrored", { keeper: ACCOUNT, leaderAccountId: 7, perpId: 16, orderType: 0, lotLNS: 1n, pricePNS: 1n, leverageHdths: 200, lotsBefore: 0n, lotsAfter: 1n, leaderRef: `0x${"11".repeat(32)}`, proof: { leaderFillPNS: 1n, leaderEntryPNS: 1n, markPNS: 1n, fillPNS: 1n, entryDeviationBps: 0, builderFeeCNS: 0n } }, block, i), address: acct });
    const logs = [m(a0, 990n, 1), m(a1, 995n, 2)];
    const client = {
      getCode: async ({ address }: any) => (calls++, [a0, a1].map((x) => x.toLowerCase()).includes(address.toLowerCase()) ? "0x60" : "0x"),
      getBlockNumber: async () => (calls++, 1000n),
      readContract: async ({ address }: any) => (calls++, address === a0 ? 12_000_000n : 3_000_000n),
      getLogs: async ({ address, fromBlock, toBlock }: any) => (logCalls++, logs.filter((l) => l.address === address && l.blockNumber >= fromBlock && l.blockNumber <= toBlock)),
    };
    const snap = await readOwnFromRpc(client as any, cfg, OWNER, { now: 1_000_000 });
    expect(snap.accounts.map((x) => x.account)).toEqual([a0, a1]);
    expect(snap.equityCNS).toBe("15000000");
    expect(snap.events.map((e) => e.account)).toEqual([a1, a0]);
    expect(snap.events.every((e) => e.teamRun === false)).toBe(true);
    expect(logCalls + calls).toBeLessThanOrEqual(30);
  });

  it("one account with no copies: the whole budget, still <= 30 calls", async () => {
    let calls = 0;
    const client = { getCode: async ({ address }: any) => (calls++, address.toLowerCase() === a0.toLowerCase() ? "0x60" : "0x"), getBlockNumber: async () => (calls++, 5_000_000n), readContract: async () => (calls++, 0n), getLogs: async () => (calls++, []) };
    const snap = await readOwnFromRpc(client as any, cfg, OWNER);
    expect(calls).toBeLessThanOrEqual(30);
    expect(scannedMinutes({ block: snap.block!, fromBlock: snap.fromBlock! })).toBeGreaterThanOrEqual(15);
  });

  it("no accounts: an empty snapshot, no log reads", async () => {
    const client = { getCode: async () => "0x", getBlockNumber: jest.fn(), readContract: jest.fn(), getLogs: jest.fn() };
    const snap = await readOwnFromRpc(client as any, cfg, OWNER);
    expect(snap.accounts).toEqual([]);
    expect(snap.events).toEqual([]);
    expect(client.getLogs).not.toHaveBeenCalled();
  });
});
