// The web share cards (web/lib/cards/model.ts) shaped from the captured engine fixtures: every number on a card
// comes from the engine, team-run and simulation are labelled, and missing data is left out rather than filled in.
import { blockedModel, copyDeviationBps, ctxFromConfig, followerModel, leaderModel, simModel, unavailableModel } from "../../web/lib/cards/model";
import config from "./fixtures/engine/config.json";
import leader from "./fixtures/engine/leader-profile.json";
import account from "./fixtures/engine/account-following.json";
import feedUser from "./fixtures/engine/feed-user.json";
import feedDemo from "./fixtures/engine/feed-demo-follower.json";
import backtest from "./fixtures/engine/backtest.json";

const ctx = (amounts = true, landing = "https://mirror.0xo.in/c/x/1") => ctxFromConfig(config, landing, amounts);
const MINUS = "−";

describe("share card models", () => {
  test("leader: engine stats only, team-run labelled, fills linked to MonadVision", () => {
    const m = leaderModel("3", leader, ctx());
    expect(m.ok).toBe(true);
    expect(m.teamRun).toMatch(/Team-run/);
    expect(m.fine[0]).toMatch(/Run by the Mirror team/);
    expect(m.big?.text).toBe("+0.0%");
    expect(m.stats?.map((s) => s.k)).toEqual(["Max drawdown", "Win rate", "Trades", "Followers on Mirror"]);
    expect(m.stats?.find((s) => s.k === "Trades")?.v).toBe("4");
    expect(m.links.filter((l) => l.hash)).toHaveLength(leader.recentTrades.length);
    expect(m.links[1].href).toBe(`https://monadvision.com/tx/${leader.recentTrades[0].txHash}`);
    expect(m.proof.url).toBe("https://mirror.0xo.in/c/x/1");
  });

  test("leader: a fractional win rate (engine) and a percent one (older shape) both read as percent", () => {
    expect(leaderModel("1", { ...leader, teamRun: false, winRate: 0.61 }, ctx()).stats?.find((s) => s.k === "Win rate")?.v).toBe("61%");
    expect(leaderModel("1", { ...leader, teamRun: false, winRate: 61 }, ctx()).stats?.find((s) => s.k === "Win rate")?.v).toBe("61%");
  });

  test("leader: missing stats are left out, not zero", () => {
    const m = leaderModel("1", { address: leader.address, teamRun: false }, ctx());
    expect(m.big).toBeUndefined();
    expect(m.stats).toEqual([]);
    expect(m.chart).toBeUndefined();
  });

  test("follower: PnL from equity and deposits, copies and blocks from the feed, builder fee shown", () => {
    const m = followerModel(account, feedUser.items, true, ctx());
    expect(m.big).toEqual({ text: `${MINUS}0.000152`, unit: "AUSD", tone: "neg" });
    expect(m.sub).toContain("20.00 AUSD deposited");
    expect(m.sub).toContain("builder fees 0.000343 AUSD");
    const stats = Object.fromEntries((m.stats ?? []).map((s) => [s.k, s.v]));
    expect(stats.Copies).toBe("1");
    expect(stats["Blocked by my rules"]).toBe("1");
    expect(stats["Median copy time"]).toBe("0.40 s");
    expect(stats["Median deviation"]).toBe("+0.0 bps");
    expect(m.links.some((l) => /builder fee/.test(l.note ?? ""))).toBe(true);
  });

  test("follower: amounts off shows percentages and the builder fee rate; partial feed marks counts with +", () => {
    const m = followerModel(account, feedUser.items, false, ctx(false));
    expect(m.big?.unit).toBeUndefined();
    expect(m.big?.text).toMatch(/%$/);
    expect(m.sub).toContain("builder fee 0.02% of opens");
    expect(m.stats?.[0].v).toBe("1+");
  });

  test("blocked (team-run demo): its rule, leverage numbers from the event, MonadVision proof", () => {
    const item = feedDemo.items.find((i) => i.kind === "Blocked")!;
    const m = blockedModel(item, { address: item.account, teamRun: true }, leader.address, ctx());
    expect(m.teamRun).toBe("Team-run demo account");
    expect(m.blocked?.title).toBe("Blocked by its rule");
    expect(m.blocked?.sentence.filter((s) => s.b).map((s) => s.t)).toEqual(["10x", "5x"]);
    expect(m.blocked?.cmp.map((s) => s.v)).toEqual(["10x", "max 5x", "135"]);
    expect(m.blocked?.chips).toEqual([
      { label: "Active", ok: true },
      { label: "Market", ok: true },
      { label: "Leverage 10x > 5x", ok: false },
    ]);
    expect(m.proof.url).toBe(`https://monadvision.com/tx/${item.txHash}`);
    expect(m.links.map((l) => l.label)).toContain("Leader's fill on Perpl");
  });

  test("blocked (own account): my rule, my funds not touched", () => {
    const item = feedUser.items.find((i) => i.kind === "Blocked")!;
    const m = blockedModel(item, account, null, ctx());
    expect(m.teamRun).toBeUndefined();
    expect(m.blocked?.title).toMatch(/^Blocked by my /);
    expect(m.fine[0]).toMatch(/My funds were not touched/);
  });

  test("blocked: entry filter without the leader's entry shows the copy price and the bound from the event", () => {
    const item = { ...feedUser.items.find((i) => i.kind === "Blocked")!, reason: "EntryTooFar", limit: "870000", actual: "880000" };
    const m = blockedModel(item, account, null, ctx());
    expect(m.blocked?.title).toBe("Blocked by my entry filter");
    expect(m.blocked?.cmp.slice(0, 2)).toEqual([
      { k: "Price for copy", v: "88,000.0" },
      { k: "My bound", v: "87,000.0" },
    ]);
  });

  test("simulation: labelled, engine PnL and fees incl. builder fee, QR to the leader page", () => {
    const m = simModel("3", backtest, leader, ctx(true, "https://mirror.0xo.in/c/sim/3?d=1&b=1"));
    expect(m.simulation).toBe("Simulation");
    expect(m.teamRun).toMatch(/Team-run/);
    expect(m.big?.text).toBe(`${MINUS}0.002479`);
    expect(m.sub).toBe("on a 20.00 AUSD deposit · 2 copied · 1 blocked by my rules");
    expect(m.stats?.find((s) => s.k === "Fees")?.v).toBe("0.000769 AUSD incl. builder fee 0.000172 AUSD");
    expect(m.proof.url).toBe("https://mirror.0xo.in/c/leader/3");
    expect(m.fine[0]).toMatch(/^Simulation, not a promise/);
    expect(m.chart?.from).toBe("Sep 30");
  });

  test("not available: no numbers at all", () => {
    const m = unavailableModel("follower", "Mirror's server didn't answer.", ctx());
    expect(m.ok).toBe(false);
    expect(m.big ?? m.stats ?? m.chart ?? m.blocked).toBeUndefined();
    expect(m.message).toMatch(/didn't answer/);
  });

  test("deviation: positive is the worse price for the follower, both sides", () => {
    expect(copyDeviationBps({ leaderFillPNS: "10000", fillPNS: "10010" }, 0)).toBe(10);
    expect(copyDeviationBps({ leaderFillPNS: "10000", fillPNS: "10010" }, 1)).toBe(-10);
    expect(copyDeviationBps({ leaderFillPNS: "10000", fillPNS: "0" }, 2)).toBeNull();
  });
});
