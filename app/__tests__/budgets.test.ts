import { decodeAbiParameters } from "viem";
import {
  buildSplitPolicy,
  findFollow,
  findUnfollowed,
  heldByOthers,
  leaderBooks,
  ownershipSentence,
  rearmPolicy,
  splitTargets,
  splitTotals,
  splitWithNewLeader,
  validateSplit,
  type SplitRow,
} from "../src/lib/budgets";
import { POLICY_PARAM, encodeSetPolicy, encodeFollow, validatePolicy, MIRROR_ORDERS_PARAM } from "../src/lib/contracts";
import { normalizeAccount, normalizeFeedEvent } from "../src/lib/engineShape";
import { stopPlan } from "../src/lib/levels";
import type { MirrorAccount, Policy } from "../src/lib/types";

const NOW = 1_800_000_000;
const A = 1043, B = 877, C = 1588;
const policy = (leaders: Policy["leaders"]): Policy => ({
  maxLeverageHdths: 500, maxSlippageBps: 50, dailyLossBps: 1000, drawdownBps: 2000, expiry: NOW + 86400 * 30, maxEntryDeviationBps: 100,
  stopSlippageBps: 300, flattenOnStop: true, maxBuilderFeePer100K: 20, leaders, markets: [{ perpId: 1, maxNotionalCNS: "12000000" }, { perpId: 20, maxNotionalCNS: "12000000" }],
});
const pos = (perpId: number, leaderAccountId: number, marginCNS: string, upnlCNS = "0") => ({ perpId, side: "long" as const, lotLNS: "10", entryPNS: "1", markPNS: "1", liqPNS: "0", leverageHdths: 300, marginCNS, notionalCNS: "0", upnlCNS, leaderAccountId });

function account(over: Partial<MirrorAccount> = {}): MirrorAccount {
  return normalizeAccount({
    address: "0x00000000000000000000000000000000000000aa", owner: "0x00000000000000000000000000000000000000bb", deployed: true, salt: "0x" + "0".repeat(64),
    netDepositsCNS: "24000000", equityCNS: "24160000", balanceCNS: "24000000", depositCapCNS: "25000000",
    policy: policy([
      { accountId: A, ratioBps: 10, budgetCNS: "12000000", lossStopBps: 1500 },
      { accountId: B, ratioBps: 25, budgetCNS: "8000000", lossStopBps: 1000 },
      { accountId: C, ratioBps: 10, budgetCNS: "4000000", lossStopBps: 1500, stopped: true } as never,
    ]),
    positions: [
      { perpId: 1, side: "long", lotLNS: "10", entryPricePNS: "1", markPNS: "1", depositCNS: "3000000", unrealizedPnlCNS: "400000", leaderAccountId: A },
      { perpId: 31, side: "long", lotLNS: "10", entryPricePNS: "1", markPNS: "1", depositCNS: "1310000", unrealizedPnlCNS: "100000", leaderAccountId: A },
      { perpId: 20, side: "short", lotLNS: "10", entryPricePNS: "1", markPNS: "1", depositCNS: "2000000", unrealizedPnlCNS: "140000", leaderAccountId: B },
    ],
    // Engine shape (views.ts): pnlByLeader from MirrorAccount.leaderBook.
    pnlByLeader: [
      { leaderAccountId: A, unrealizedPnlCNS: "500000", realizedPnlCNS: "120000", marginCNS: "4310000", budgetCNS: "12000000", stopped: false },
      { leaderAccountId: B, unrealizedPnlCNS: "140000", realizedPnlCNS: "0", marginCNS: "2000000", budgetCNS: "8000000", stopped: false },
      { leaderAccountId: C, unrealizedPnlCNS: "0", realizedPnlCNS: "-600000", marginCNS: "0", budgetCNS: "4000000", stopped: true },
    ],
    ...over,
  });
}

describe("engine shape: per-leader books", () => {
  it("keeps margin, budget and stopped from pnlByLeader", () => {
    const a = account();
    expect(a.pnl.byLeader.find((l) => l.leaderAccountId === A)).toMatchObject({ marginCNS: "4310000", budgetCNS: "12000000", stopped: false });
    expect(a.pnl.byLeader.find((l) => l.leaderAccountId === C)?.stopped).toBe(true);
  });
  it("names the holder, budget and loss stop in blocked rules", () => {
    const held = normalizeFeedEvent({ kind: "Blocked", reason: "MarketHeldByOtherLeader", limit: String(B), actual: String(A), account: "0x00000000000000000000000000000000000000aa" });
    expect(held.blocked?.rule).toBe(`Market held by Perpl #${A}`);
    const budget = normalizeFeedEvent({ kind: "Blocked", reason: "LeaderBudgetExceeded", limit: "2000000", actual: "2410000", account: "0x00000000000000000000000000000000000000aa" });
    expect(budget.blocked?.rule).toBe("Leader budget 2.00 (copy needs 2.41)");
    const stop = normalizeFeedEvent({ kind: "Blocked", reason: "LeaderLossStop", limit: "600000", actual: "650000", account: "0x00000000000000000000000000000000000000aa" });
    expect(stop.blocked?.rule).toBe("Leader loss stop: lost 0.65 of 0.60");
  });
});

describe("leaderBooks", () => {
  const books = leaderBooks(account());
  it("one book per leader with leaderBook margin, PnL and status", () => {
    expect(books.map((b) => [b.leaderId, b.status])).toEqual([[A, "copying"], [B, "copying"], [C, "stopped"]]);
    const a = books[0];
    expect(a.marginCNS).toBe(4_310_000n);
    expect(a.pnlCNS).toBe(620_000n);
    expect(a.positions.map((p) => p.perpId)).toEqual([1, 31]);
  });
  it("loss stop: limit, stop level and distance", () => {
    const a = books[0];
    expect(a.lossLimitCNS).toBe(1_800_000n);
    expect(a.stopAtCNS).toBe(10_200_000n);
    expect(a.lossLeftCNS).toBe(2_420_000n);
    expect(books[2].lossLeftCNS).toBe(0n);
  });
  it("a removed leader whose positions stay is 'Stopped following'", () => {
    const a = account({ policy: policy([{ accountId: A, ratioBps: 10, budgetCNS: "12000000", lossStopBps: 0 }]) } as never);
    const raw = leaderBooks(a);
    expect(raw.map((b) => [b.leaderId, b.status, b.inPolicy])).toEqual([[A, "copying", true], [B, "unfollowed", false]]);
    expect(findUnfollowed([a], B)?.book.positions).toHaveLength(1);
    expect(findFollow([a], B)).toBeNull();
  });
  it("findFollow finds the account by any of its leaders", () => {
    expect(findFollow([account()], B)?.book.budgetCNS).toBe(8_000_000n);
  });
});

describe("validateSplit", () => {
  const rows: SplitRow[] = [
    { accountId: A, budgetCNS: 12_000_000n, ratioBps: 10, lossStopBps: 1500, marginCNS: 4_310_000n },
    { accountId: B, budgetCNS: 8_000_000n, ratioBps: 25, lossStopBps: 1000, isNew: true },
  ];
  it("accepts budgets that fit the deposit and shows what is left", () => {
    expect(validateSplit({ depositCNS: 24_000_000n, rows })).toEqual([]);
    expect(splitTotals(24_000_000n, rows).unassigned).toBe(4_000_000n);
  });
  it("refuses budgets above the deposit, and a top-up fixes it", () => {
    const over = rows.map((r) => (r.accountId === B ? { ...r, budgetCNS: 13_000_000n } : r));
    const issues = validateSplit({ depositCNS: 24_000_000n, rows: over });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "total" });
    expect(issues[0].message).toContain("1.00 more than your 24.00 AUSD deposit");
    expect(validateSplit({ depositCNS: 24_000_000n, rows: over, topUpCNS: 1_000_000n, walletCNS: 5_000_000n, capCNS: 25_000_000n })).toEqual([]);
  });
  it("a budget can't go below the margin its positions hold, or be 0", () => {
    const low = [{ ...rows[0], budgetCNS: 4_000_000n }, { ...rows[1], budgetCNS: 0n }];
    const issues = validateSplit({ depositCNS: 24_000_000n, rows: low, name: (id) => `L${id}` });
    expect(issues.map((x) => [x.field, x.leaderId])).toEqual([["budget", A], ["budget", B]]);
    expect(issues[0].message).toBe(`L${A} uses 4.31 margin now, so its budget can't go below 4.31`);
  });
  it("top-up within the wallet and the per-account cap; at most 4 leaders, no duplicates", () => {
    expect(validateSplit({ depositCNS: 24_000_000n, rows, topUpCNS: 2_000_000n, walletCNS: 1_000_000n, capCNS: 25_000_000n }).map((x) => x.message)).toEqual(["More than your wallet balance", "Beta limit is 25.00 AUSD per account"]);
    const five = [A, B, C, 4, 5].map((id) => ({ accountId: id, budgetCNS: 1_000_000n, ratioBps: 10, lossStopBps: 0 }));
    expect(validateSplit({ depositCNS: 24_000_000n, rows: five }).some((x) => x.field === "leaders")).toBe(true);
    expect(validateSplit({ depositCNS: 24_000_000n, rows: [rows[1], rows[1]] }).some((x) => /twice/.test(x.message))).toBe(true);
  });
});

describe("policy with several leaders", () => {
  it("a new leader starts with the unassigned part; the account must have room for it", () => {
    const a = account({ policy: policy([{ accountId: A, ratioBps: 10, budgetCNS: "12000000", lossStopBps: 1500 }]) } as never);
    const rows = splitWithNewLeader(a, C, 50, 1000);
    expect(rows.map((r) => [r.accountId, r.budgetCNS, !!r.isNew])).toEqual([[A, 12_000_000n, false], [C, 12_000_000n, true]]);
    expect(splitTargets([a], C)).toHaveLength(1);
    // Nothing unassigned: half of the most idle budget (whole AUSD) is proposed for the new leader.
    const full = account({ netDepositsCNS: "12000000", policy: policy([{ accountId: A, ratioBps: 10, budgetCNS: "12000000", lossStopBps: 0 }]) } as never);
    const prop = splitWithNewLeader(full, C, 50, 1000);
    expect(prop.map((r) => r.budgetCNS)).toEqual([9_000_000n, 3_000_000n]);
    expect(validateSplit({ depositCNS: 12_000_000n, rows: prop })).toEqual([]);
    expect(splitTargets([a], A)).toHaveLength(0);
    expect(splitTargets([account()], 4).length).toBe(1);
  });
  it("buildSplitPolicy signs every leader with its own budget and keeps the account's markets", () => {
    const a = account();
    const p = buildSplitPolicy(a.policy!, [
      { accountId: A, budgetCNS: 10_000_000n, ratioBps: 10, lossStopBps: 1500 },
      { accountId: B, budgetCNS: 8_000_000n, ratioBps: 25, lossStopBps: 1000 },
      { accountId: 4242, budgetCNS: 6_000_000n, ratioBps: 100, lossStopBps: 2500 },
    ], [{ perpId: 31, maxNotionalCNS: "5000000" }, { perpId: 1, maxNotionalCNS: "1" }]);
    expect(validatePolicy(p, NOW)).toBeNull();
    const [d] = decodeAbiParameters([POLICY_PARAM], encodeSetPolicy(p)) as any;
    expect(d.leaders.map((l: any) => [l.accountId, l.ratioBps, l.budgetCNS, l.lossStopBps])).toEqual([[A, 10, 10_000_000n, 1500], [B, 25, 8_000_000n, 1000], [4242, 100, 6_000_000n, 2500]]);
    expect(d.markets.map((m: any) => [m.perpId, m.maxNotionalCNS])).toEqual([[1, 12_000_000n], [20, 12_000_000n], [31, 5_000_000n]]);
    // ACTION_FOLLOW carries the same policy plus the new leader's match-now orders.
    const order = { leaderAccountId: 4242, perpId: 31, orderType: 0 as const, lotLNS: "5", pricePNS: "200", leverageHdths: 300, maxMatches: 100, leaderRef: ("0x" + "0".repeat(64)) as `0x${string}`, leaderFillPNS: "0" };
    const [fp, fo] = decodeAbiParameters([POLICY_PARAM, MIRROR_ORDERS_PARAM], encodeFollow(p, [order])) as any;
    expect(fp.leaders).toHaveLength(3);
    expect(fo[0].leaderAccountId).toBe(4242);
  });
  it("engine read-outs (stopped, halted) never reach the signed struct", () => {
    const p = buildSplitPolicy(account().policy!, [{ accountId: C, budgetCNS: 4_000_000n, ratioBps: 10, lossStopBps: 1500 }]);
    expect(Object.keys(p.leaders[0]).sort()).toEqual(["accountId", "budgetCNS", "lossStopBps", "ratioBps"]);
  });
  it("re-arm signs the same leaders again, optionally with a new loss stop", () => {
    const a = account();
    expect(rearmPolicy(a)!.leaders.map((l) => l.accountId)).toEqual([A, B, C]);
    expect(rearmPolicy(a, C, 2500)!.leaders.find((l) => l.accountId === C)?.lossStopBps).toBe(2500);
  });
  it("removing a leader keeps its positions: setPolicy without it", () => {
    const plan = stopPlan(account(), B, "keep", NOW);
    expect(plan.how).toBe("remove");
    const [d] = decodeAbiParameters([POLICY_PARAM], plan.actions[0].data) as any;
    expect(d.leaders.map((l: any) => l.accountId)).toEqual([A, C]);
    expect(plan.positions.map((p) => p.perpId)).toEqual([20]);
  });
});

describe("market ownership", () => {
  it("names the markets another leader holds", () => {
    const a = { positions: [pos(1, A, "1"), pos(31, A, "1"), pos(20, B, "1")] };
    const held = heldByOthers(a, B, [1, 20, 99]);
    expect(held).toEqual([{ perpId: 1, holder: A }]);
    const s = ownershipSentence(held, (p) => (p === 1 ? "BTC" : "?"), () => "0x7a3f…c91e");
    expect(s).toBe("A market belongs to the leader whose copy opened it. BTC is held by 0x7a3f…c91e, so this leader's BTC trades are blocked until it closes.");
    const two = ownershipSentence(heldByOthers(a, C, [1, 31]), (p) => (p === 1 ? "BTC" : "SOL"), () => "0x7a3f…c91e");
    expect(two).toContain("BTC and SOL are held by 0x7a3f…c91e, so this leader's BTC and SOL trades are blocked until they close.");
    expect(ownershipSentence([], String, String)).toContain("none of its trades wait");
  });
});
