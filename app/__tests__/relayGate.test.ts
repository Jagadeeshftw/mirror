// Actions that need the relayer check Mirror's service before any passkey prompt.
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: {} } }));
const mockWithSigner = jest.fn();
jest.mock("../src/lib/wallet", () => ({ withSigner: (...a: unknown[]) => mockWithSigner(...a) }));
const mockHealth = jest.fn();
const mockRelayDeposit = jest.fn();
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: { health: (t: number) => mockHealth(t), relayDeposit: (b: unknown) => mockRelayDeposit(b) } };
});
import { ApiError } from "../src/lib/api";
import { deposit, ensureRelay, executeActions, sendAusd } from "../src/lib/actions";
import { FAST_FAIL_MS } from "../src/lib/conn";
import { bundledConfig } from "../src/lib/network";

const cfg = bundledConfig("testnet", null);
const OWNER = "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" as const;
const ACCT = "0x634BFE3c2E4c483e8F7F4f3F3b6B2B7383A74896" as const;

beforeEach(() => {
  mockWithSigner.mockReset();
  mockHealth.mockReset();
  mockRelayDeposit.mockReset();
});

describe("ensureRelay", () => {
  it("passes when Mirror's service answers (fast timeout)", async () => {
    mockHealth.mockResolvedValue({ ok: true });
    await expect(ensureRelay()).resolves.toBeUndefined();
    expect(mockHealth).toHaveBeenCalledWith(FAST_FAIL_MS);
  });
  it("refused or timed out: relay_unavailable with the 'not live yet' text", async () => {
    mockHealth.mockRejectedValue(new ApiError(0, "network", "Can't reach Mirror"));
    const e = await ensureRelay().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("relay_unavailable");
    expect(e.message).toMatch(/Nothing was signed/);
  });
  it("a 5xx is down too; a 4xx answered (the relay call reports it)", async () => {
    mockHealth.mockRejectedValueOnce(new ApiError(502, "http_502", "bad gateway"));
    await expect(ensureRelay()).rejects.toMatchObject({ code: "relay_unavailable" });
    mockHealth.mockRejectedValueOnce(new ApiError(404, "http_404", "nope"));
    await expect(ensureRelay()).resolves.toBeUndefined();
  });
});

describe("no passkey prompt for something that can't be sent", () => {
  beforeEach(() => mockHealth.mockRejectedValue(new ApiError(0, "network", "x")));
  it("deposit", async () => {
    await expect(deposit(cfg, OWNER, ACCT, 1_000_000n, () => {})).rejects.toMatchObject({ code: "relay_unavailable" });
    expect(mockWithSigner).not.toHaveBeenCalled();
    expect(mockRelayDeposit).not.toHaveBeenCalled();
  });
  it("owner actions (follow edits, re-arm, stops)", async () => {
    await expect(executeActions(cfg, [], () => {})).rejects.toMatchObject({ code: "relay_unavailable" });
    expect(mockWithSigner).not.toHaveBeenCalled();
  });
  it("send", async () => {
    await expect(sendAusd(cfg, OWNER, ACCT, 1n, () => {})).rejects.toMatchObject({ code: "relay_unavailable" });
    expect(mockWithSigner).not.toHaveBeenCalled();
  });
});
