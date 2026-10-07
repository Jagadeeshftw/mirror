// Share card links (web/app/(site)/c/[kind]/[id]): the landing page people open, and the card image the share sheet
// previews. The web side reads the same query keys (web/lib/cards/types.ts, web/lib/cards/sim-params.ts).
import type { BacktestRequest } from "./engineTypes";
import type { Address, Hex } from "./types";

/** Where the landing pages live. EXPO_PUBLIC_SHARE_BASE points it at another deployment (the localnet e2e). */
export const SHARE_BASE: string = (process.env.EXPO_PUBLIC_SHARE_BASE || "https://mirror.0xo.in").replace(/\/$/, "");

export type ShareKind = "leader" | "follower" | "blocked" | "sim";
export type ShareFormat = "og" | "sq";

export type ShareTarget =
  | { kind: "leader"; leaderId: number; teamRun?: boolean }
  | { kind: "follower"; account: Address; teamRun?: boolean }
  | { kind: "blocked"; txHash: Hex; account: Address; teamRun?: boolean }
  | { kind: "sim"; leaderId: number; request: BacktestRequest; teamRun?: boolean };

export interface ShareOptions {
  format: ShareFormat;
  /** "Show AUSD amounts": false shows percentages only (follower and simulation cards). */
  amounts: boolean;
}

/** Design 08: leader and follower are wide (1200x630), blocked and simulation square (1080x1080). */
export const DEFAULT_FORMAT: Record<ShareKind, ShareFormat> = { leader: "og", follower: "og", blocked: "sq", sim: "sq" };
export const SIZE: Record<ShareFormat, { width: number; height: number }> = { og: { width: 1200, height: 630 }, sq: { width: 1080, height: 1080 } };

/** The amounts switch only changes the follower and simulation cards. */
export const hasAmounts = (kind: ShareKind) => kind === "follower" || kind === "sim";

export function defaultOptions(kind: ShareKind): ShareOptions {
  return { format: DEFAULT_FORMAT[kind], amounts: true };
}

/** The backtest limits in the short keys the simulation card re-runs the backtest with. */
export function simParams(r: BacktestRequest): [string, string][] {
  const out: [string, string][] = [
    ["d", r.depositCNS],
    ["b", r.budgetCNS],
    ["r", String(r.ratioBps)],
    ["l", String(r.maxLeverageHdths)],
    ["s", String(r.maxSlippageBps)],
    ["m", r.markets.map((m) => `${m.perpId}:${m.maxNotionalCNS}`).join(",")],
    ["p", String(r.period)],
  ];
  if (r.maxEntryDeviationBps) out.push(["e", String(r.maxEntryDeviationBps)]);
  if (r.lossStopBps) out.push(["ls", String(r.lossStopBps)]);
  if (r.dailyLossBps) out.push(["dl", String(r.dailyLossBps)]);
  if (r.drawdownBps) out.push(["dd", String(r.drawdownBps)]);
  if (r.flattenOnStop) out.push(["fl", "1"]);
  if (r.stopLossPct) out.push(["sl", String(r.stopLossPct)]);
  if (r.takeProfitPct) out.push(["tp", String(r.takeProfitPct)]);
  return out;
}

function idOf(t: ShareTarget): string {
  switch (t.kind) {
    case "leader":
    case "sim":
      return String(t.leaderId);
    case "follower":
      return t.account;
    case "blocked":
      return t.txHash;
  }
}

function query(t: ShareTarget, o: ShareOptions, extra: [string, string][] = []): string {
  const q: [string, string][] = [];
  if (t.kind === "blocked") q.push(["a", t.account]);
  if (t.kind === "sim") q.push(...simParams(t.request));
  if (o.format !== DEFAULT_FORMAT[t.kind]) q.push(["f", o.format]);
  if (!o.amounts && hasAmounts(t.kind)) q.push(["amounts", "0"]);
  q.push(...extra);
  return q.length ? `?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
}

/** The link that is shared: a page with the card, its OG tags and every transaction on MonadVision. */
export function landingUrl(t: ShareTarget, o: ShareOptions, base = SHARE_BASE): string {
  return `${base}/c/${t.kind}/${idOf(t)}${query(t, o)}`;
}

/** The card image itself (PNG), in the app's current theme. */
export function imageUrl(t: ShareTarget, o: ShareOptions, theme: "light" | "dark", base = SHARE_BASE): string {
  return `${base}/c/${t.kind}/${idOf(t)}/image${query(t, o, [["t", theme]])}`;
}

/** Sheet title (design 08e), e.g. "Blocked by my rule"; team-run cards say so. */
export function shareTitle(t: ShareTarget): string {
  const team = t.teamRun ? " · team-run" : "";
  switch (t.kind) {
    case "leader":
      return `Leader record${team}`;
    case "follower":
      return t.teamRun ? "Demo copy result · team-run" : "My copy result";
    case "blocked":
      return t.teamRun ? "Blocked · team-run demo" : "Blocked by my rule";
    case "sim":
      return `Simulation${team}`;
  }
}

/** How "Share" works here: the system share sheet on Android, the Web Share API in a browser that has it,
 * otherwise copying the link. */
export function shareMethod(os: string, hasWebShare: boolean): "native" | "webshare" | "copy" {
  if (os !== "web") return "native";
  return hasWebShare ? "webshare" : "copy";
}
