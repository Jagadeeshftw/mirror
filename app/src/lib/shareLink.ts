// Shared position links and suggested levels (design proposal-2 #share; engine docs/api.md "Shared positions").
// Pure parts: the owner's typed data (account's "Mirror Account" v1 domain), link ids, the friend page URL,
// the decrypted owner list, and the level the owner signs when they accept a suggestion. Screens never build these.
import { mirrorDomain } from "./contracts";
import { buildLevel, checkLevels, LEVEL_SLIPPAGE_BPS, levelFor, type LevelCheck } from "./levels";
import { SHARE_BASE } from "./share";
import type { Address, Hex, Level, Position, PositionLevel, Side } from "./types";

export const SHARE_LINK_TYPES = { ShareLink: [{ name: "perpId", type: "uint32" }, { name: "linkId", type: "bytes32" }, { name: "deadline", type: "uint256" }] } as const;
export const SHARE_REVOKE_TYPES = { ShareRevoke: [{ name: "linkId", type: "bytes32" }, { name: "deadline", type: "uint256" }] } as const;
export const SHARE_DECLINE_TYPES = { ShareDecline: [{ name: "suggestionId", type: "uint256" }, { name: "deadline", type: "uint256" }] } as const;

export const shareLinkTypedData = (account: Address, chainId: number, perpId: number, linkId: Hex, deadline: bigint) =>
  ({ domain: mirrorDomain(account, chainId), types: SHARE_LINK_TYPES, primaryType: "ShareLink" as const, message: { perpId, linkId, deadline } });
export const shareRevokeTypedData = (account: Address, chainId: number, linkId: Hex, deadline: bigint) =>
  ({ domain: mirrorDomain(account, chainId), types: SHARE_REVOKE_TYPES, primaryType: "ShareRevoke" as const, message: { linkId, deadline } });
export const shareDeclineTypedData = (account: Address, chainId: number, suggestionId: number, deadline: bigint) =>
  ({ domain: mirrorDomain(account, chainId), types: SHARE_DECLINE_TYPES, primaryType: "ShareDecline" as const, message: { suggestionId: BigInt(suggestionId), deadline } });

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes; the engine refuses low-entropy ids. */
export function newLinkId(rand: (b: Uint8Array) => Uint8Array = (b) => (globalThis.crypto.getRandomValues(b as Uint8Array<ArrayBuffer>), b)): Hex {
  const b = rand(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/** bytes32 -> the 43-character base64url id in /p/<id> (same as the engine's urlIdOf). */
export function urlIdOf(linkId: Hex): string {
  const hex = linkId.slice(2);
  const bytes = Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + (left > 1 ? B64URL[(n >> 6) & 63] : "") + (left > 2 ? B64URL[n & 63] : "");
  }
  return out;
}

export const positionLinkUrl = (urlId: string, base = SHARE_BASE) => `${base}/p/${urlId}`;

// ---------------------------------------------------------------- owner list (decrypted)

export type LinkStatus = "open" | "revoked" | "closed";
export type SuggestionStatus = "pending" | "accepted" | "declined" | "expired";
export interface ShareLinkInfo { linkId: Hex; urlId: string; perpId: number; side: Side; status: LinkStatus; createdMs: number; endedMs: number | null; endedReason: string | null }
export interface Suggestion {
  id: number; linkId: Hex; perpId: number; side: Side;
  stopLossPNS: string | null; takeProfitPNS: string | null; prevStopLossPNS: string; prevTakeProfitPNS: string;
  entryPNS: string; markPNS: string; note: string; status: SuggestionStatus; createdMs: number; decidedMs: number | null; txHash: string | null;
}
export interface ShareList { account: Address; links: ShareLinkInfo[]; suggestions: Suggestion[] }

/** Decrypted payload -> ShareList; anything malformed is dropped rather than shown. */
export function normalizeShareList(raw: any, account: Address): ShareList {
  const side = (s: unknown): Side => (s === "short" || s === 1 ? "short" : "long");
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const links = (Array.isArray(raw?.links) ? raw.links : [])
    .filter((l: any) => /^0x[0-9a-f]{64}$/i.test(String(l?.linkId)))
    .map((l: any) => ({ linkId: l.linkId, urlId: String(l.urlId ?? urlIdOf(l.linkId)), perpId: Number(l.perpId), side: side(l.side), status: (["open", "revoked", "closed"].includes(l.status) ? l.status : "closed") as LinkStatus, createdMs: Number(l.createdMs ?? 0), endedMs: l.endedMs ?? null, endedReason: l.endedReason ?? null }));
  const suggestions = (Array.isArray(raw?.suggestions) ? raw.suggestions : [])
    .filter((s: any) => Number.isInteger(Number(s?.id)))
    .map((s: any) => ({
      id: Number(s.id), linkId: s.linkId, perpId: Number(s.perpId), side: side(s.side), stopLossPNS: str(s.stopLossPNS), takeProfitPNS: str(s.takeProfitPNS),
      prevStopLossPNS: String(s.prevStopLossPNS ?? "0"), prevTakeProfitPNS: String(s.prevTakeProfitPNS ?? "0"), entryPNS: String(s.entryPNS ?? "0"), markPNS: String(s.markPNS ?? "0"),
      note: typeof s.note === "string" ? s.note.slice(0, 140) : "", status: (["pending", "accepted", "declined", "expired"].includes(s.status) ? s.status : "expired") as SuggestionStatus,
      createdMs: Number(s.createdMs ?? 0), decidedMs: s.decidedMs ?? null, txHash: s.txHash ?? null,
    }));
  return { account, links, suggestions };
}

const samePos = (x: { perpId: number; side: Side }, p: Pick<Position, "perpId" | "side">) => x.perpId === p.perpId && x.side === p.side;
export const openLinkFor = (l: ShareList | undefined, p: Pick<Position, "perpId" | "side">) => l?.links.find((k) => k.status === "open" && samePos(k, p)) ?? null;
export const pendingFor = (l: ShareList | undefined, p: Pick<Position, "perpId" | "side">) => (l?.suggestions ?? []).filter((s) => s.status === "pending" && samePos(s, p));
/** The accepted suggestion whose transaction set the level shown now (the latest LevelSet), if any. */
export const acceptedFor = (l: ShareList | undefined, p: Pick<Position, "perpId" | "side">, levelTx: string | null | undefined) =>
  levelTx ? ((l?.suggestions ?? []).find((s) => s.status === "accepted" && samePos(s, p) && s.txHash?.toLowerCase() === levelTx.toLowerCase()) ?? null) : null;

// ---------------------------------------------------------------- accept

export interface AcceptPlan {
  level: Level;
  /** Levels after accepting (friend's where suggested, the current ones elsewhere). */
  stopLossPNS: bigint;
  takeProfitPNS: bigint;
  error: LevelCheck | null;
}

/**
 * The single Level the owner signs to accept: the suggested fields replace the current ones, the rest stay, and the
 * current slippage is kept. Checked again now (the mark has moved since the friend sent it) with the app's level rules.
 */
export function acceptPlan(s: Pick<Suggestion, "perpId" | "side" | "stopLossPNS" | "takeProfitPNS">, p: Pick<Position, "perpId" | "side" | "markPNS">, levels: PositionLevel[] | undefined): AcceptPlan {
  const cur = levelFor(levels, p);
  const sl = s.stopLossPNS ? BigInt(s.stopLossPNS) : BigInt(cur?.stopLossPNS ?? "0");
  const tp = s.takeProfitPNS ? BigInt(s.takeProfitPNS) : BigInt(cur?.takeProfitPNS ?? "0");
  const slip = cur?.slippageBps || LEVEL_SLIPPAGE_BPS;
  const wrongPosition = s.perpId !== p.perpId || s.side !== p.side;
  const error = wrongPosition ? { field: null, message: "This suggestion was for another position" } : checkLevels(p.side, BigInt(p.markPNS || "0"), sl, tp, slip);
  return { level: buildLevel(p.perpId, p.side, sl, tp, slip), stopLossPNS: sl, takeProfitPNS: tp, error };
}
