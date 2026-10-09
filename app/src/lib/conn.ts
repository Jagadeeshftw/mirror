// Which side failed, and how long we have waited. "Can't reach Mirror's service" is only for our backend
// (API errors); "Can't reach Monad" is only for the RPC (viem errors). Never mixed up.
import { ApiError } from "./api";
import { ausd } from "./format";
import { NETWORK, serviceDownLine, type NetworkName } from "./network";

export type FailSource = "mirror" | "monad" | "other";
export type FailKind = "network" | "timeout" | "http" | "rate" | "unavailable" | "unknown";

export function classifyError(e: unknown): { source: FailSource; kind: FailKind; status?: number } {
  if (e instanceof ApiError || (e as any)?.name === "ApiError") {
    const status = (e as ApiError).status;
    if (status === 0) return { source: "mirror", kind: (e as ApiError).code === "timeout" ? "timeout" : "network", status };
    if (status === 429) return { source: "mirror", kind: "rate", status };
    if (status === 503) return { source: "mirror", kind: "unavailable", status };
    if (status >= 500) return { source: "mirror", kind: "http", status };
    return { source: "mirror", kind: "http", status };
  }
  const name = String((e as any)?.name ?? "");
  const msg = String((e as any)?.shortMessage ?? (e as any)?.message ?? "");
  if (/TimeoutError/.test(name) || /timed out|took too long/i.test(msg)) return { source: "monad", kind: "timeout" };
  if (/HttpRequestError|RpcRequestError|RpcError|WebSocketRequestError|ContractFunctionExecutionError|CallExecutionError/.test(name) || /HTTP request failed|fetch failed/i.test(msg)) {
    return { source: "monad", kind: "network" };
  }
  return { source: "other", kind: "unknown" };
}

export function failTitle(source: FailSource): string {
  return source === "monad" ? "Can't reach Monad" : source === "mirror" ? "Can't reach Mirror's service" : "Something went wrong";
}

export type BackendPhase = "ok" | "connecting" | "slow" | "down";
export const SLOW_AFTER_MS = 3_000;
export const DOWN_AFTER_MS = 8_000;
/** Reads the first screens wait on (owner accounts, feeds, health) give up after this long. */
export const FAST_FAIL_MS = 6_000;

/**
 * Phase of the first answer from the Mirror backend.
 * - data and no failure: ok
 * - a definite failure (refused, 5xx, timeout): down, even with stale data (shown with a banner)
 * - no answer yet: connecting for 3 s, then slow, then down after 8 s (never a long "Loading")
 */
export function backendPhase(s: { hasData: boolean; failed: boolean; since: number; now: number }): BackendPhase {
  if (s.failed) return "down";
  if (s.hasData) return "ok";
  const waited = s.now - s.since;
  if (waited < SLOW_AFTER_MS) return "connecting";
  if (waited < DOWN_AFTER_MS) return "slow";
  return "down";
}

/** Body of the "Can't reach Mirror's service" banner, by what the screen still shows from Monad. */
export function mirrorDownBody(what: "account" | "funded" | "feed" | "leaders" | "positions", network: NetworkName = NETWORK): string {
  const lead = `${serviceDownLine(network)}.`;
  switch (what) {
    case "account":
      return `${lead} Your balance below is read straight from Monad, and so are the demo copies.`;
    case "funded":
      return `${lead} Balances below are read from Monad; your follows keep running onchain.`;
    case "feed":
      return `${lead} Copies below are read straight from Monad; your limits still apply onchain.`;
    case "leaders":
      return `${lead} Leader rankings come from it, so they can't load. Watch mode on Home shows real copies read from Monad.`;
    case "positions":
      return `${lead} Your positions are safe onchain.`;
  }
}

/** Why "Run demo trade" / "Run blocked trade" are off while watch mode reads from Monad. */
export function runNote(network: NetworkName = NETWORK): string {
  return `${serviceDownLine(network)}; these copies are read straight from Monad.`;
}

/** Which banners the Feed shows: the backend for feed/API errors, Monad only for RPC errors. */
export function feedBanners(s: { feedError: unknown; rpcError: boolean }): FailSource[] {
  const out: FailSource[] = [];
  if (s.feedError) out.push(classifyError(s.feedError).source === "monad" ? "monad" : "mirror");
  if (s.rpcError && !out.includes("monad")) out.push("monad");
  return out;
}

/** "No copies in the last 19 minutes" (or hours past two hours). */
export function noCopiesLine(minutes: number | null | undefined): string {
  if (!minutes || minutes < 1) return "No copies in the last few minutes";
  if (minutes >= 120) return `No copies in the last ${Math.round(minutes / 60)} hours`;
  return `No copies in the last ${Math.round(minutes)} minute${Math.round(minutes) === 1 ? "" : "s"}`;
}

export interface RelayGate {
  /** The relayer answered its health check: signing can go ahead. */
  ready: boolean;
  checking: boolean;
  title: string;
  body: string;
}

/**
 * Whether an action that needs the relayer (create, deposit, follow, withdraw, send) may ask for a passkey.
 * Nothing is signed unless Mirror's service answered: a passkey prompt for something that can't be sent is never shown.
 */
export function relayGate(h: { ok: boolean; failed: boolean; checking: boolean }, network: NetworkName = NETWORK): RelayGate {
  if (h.ok) return { ready: true, checking: false, title: "", body: "" };
  if (h.failed) {
    return {
      ready: false,
      checking: false,
      title: "Can't reach Mirror's service",
      body: `${serviceDownLine(network)}, so this can't be sent. Nothing was signed; you'll be asked for your passkey once it can go through.`,
    };
  }
  return { ready: false, checking: true, title: "Checking Mirror's service", body: "One moment: your passkey is only asked for once Mirror's service answers." };
}

/** Leaders screen error: "can't reach Mirror's service" when the backend is down, else a plain error. */
export function leadersErrorCopy(err: unknown, network: NetworkName = NETWORK): { down: boolean; title: string; body: string } {
  const c = classifyError(err);
  const down = c.source === "mirror" && (c.status === 0 || (c.status ?? 0) >= 500);
  if (down) return { down, title: failTitle("mirror"), body: mirrorDownBody("leaders", network) };
  return { down, title: "Can't load leaders", body: "Mirror's service answered with an error. Try again in a moment." };
}

/** The "Try it before you follow" card while the backend is down: why the demo can't run, and where to look instead. */
export function demoDownLine(network: NetworkName = NETWORK): string {
  return `${serviceDownLine(network)}, so a demo can't be started. Home shows the demo account's real copies, read straight from Monad.`;
}

/** Under the balance: where it was read from and what it covers. */
export function balanceLine(p: { walletCNS: bigint | null; followsCNS?: bigint | null; down?: boolean; walletLoading?: boolean; walletError?: boolean }): string {
  if (p.walletCNS === null) return p.walletError ? "Can't reach Monad to read your balance. Retrying." : "Reading your balance from Monad";
  if (p.down && p.followsCNS && p.followsCNS > 0n) return `Read from Monad: ${ausd(p.walletCNS)} in your wallet, ${ausd(p.followsCNS)} in your follow accounts.`;
  if (p.down) return p.walletCNS > 0n ? "In your wallet, read from Monad. Nothing deposited yet." : "Read from Monad. Nothing deposited yet. Watch real copies land below.";
  return p.walletCNS > 0n ? "In your wallet. Nothing deposited yet. Watch real copies land below." : "Nothing deposited yet. Watch real copies land below.";
}

