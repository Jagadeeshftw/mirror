// Typed client for the Mirror backend (docs/api.md). The app talks only to this API and to
// Monad RPC for reads.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import type {
  Address,
  AppConfig,
  DemoState,
  FeedPage,
  FollowQuote,
  HealthState,
  Hex,
  LeaderProfile,
  LeaderSummary,
  MarketState,
  MirrorAccount,
  OwnerAccounts,
  Policy,
  PushEnvelope,
  RelayResult,
} from "./types";

export const DEFAULT_API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE || Constants.expoConfig?.extra?.apiBase || "https://api.mirror.0xo.in";
const OVERRIDE_KEY = "mirror.apiBase.override";
let apiBase = DEFAULT_API_BASE;

export function getApiBase(): string {
  return apiBase;
}
export async function loadApiBaseOverride(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(OVERRIDE_KEY);
    if (v) apiBase = v;
  } catch {}
  return apiBase;
}
export async function setApiBaseOverride(v: string | null): Promise<void> {
  apiBase = v || DEFAULT_API_BASE;
  if (v) await AsyncStorage.setItem(OVERRIDE_KEY, v);
  else await AsyncStorage.removeItem(OVERRIDE_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterSec?: number;
  revertReason?: string;
  body?: unknown;
  constructor(status: number, code: string, message: string, extra: Partial<ApiError> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
  get isRateLimit() {
    return this.status === 429;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

async function request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(apiBase + path, {
      method,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, "network", "Can't reach the Mirror service", { body: String(e) });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after") ?? json?.retryAfterSec ?? NaN);
    throw new ApiError(res.status, json?.error ?? `http_${res.status}`, json?.message ?? `Request failed (${res.status})`, {
      retryAfterSec: Number.isFinite(retry) ? retry : undefined,
      revertReason: json?.revertReason,
      body: json,
    });
  }
  return json as T;
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};

export type LeaderWindow = "7d" | "30d" | "90d";
export type LeaderSort = "score" | "pnl" | "drawdown";

export const api = {
  health: () => request<HealthState>("GET", "/v1/health"),
  config: () => request<AppConfig>("GET", "/v1/config"),
  markets: () => request<MarketState[]>("GET", "/v1/markets"),
  leaders: (window: LeaderWindow = "30d", sort: LeaderSort = "score", market?: string) =>
    request<LeaderSummary[] | { leaders: LeaderSummary[] }>("GET", `/v1/leaders${q({ window, sort, market })}`).then((r) =>
      Array.isArray(r) ? r : r.leaders,
    ),
  leader: (accountId: number, window: LeaderWindow = "30d") =>
    request<LeaderProfile>("GET", `/v1/leaders/${accountId}${q({ window })}`),
  ownerAccounts: (owner: Address) =>
    request<OwnerAccounts | MirrorAccount[]>("GET", `/v1/owners/${owner}/accounts`).then((r) =>
      Array.isArray(r) ? ({ owner, accounts: r } as OwnerAccounts) : r,
    ),
  account: (account: Address) => request<MirrorAccount>("GET", `/v1/accounts/${account}`),
  feed: (account: Address, cursor?: string | null) =>
    request<FeedPage>("GET", `/v1/accounts/${account}/feed${q({ cursor: cursor ?? undefined })}`),
  stats: () => request<Record<string, unknown>>("GET", "/v1/stats"),
  demo: () => request<DemoState>("GET", "/v1/demo"),

  quoteFollow: (body: { owner: Address; leaderAccountId: number; policy: Policy; account?: Address }) =>
    request<FollowQuote>("POST", "/v1/quote/follow", body),

  relayCreate: (body: { owner: Address; salt: Hex }) => request<RelayResult & { account?: Address }>("POST", "/v1/relay/create", body, 60000),
  relayDeposit: (
    body:
      | { account: Address; mode: "permit"; amount: string; deadline: string; v: number; r: Hex; s: Hex }
      | { account: Address; mode: "auth"; amount: string; validAfter: string; validBefore: string; nonce: Hex; v: number; r: Hex; s: Hex },
  ) => request<RelayResult>("POST", "/v1/relay/deposit", body, 60000),
  relayExecute: (body: { account: Address; action: { kind: number; data: Hex; nonce: string; deadline: string }; signature: Hex }) =>
    request<RelayResult>("POST", "/v1/relay/execute", body, 60000),
  relayTransfer: (body: {
    from: Address;
    to: Address;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
    v: number;
    r: Hex;
    s: Hex;
  }) => request<RelayResult>("POST", "/v1/relay/transfer", body, 60000),

  demoTrade: () => request<{ cycleId: string }>("POST", "/v1/demo/trade", {}),
  demoBlocked: () => request<{ cycleId: string }>("POST", "/v1/demo/blocked", {}),

  pushRegister: (body: { owner: Address; expoPushToken: string; notifyPublicKey: string }) =>
    request<{ ok: boolean }>("POST", "/v1/push/register", body),

  // App-side extension (documented in docs/app.md): private follow notes, sealed on device.
  putNote: (body: { owner: Address; account: Address; note: PushEnvelope }) => request<{ ok: boolean }>("PUT", "/v1/notes", body),
  notes: (owner: Address) => request<{ notes: { account: Address; note: PushEnvelope }[] }>("GET", `/v1/notes/${owner}`),
};

export function streamUrl(account: string): string {
  return `${apiBase}/v1/stream?account=${encodeURIComponent(account)}`;
}
