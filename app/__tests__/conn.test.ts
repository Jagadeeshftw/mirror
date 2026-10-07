jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
import { ApiError } from "../src/lib/api";
import { DOWN_AFTER_MS, SLOW_AFTER_MS, backendPhase, classifyError, failTitle } from "../src/lib/conn";

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
    expect(failTitle("mirror")).toBe("Can't reach Mirror");
    expect(failTitle("monad")).toBe("Can't reach Monad");
  });
});

describe("backendPhase", () => {
  const since = 1_000_000;
  it("is ok once data arrives", () => {
    expect(backendPhase({ hasData: true, failed: false, since, now: since + 60_000 })).toBe("ok");
  });
  it("connects for 5 s, is slow until 30 s, then down", () => {
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
