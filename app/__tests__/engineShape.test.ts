// Adapters against real engine responses captured on the localnet (localnet/e2e-web/capture-fixtures.mjs).
import { explainBlock } from "../src/ui/feed";
import { learnConfig, normalizeAccount, normalizeFeedPage, normalizeOwnerAccounts } from "../src/lib/engineShape";
import { normalizeCycle, normalizeDemo, normalizeQuote, normalizeStreamMessage, normalizeMarkets } from "../src/lib/engineDemo";
import { normalizeLeaderProfile, normalizeLeaderSummary } from "../src/lib/leaderShape";
import { normalizeConfig } from "../src/lib/config";
import { copyFeeCNS } from "../src/lib/fees";

jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const fx = (n: string) => require(`./fixtures/engine/${n}.json`);
const config = fx("config");
const cfg = normalizeConfig(config);
learnConfig(config);

describe("owner accounts and accounts", () => {
  it("leaves out the bare predicted account of a new owner", () => {
    const raw = fx("owner-accounts-new-user");
    const o = normalizeOwnerAccounts(raw, raw.owner);
    expect(o.accounts).toEqual([]);
    expect(o.owner).toBe(raw.owner);
  });

  it("maps a following account onto MirrorAccount with pnl, margin and positions", () => {
    const raw = fx("account-following");
    const a = normalizeAccount(raw);
    expect(a.account).toBe(raw.address);
    expect(a.deployed).toBe(true);
    expect(a.equityCNS).toBe(raw.equityCNS);
    expect(a.policy?.maxEntryDeviationBps).toBe(100);
    const book = raw.pnlByLeader[0];
    expect(a.pnl.unrealisedCNS).toBe(book.unrealizedPnlCNS);
    expect(a.pnl.realisedCNS).toBe(book.realizedPnlCNS);
    // The engine's leaderBook read-out (margin held for the leader, its budget, loss stop fired) is kept too.
    expect(a.pnl.byLeader[0]).toEqual({ leaderAccountId: 3, realisedCNS: book.realizedPnlCNS, unrealisedCNS: book.unrealizedPnlCNS, marginCNS: book.marginCNS, budgetCNS: book.budgetCNS, stopped: book.stopped });
    expect(a.positions).toHaveLength(1);
    const p = a.positions[0];
    expect(p).toMatchObject({ perpId: 1, side: "long", lotLNS: "2", entryPNS: "855428", marginCNS: "855428", upnlCNS: book.unrealizedPnlCNS, leaderAccountId: 3 });
    // 2 lots x mark at 5 lot / 1 price decimals = 2 x markPNS CNS notional (about 1.71 AUSD), about 2x on 0.855 margin.
    expect(p.notionalCNS).toBe(String(2n * BigInt(raw.positions[0].markPNS)));
    expect(p.leverageHdths).toBe(200);
    expect(a.marginCNS).toBe("855428");
    expect(BigInt(a.withdrawableCNS)).toBe(BigInt(raw.equityCNS) - 855428n);
    expect(a.depositCapCNS).toBe(config.depositCapCNS);
  });

  it("an emptied account has no positions and withdrawable equals equity", () => {
    const a = normalizeAccount(fx("account-withdrawn"));
    expect(a.positions).toEqual([]);
    expect(a.withdrawableCNS).toBe(a.equityCNS);
  });

  it("never throws on missing fields", () => {
    const a = normalizeAccount({});
    expect(a.pnl.unrealisedCNS).toBe("0");
    expect(a.positions).toEqual([]);
    expect(normalizeOwnerAccounts(null, "0x0000000000000000000000000000000000000001").accounts).toEqual([]);
    expect(normalizeFeedPage(undefined)).toEqual({ events: [], cursor: null });
  });
});

describe("feed", () => {
  const page = normalizeFeedPage(fx("feed-user-withdrawn"));
  const ev = (kind: string) => page.events.find((e) => e.kind === kind)!;

  it("maps {items, nextCursor} to {events, cursor} with string ids, ms timestamps and checksummed accounts", () => {
    expect(page.events.length).toBe(fx("feed-user-withdrawn").items.length);
    const e = page.events[0];
    expect(typeof e.id).toBe("string");
    expect(e.timestamp).toBeGreaterThan(1e12);
    expect(e.account).toBe(fx("account-following").address);
  });

  it("Mirrored: proof, builder fee, fill price and notional", () => {
    const m = ev("Mirrored");
    expect(m.proof?.fillPNS).toBe("855428");
    expect(m.pricePNS).toBe("855428");
    expect(copyFeeCNS(m)).toBeGreaterThan(0n);
    expect(m.notionalCNS).toBe("1710856");
    expect(m.latencyMs).toBe(fx("feed-user-withdrawn").items.find((i: any) => i.kind === "Mirrored").latencyMs);
  });

  it("Blocked: flat fields become blocked{}, and the entry-filter sentence reads the leader's entry", () => {
    const b = ev("Blocked");
    const rawB = fx("feed-user-withdrawn").items.find((i: any) => i.kind === "Blocked");
    expect(b.blocked).toEqual({ reason: "EntryTooFar", reasonCode: expect.any(Number), limit: "863982", actual: rawB.actual, rule: "Entry filter 1%" });
    expect(b.blocked!.reasonCode).toBeGreaterThan(0);
    const x = explainBlock(cfg, b);
    // The run moves the mark 3% above the leader's entry before the leader adds: about 3% past it.
    expect(x.sentence).toMatch(/^Price moved 3\.\d% past the leader's entry; your limit is 1%\. Not copied\.$/);
  });

  it("LeverageTooHigh from the demo follower's blocked trade carries the leader's leverage", () => {
    const b = normalizeFeedPage(fx("feed-demo-follower")).events.find((e) => e.kind === "Blocked")!;
    expect(b.blocked?.reason).toBe("LeverageTooHigh");
    expect(b.leverageHdths).toBe(Number(b.blocked!.actual));
    expect(explainBlock(cfg, b).sentence).toMatch(/Your max leverage is 5x/);
    expect(b.blocked?.rule).toBe("Max leverage 5x");
  });

  it("account events keep amounts and flags", () => {
    expect(ev("Deposited").amountCNS).toBe("20000000");
    expect(ev("Withdrawn").amountCNS).toBe(fx("feed-user-withdrawn").items.find((i: any) => i.kind === "Withdrawn").amount);
    expect(ev("ClosedAll").positionsClosed).toBe(1);
    expect(ev("Paused").paused).toBe(true);
  });
});

describe("demo", () => {
  it("idle state: follower account, limits, not busy", () => {
    const d = normalizeDemo(fx("demo-idle"), fx("account-following"));
    expect(d.busy).toBe(false);
    expect(d.leader.accountId).toBe(3);
    expect(d.follower.account).toBeTruthy();
    expect(d.limits).toEqual({ perIpPerHour: 50, dailyCap: 500, dailyRemaining: 500 });
  });

  it("running cycle: steps from the engine's step log", () => {
    const d = normalizeDemo(fx("demo-running"));
    expect(d.busy).toBe(true);
    const c = d.cycles[0];
    expect(c.status).toBe("running");
    expect(c.startedAt).toBeGreaterThan(1e12);
    expect(c.steps.map((s) => s.key)).toEqual(["leader_open", "copy_open", "leader_close", "copy_close"]);
    expect(c.steps[0]).toMatchObject({ status: "done", label: "Demo leader opens 1 lot BTC long at 2x" });
    expect(c.steps[1].status).toBe("done");
    expect(c.steps[1].txHash).toMatch(/^0x/);
    expect(d.follower.policy?.maxLeverageHdths).toBe(500);
  });

  it("finished trade and blocked cycles", () => {
    const d = normalizeDemo(fx("demo-after"));
    const trade = d.cycles.find((c) => c.kind === "trade")!;
    const blocked = d.cycles.find((c) => c.kind === "blocked")!;
    expect(trade.status).toBe("done");
    expect(trade.steps.every((s) => s.status === "done")).toBe(true);
    expect(blocked.steps.map((s) => [s.key, s.status])).toEqual([["leader_open", "done"], ["copy_blocked", "blocked"], ["leader_close", "done"]]);
    expect(blocked.steps[1].label).toBe("Copy blocked onchain: max leverage 5x");
  });

  it("app-shaped cycles pass through", () => {
    const c = { id: "x", kind: "trade", startedAt: 1, status: "done", steps: [{ key: "k", label: "l", status: "done" }] };
    expect(normalizeCycle(c)).toEqual(c);
  });
});

describe("stream", () => {
  const frames = (n: string) => fx(n).map((f: any) => normalizeStreamMessage({ event: f.event, data: JSON.stringify(f.data) }));

  it("feed frames unwrap the item; copy frames are dropped; commit ids are strings", () => {
    const out = frames("stream-user");
    const feed = out.filter((m: any) => m?.event === "feed").map((m: any) => JSON.parse(m.data));
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((e: any) => typeof e.id === "string" && e.kind && e.timestamp > 1e12)).toBe(true);
    expect(out.some((m: any) => m?.event === "copy")).toBe(false);
    const commit = out.find((m: any) => m?.event === "commit");
    expect(typeof JSON.parse(commit.data).id).toBe("string");
  });

  it("demo step events accumulate into whole cycles", () => {
    const cycles = frames("stream-demo").filter((m: any) => m?.event === "demo").map((m: any) => JSON.parse(m.data));
    const last = cycles.filter((c: any) => c.kind === "blocked").at(-1);
    expect(last.status).toBe("done");
    expect(last.steps.find((s: any) => s.key === "copy_blocked").status).toBe("blocked");
  });
});

describe("leaders, quote, markets", () => {
  it("leader list and profile", () => {
    const list = fx("leaders").leaders.map(normalizeLeaderSummary);
    expect(list.find((l: any) => l.accountId === 3)).toBeTruthy();
    const p = normalizeLeaderProfile(fx("leader-profile"));
    expect(Array.isArray(p.positions)).toBe(true);
    expect(typeof p.avgLeverage).toBe("number");
    expect(typeof p.stats.peakLeverage).toBe("number");
    expect(p.riskFlags.every((f) => typeof f.title === "string")).toBe(true);
  });

  it("quote: quotes/matchOrders become rows/orders", () => {
    const q = normalizeQuote(fx("quote-follow"), 3);
    expect(q.rows).toEqual([]);
    expect(q.orders).toEqual([]);
    expect(q.ordersEncoded).toMatch(/^0x/);
  });

  it("markets: {markets: []} becomes an array", () => {
    const m = normalizeMarkets(fx("markets"));
    expect(m.map((x) => x.symbol)).toEqual(["BTC", "ETH"]);
  });
});
