jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
import { ApiError } from "../src/lib/api";
import {
  DOWN_AFTER_MS,
  FAST_FAIL_MS,
  SLOW_AFTER_MS,
  backendPhase,
  balanceLine,
  classifyError,
  demoDownLine,
  failTitle,
  feedBanners,
  leadersErrorCopy,
  mirrorDownBody,
  noCopiesLine,
  relayGate,
  runNote,
} from "../src/lib/conn";

describe("classifyError", () => {
  it("attributes API failures to Mirror", () => {
    expect(classifyError(new ApiError(0, "network", "x"))).toEqual({ source: "mirror", kind: "network", status: 0 });
    expect(classifyError(new ApiError(0, "timeout", "x")).kind).toBe("timeout");
    expect(classifyError(new ApiError(503, "history unavailable", "x")).kind).toBe("unavailable");
    expect(classifyError(new ApiError(429, "rate_limited", "x")).kind).toBe("rate");
    expect(classifyError(new ApiError(500, "internal", "x"))).toEqual({ source: "mirror", kind: "http", status: 500 });
  });
  it("attributes viem RPC failures to Monad", () => {
    expect(classifyError(Object.assign(new Error("HTTP request failed."), { name: "HttpRequestError" })).source).toBe("monad");
    expect(classifyError(Object.assign(new Error("The request took too long to respond."), { name: "TimeoutError" }))).toEqual({ source: "monad", kind: "timeout" });
  });
  it("leaves other errors alone", () => {
    expect(classifyError(new Error("boom")).source).toBe("other");
  });
  it("names each side consistently", () => {
    expect(failTitle("mirror")).toBe("Can't reach Mirror's service");
    expect(failTitle("monad")).toBe("Can't reach Monad");
  });
});

describe("backendPhase", () => {
  const since = 1_000_000;
  it("is ok once data arrives", () => {
    expect(backendPhase({ hasData: true, failed: false, since, now: since + 60_000 })).toBe("ok");
  });
  it("fails fast: connecting for 3 s, slow until 8 s, then down (never ~30 s of Loading)", () => {
    expect(SLOW_AFTER_MS).toBe(3_000);
    expect(DOWN_AFTER_MS).toBeLessThanOrEqual(8_000);
    expect(FAST_FAIL_MS).toBeLessThan(DOWN_AFTER_MS);
    expect(backendPhase({ hasData: false, failed: false, since, now: since + 100 })).toBe("connecting");
    expect(backendPhase({ hasData: false, failed: false, since, now: since + SLOW_AFTER_MS })).toBe("slow");
    expect(backendPhase({ hasData: false, failed: false, since, now: since + DOWN_AFTER_MS - 1 })).toBe("slow");
    expect(backendPhase({ hasData: false, failed: false, since, now: since + DOWN_AFTER_MS })).toBe("down");
  });
  it("is down right away on a definite failure, even with stale data", () => {
    expect(backendPhase({ hasData: false, failed: true, since, now: since + 10 })).toBe("down");
    expect(backendPhase({ hasData: true, failed: true, since, now: since + 10 })).toBe("down");
  });
});

import { ausdUnit, normalizeConfig } from "../src/lib/config";

describe("normalizeConfig", () => {
  it("maps the engine's /v1/config shape", () => {
    const c = normalizeConfig({
      chainId: 1337,
      rpc: "http://127.0.0.1:8545",
      explorerTx: "x/",
      explorerAddress: "y/",
      contracts: { factory: "0xf", keeperRegistry: "0xk", perplExchange: "0xp", collateral: "0xc", deployBlock: 12 },
      collateralDecimals: 6,
      depositCapCNS: "25000000",
      perplMinAccountOpenCNS: "100000000",
      teamRun: { addresses: ["0xa", "0xb"], demoLeaderAccountId: 7, demoFollowerAccount: "0xb" },
      markets: [{ perpId: 16, symbol: "BTC", lotDecimals: 5, priceDecimals: 1 }],
    });
    expect(c.chainId).toBe(1337);
    expect(c.minAccountOpenCNS).toBe("100000000");
    expect(c.contracts.implementation).toBeNull();
    expect(c.contracts.deployBlock).toBe(12);
    expect(c.teamRun).toEqual({ addresses: ["0xa", "0xb"], demoLeaderAddress: null, demoLeaderAccountId: 7, demoFollowerAccount: "0xb" });
    expect(normalizeConfig(c).minAccountOpenCNS).toBe("100000000");
  });
  it("labels testnet AUSD", () => {
    expect(ausdUnit(10143)).toBe("test AUSD");
    expect(ausdUnit(143)).toBe("AUSD");
  });
});

const viemErr = () => Object.assign(new Error("HTTP request failed."), { name: "HttpRequestError" });

describe("feedBanners", () => {
  it("backend down: Mirror's service, not Monad", () => {
    expect(feedBanners({ feedError: new ApiError(0, "network", "x"), rpcError: false })).toEqual(["mirror"]);
  });
  it("RPC down only: Monad", () => {
    expect(feedBanners({ feedError: null, rpcError: true })).toEqual(["monad"]);
  });
  it("both down: both, each named once", () => {
    expect(feedBanners({ feedError: new ApiError(0, "timeout", "x"), rpcError: true })).toEqual(["mirror", "monad"]);
    expect(feedBanners({ feedError: viemErr(), rpcError: true })).toEqual(["monad"]);
  });
  it("nothing down: no banner", () => {
    expect(feedBanners({ feedError: null, rpcError: false })).toEqual([]);
  });
});

describe("engine-down copy", () => {
  it("watch mode Run note says why, and that copies come from Monad", () => {
    expect(runNote("testnet")).toBe("Mirror's testnet service isn't live yet; these copies are read straight from Monad.");
    expect(runNote("mainnet")).toMatch(/isn't reachable.*read straight from Monad/);
  });
  it("no copies in the scanned window is said plainly", () => {
    expect(noCopiesLine(19)).toBe("No copies in the last 19 minutes");
    expect(noCopiesLine(1)).toBe("No copies in the last 1 minute");
    expect(noCopiesLine(180)).toBe("No copies in the last 3 hours");
    expect(noCopiesLine(null)).toBe("No copies in the last few minutes");
  });
  it("leaders: a refused or 5xx backend is 'not live yet', a 4xx is a plain error", () => {
    const t = leadersErrorCopy(new ApiError(0, "network", "x"), "testnet");
    expect(t).toMatchObject({ down: true, title: "Leaders aren't live yet" });
    expect(t.body).toMatch(/testnet service isn't live yet/);
    expect(leadersErrorCopy(new ApiError(502, "http_502", "x"), "mainnet")).toMatchObject({ down: true, title: "Can't reach Mirror's service" });
    expect(leadersErrorCopy(new ApiError(400, "bad", "x"), "testnet")).toMatchObject({ down: false, title: "Can't load leaders" });
  });
  it("the demo card explains why it can't run", () => {
    expect(demoDownLine("testnet")).toMatch(/^Mirror's testnet service isn't live yet, so a demo can't be started\./);
  });
  it("banner bodies name the service and what is still read from Monad", () => {
    expect(mirrorDownBody("account", "testnet")).toMatch(/testnet service isn't live yet.*read straight from Monad/);
    expect(mirrorDownBody("feed", "mainnet")).toMatch(/read straight from Monad/);
  });
});

describe("balanceLine (Home with Mirror down)", () => {
  it("reading, failed, wallet only, and wallet plus follow accounts", () => {
    expect(balanceLine({ walletCNS: null })).toBe("Reading your balance from Monad");
    expect(balanceLine({ walletCNS: null, walletError: true })).toMatch(/Can't reach Monad/);
    expect(balanceLine({ walletCNS: 100_000_000n, down: true })).toBe("In your wallet, read from Monad. Nothing deposited yet.");
    expect(balanceLine({ walletCNS: 5_000_000n, followsCNS: 20_000_000n, down: true })).toBe("Read from Monad: 5.00 in your wallet, 20.00 in your follow accounts.");
    expect(balanceLine({ walletCNS: 0n })).toBe("Nothing deposited yet. Watch real copies land below.");
  });
});

describe("relayGate", () => {
  it("ready once Mirror's service answers", () => {
    expect(relayGate({ ok: true, failed: false, checking: false })).toMatchObject({ ready: true });
  });
  it("down: not live yet, nothing signed", () => {
    const g = relayGate({ ok: false, failed: true, checking: false }, "testnet");
    expect(g.ready).toBe(false);
    expect(g.title).toBe("Not live yet");
    expect(g.body).toMatch(/^Mirror's testnet service isn't live yet, so this can't be sent\. Nothing was signed/);
    expect(relayGate({ ok: false, failed: true, checking: false }, "mainnet").title).toBe("Can't reach Mirror's service");
  });
  it("still checking: not ready, not blocked", () => {
    expect(relayGate({ ok: false, failed: false, checking: true })).toMatchObject({ ready: false, checking: true });
  });
});
