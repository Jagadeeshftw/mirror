import { DEFAULT_FORMAT, defaultOptions, hasAmounts, imageUrl, landingUrl, shareMethod, shareTitle, simParams, type ShareTarget } from "../src/lib/share";
import type { BacktestRequest } from "../src/lib/engineTypes";
// The web card reads the simulation limits back with this parser: the two must agree.
import { parseSimParams } from "../../web/lib/cards/sim-params";

const BASE = "https://mirror.0xo.in";
const ACCOUNT = "0xC4668F465E7BD81eba43D664EFb1a23d59a534Df" as const;
const TX = "0x983c438a29adf31e1c916188dd9068a6503aeac10683e267b05e6686fe67e098" as const;
const REQ: BacktestRequest = {
  ratioBps: 1000,
  maxLeverageHdths: 500,
  maxSlippageBps: 50,
  markets: [
    { perpId: 1, maxNotionalCNS: "20000000" },
    { perpId: 31, maxNotionalCNS: "5000000" },
  ],
  maxEntryDeviationBps: 100,
  budgetCNS: "20000000",
  lossStopBps: 1500,
  dailyLossBps: 1000,
  drawdownBps: 2000,
  flattenOnStop: true,
  depositCNS: "20000000",
  period: 30,
};

describe("share links", () => {
  test("leader: wide by default, no query", () => {
    const t: ShareTarget = { kind: "leader", leaderId: 1043 };
    expect(landingUrl(t, defaultOptions("leader"), BASE)).toBe("https://mirror.0xo.in/c/leader/1043");
    expect(imageUrl(t, defaultOptions("leader"), "dark", BASE)).toBe("https://mirror.0xo.in/c/leader/1043/image?t=dark");
  });

  test("square leader card carries f=sq; amounts=0 is dropped where it changes nothing", () => {
    const t: ShareTarget = { kind: "leader", leaderId: 7 };
    expect(landingUrl(t, { format: "sq", amounts: false }, BASE)).toBe("https://mirror.0xo.in/c/leader/7?f=sq");
  });

  test("follower: amounts off adds amounts=0", () => {
    const t: ShareTarget = { kind: "follower", account: ACCOUNT };
    expect(landingUrl(t, { format: "og", amounts: false }, BASE)).toBe(`${BASE}/c/follower/${ACCOUNT}?amounts=0`);
    expect(hasAmounts("follower")).toBe(true);
    expect(hasAmounts("blocked")).toBe(false);
  });

  test("blocked: the account rides along so the card can find the event; square by default", () => {
    const t: ShareTarget = { kind: "blocked", txHash: TX, account: ACCOUNT, teamRun: true };
    expect(DEFAULT_FORMAT.blocked).toBe("sq");
    expect(landingUrl(t, defaultOptions("blocked"), BASE)).toBe(`${BASE}/c/blocked/${TX}?a=${ACCOUNT}`);
    expect(imageUrl(t, { format: "og", amounts: true }, "light", BASE)).toBe(`${BASE}/c/blocked/${TX}/image?a=${ACCOUNT}&f=og&t=light`);
    expect(shareTitle(t)).toMatch(/team-run/);
    expect(shareTitle({ ...t, teamRun: false })).toBe("Blocked by my rule");
  });

  test("simulation: limits round-trip through the web card's parser", () => {
    const t: ShareTarget = { kind: "sim", leaderId: 3, request: REQ };
    const url = new URL(landingUrl(t, defaultOptions("sim"), BASE));
    expect(url.pathname).toBe("/c/sim/3");
    expect(url.searchParams.get("m")).toBe("1:20000000,31:5000000");
    expect(parseSimParams(url.searchParams)).toEqual(REQ);
    expect(shareTitle(t)).toBe("Simulation");
  });

  test("simulation: zero rules are left out and still parse to zero", () => {
    const lean = { ...REQ, maxEntryDeviationBps: 0, lossStopBps: 0, dailyLossBps: 0, drawdownBps: 0, flattenOnStop: false, period: 7 as const };
    const keys = simParams(lean).map(([k]) => k);
    expect(keys).toEqual(["d", "b", "r", "l", "s", "m", "p"]);
    expect(parseSimParams(new URLSearchParams(simParams(lean)))).toEqual(lean);
  });

  test("web parser refuses a link without limits", () => {
    expect(parseSimParams(new URLSearchParams("d=1000000"))).toBeNull();
    expect(parseSimParams(new URLSearchParams("d=1&b=1&r=1&l=100&m=1:x"))).toBeNull();
  });

  test("share method: system sheet on Android, Web Share API in browsers that have it, else copy link", () => {
    expect(shareMethod("android", false)).toBe("native");
    expect(shareMethod("web", true)).toBe("webshare");
    expect(shareMethod("web", false)).toBe("copy");
  });
});
