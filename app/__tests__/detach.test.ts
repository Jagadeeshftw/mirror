// "Stop following, keep my positions" is onchain: MirrorAccount.setLeaderDetached / execute(ACTION_SET_LEADER_DETACHED).
import abi from "../src/lib/MirrorAccount.json";
import { decodeAbiParameters, encodeFunctionData, getAbiItem, toFunctionSelector } from "viem";
import { ACTION, BLOCK_REASONS, encodeSetLeaderDetached } from "../src/lib/contracts";
import { RULE_NAMES } from "../src/lib/blockReasons";
import { isLeaderDetached, leaderBooks } from "../src/lib/budgets";
import { normalizeAccount, normalizeFeedEvent } from "../src/lib/engineShape";
import { setLeaderDetachedAction, stopPlan } from "../src/lib/levels";
import type { MirrorAccount } from "../src/lib/types";

const POLICY = { leaders: [{ accountId: 7, ratioBps: 10, budgetCNS: "1000000", lossStopBps: 0 }], markets: [], expiry: 4e9 };

describe("ACTION_SET_LEADER_DETACHED", () => {
  it("kind 11 and abi.encode(uint32 leader, bool detached), the contract's own argument encoding", () => {
    expect(ACTION.SET_LEADER_DETACHED).toBe(11);
    const data = encodeSetLeaderDetached(143, true);
    expect(decodeAbiParameters([{ type: "uint32" }, { type: "bool" }], data)).toEqual([143, true]);
    // Same bytes as the arguments of setLeaderDetached(uint32,bool) in the regenerated ABI.
    const call = encodeFunctionData({ abi: abi as any, functionName: "setLeaderDetached", args: [143, true] });
    expect(call.slice(10)).toBe(data.slice(2));
    expect(toFunctionSelector(getAbiItem({ abi: abi as any, name: "setLeaderDetached" }) as any)).toBe(call.slice(0, 10));
    expect(setLeaderDetachedAction(9, false)).toEqual({ kind: 11, data: encodeSetLeaderDetached(9, false) });
  });
  it("BlockReason 22 is LeaderDetached, labelled for the feed", () => {
    expect(BLOCK_REASONS[22]).toBe("LeaderDetached");
    expect(RULE_NAMES.LeaderDetached).toBe("Stopped following this leader (positions kept)");
  });
});

describe("stop following, keep my positions", () => {
  it("only leader: one signed ACTION 11 (leader, true); nothing is paused", () => {
    const a = { policy: POLICY, positions: [], leader: null, paused: false } as unknown as MirrorAccount;
    const p = stopPlan(a, 7, "keep");
    expect(p.how).toBe("detach");
    expect(p.actions.map((x) => x.kind)).toEqual([ACTION.SET_LEADER_DETACHED]);
    expect(decodeAbiParameters([{ type: "uint32" }, { type: "bool" }], p.actions[0].data)).toEqual([7, true]);
  });
  it("a leader not in the policy is refused before signing (the contract reverts InvalidPolicy(\"leader\"))", () => {
    const a = { policy: POLICY, positions: [], leader: null, paused: false } as unknown as MirrorAccount;
    const p = stopPlan(a, 8, "keep");
    expect(p.error).toBeTruthy();
    expect(p.actions).toEqual([]);
  });
});

describe("engine read-out", () => {
  const raw = {
    address: "0x00000000000000000000000000000000000000aa",
    owner: "0x00000000000000000000000000000000000000bb",
    paused: false,
    detachedLeaders: [7],
    policy: { ...POLICY, leaders: [{ ...POLICY.leaders[0], detached: true }, { accountId: 8, ratioBps: 10, budgetCNS: "1000000", lossStopBps: 0, detached: false }] },
    positions: [],
    pnlByLeader: [{ leaderAccountId: 7, realizedPnlCNS: "0", unrealizedPnlCNS: "0", marginCNS: "0", budgetCNS: "1000000", stopped: false, detached: true }],
  };
  it("detachedLeaders / policy.leaders[].detached / pnlByLeader[].detached", () => {
    const a = normalizeAccount(raw);
    expect(a.detachedLeaders).toEqual([7]);
    expect(isLeaderDetached(a, 7)).toBe(true);
    expect(isLeaderDetached(a, 8)).toBe(false);
    expect(a.pnl.byLeader[0].detached).toBe(true);
    const books = leaderBooks(a);
    expect(books.find((b) => b.leaderId === 7)?.status).toBe("detached");
    expect(books.find((b) => b.leaderId === 8)?.status).toBe("copying");
    // Without detachedLeaders the policy flag alone is enough.
    expect(isLeaderDetached(normalizeAccount({ ...raw, detachedLeaders: undefined, pnlByLeader: [] }), 7)).toBe(true);
  });
  it("LeaderDetached feed rows are onchain, and Blocked LeaderDetached carries a rule", () => {
    const row = normalizeFeedEvent({ id: 1, kind: "LeaderDetached", onchain: true, account: raw.address, txHash: "0x" + "1".repeat(64), leaderAccountId: 7, label: null, data: { detached: true, label: "Stopped following this leader (positions kept)" }, block: 1, timestamp: 1 });
    expect(row.kind).toBe("LeaderDetached");
    expect(row.txHash).toMatch(/^0x1/);
    const b = normalizeFeedEvent({ id: 2, kind: "Blocked", account: raw.address, reason: "LeaderDetached", limit: "0", actual: "7", leaderAccountId: 7, block: 1, timestamp: 1 });
    expect(b.blocked).toMatchObject({ reason: "LeaderDetached", reasonCode: 22, rule: "Stopped following this leader (positions kept)" });
  });
});
