// Engine fields added for the screens (equity history, today's PnL, loss-stop flags, wallet, feed facts,
// leader stats, demo hold), against real engine responses captured on the localnet.
import { learnConfig, normalizeAccount, normalizeFeedEvent, normalizeFeedPage, normalizeOwnerAccounts } from "../src/lib/engineShape";
import { normalizeCycle, normalizeDemo, normalizeStreamMessage } from "../src/lib/engineDemo";
import { normalizeLeaderProfile } from "../src/lib/leaderShape";

jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const fx = (n: string) => require(`./fixtures/engine/${n}.json`);
learnConfig(fx("config"));

describe("accounts: equity history, today's PnL, loss stops, createdAt, wallet", () => {
  it("maps equityHistory {t s, equityCNS} to {t ms, v}, todayPnlCNS to pnl.todayCNS, flags to stops", () => {
    const raw = fx("account-following");
    const a = normalizeAccount(raw);
    expect(raw.equityHistory.length).toBeGreaterThanOrEqual(2);
    expect(a.equityHistory).toEqual(raw.equityHistory.map((p: any) => ({ t: p.t * 1000, v: Number(p.equityCNS) })));
    expect(raw.todayPnlCNS).toMatch(/^-?\d+$/);
    expect(a.pnl.todayCNS).toBe(raw.todayPnlCNS);
    expect(a.stops).toEqual({ dailyLossHit: raw.dailyLossHit, drawdownHit: raw.drawdownHit });
    expect(a.createdAt).toBe(raw.createdAt * 1000);
  });

  it("loss-stop flags from the engine light up stops; a missing today stays 0", () => {
    const a = normalizeAccount({ address: "0x0000000000000000000000000000000000000001", dailyLossHit: true, drawdownHit: false, todayPnlCNS: null, equityHistory: [] });
    expect(a.stops).toEqual({ dailyLossHit: true, drawdownHit: false });
    expect(a.pnl.todayCNS).toBe("0");
    expect(a.equityHistory).toEqual([]);
  });

  it("owner accounts: walletCNS becomes walletBalanceCNS", () => {
    const raw = fx("owner-accounts-following");
    expect(raw.walletCNS).toMatch(/^\d+$/);
    expect(normalizeOwnerAccounts(raw, raw.owner).walletBalanceCNS).toBe(raw.walletCNS);
    const fresh = fx("owner-accounts-new-user");
    expect(normalizeOwnerAccounts(fresh, fresh.owner).walletBalanceCNS).toBe(fresh.walletCNS);
    expect(normalizeOwnerAccounts({ owner: fresh.owner, walletCNS: null, accounts: [] }, fresh.owner).walletBalanceCNS).toBeUndefined();
  });
});

describe("feed: latency in blocks, leader block, realised PnL, leader order", () => {
  const demo = normalizeFeedPage(fx("feed-demo-follower")).events;

  it("Mirrored and Blocked carry leaderBlock and latencyBlocks = block - leaderBlock", () => {
    const copies = demo.filter((e) => e.kind === "Mirrored" || e.kind === "Blocked");
    expect(copies.length).toBeGreaterThanOrEqual(3);
    for (const e of copies) {
      expect(e.leaderBlock).toBeGreaterThan(0);
      expect(e.latencyBlocks).toBe(e.block - e.leaderBlock!);
    }
  });

  it("a copied close carries realisedPnlCNS; opens do not", () => {
    const close = demo.find((e) => e.kind === "Mirrored" && (e.orderType ?? 0) >= 2)!;
    expect(close.realisedPnlCNS).toMatch(/^-?\d+$/);
    const open = demo.find((e) => e.kind === "Mirrored" && (e.orderType ?? 0) < 2)!;
    expect(open.realisedPnlCNS).toBeUndefined();
  });

  it("Blocked carries the leader's own lots and leverage from the fill that triggered it", () => {
    const b = demo.find((e) => e.kind === "Blocked")!;
    expect(b.leaderLotLNS).toBe("1");
    expect(b.leaderLeverageHdths).toBe(1000);
    const u = normalizeFeedPage(fx("feed-user")).events.find((e) => e.kind === "Blocked")!;
    expect(u.leaderLotLNS).toBe("10");
    expect(u.leaderLeverageHdths).toBe(200);
  });

  it("nulls from the engine become undefined", () => {
    const e = normalizeFeedEvent({ id: 1, kind: "Mirrored", leaderBlock: null, latencyBlocks: null, realisedPnlCNS: null, leaderLotLNS: null, leaderLeverageHdths: null });
    expect([e.leaderBlock, e.latencyBlocks, e.realisedPnlCNS, e.leaderLotLNS, e.leaderLeverageHdths]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("leaders", () => {
  it("never lists the MirrorAccounts' Perpl accounts", () => {
    const ids = fx("leaders").leaders.map((l: any) => l.accountId);
    const mirrorIds = [fx("account-following").perplAccountId, fx("demo-idle").follower.perplAccountId];
    expect(mirrorIds.every((id: number) => id > 0 && !ids.includes(id))).toBe(true);
    expect(fx("leaders").leaders.find((l: any) => l.accountId === 3).teamRun).toBe(true);
  });

  it("profile stats: profitFactor, largestLossCNS, avgHoldSec", () => {
    const raw = fx("leader-profile");
    const p = normalizeLeaderProfile(raw);
    expect(p.stats.profitFactor).toBe(raw.stats.profitFactor ?? 0);
    expect(p.stats.largestLossUsd).toBe(Number(raw.stats.largestLossCNS) / 1e6);
    expect(p.stats.avgHoldMinutes).toBe(Math.round(raw.stats.avgHoldSec / 60));
    const q = normalizeLeaderProfile({ accountId: 9, stats: { profitFactor: 1.8, largestLossCNS: "-2500000", avgHoldSec: 5400 } });
    expect(q.stats).toMatchObject({ profitFactor: 1.8, largestLossUsd: -2.5, avgHoldMinutes: 90 });
  });
});

describe("demo cycles: holdMs", () => {
  it("cycles carry holdMs and the close step says after about N s", () => {
    const d = normalizeDemo(fx("demo-after"));
    const trade = d.cycles.find((c) => c.kind === "trade")!;
    const blocked = d.cycles.find((c) => c.kind === "blocked")!;
    expect(trade.holdMs).toBe(5000);
    expect(trade.steps.find((s) => s.key === "leader_close")!.label).toBe("Demo leader closes after about 5 s");
    expect(blocked.holdMs).toBe(2000);
    expect(blocked.steps.find((s) => s.key === "leader_close")!.label).toBe("Demo leader closes again after about 2 s");
  });

  it("live step frames carry it from the opening step", () => {
    const cycles = fx("stream-demo")
      .map((f: any) => normalizeStreamMessage({ event: f.event, data: JSON.stringify(f.data) }))
      .filter((m: any) => m?.event === "demo")
      .map((m: any) => JSON.parse(m.data));
    expect(cycles.find((c: any) => c.kind === "trade").holdMs).toBe(5000);
  });

  it("no holdMs: the plain label", () => {
    const c = normalizeCycle({ id: "x", kind: "trade", status: "running", steps: [{ step: "leader_opening", lots: "1", perpId: 1 }] });
    expect(c.holdMs).toBeUndefined();
    expect(c.steps.find((s) => s.key === "leader_close")!.label).toBe("Demo leader closes");
  });
});
