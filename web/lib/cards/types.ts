/**
 * Share card model: what a card says, independent of its size and theme. Built from engine data only
 * (lib/cards/model.ts); rendered as an image by lib/cards/render.tsx and listed on the share landing page.
 */
export type CardKind = "leader" | "follower" | "blocked" | "sim";
export const CARD_KINDS: CardKind[] = ["leader", "follower", "blocked", "sim"];

/** og = 1200x630 (wide), sq = 1080x1080 (square). */
export type CardFormat = "og" | "sq";
export type CardTheme = "light" | "dark";
export const SIZES: Record<CardFormat, { width: number; height: number }> = {
  og: { width: 1200, height: 630 },
  sq: { width: 1080, height: 1080 },
};
export const DEFAULT_FORMAT: Record<CardKind, CardFormat> = { leader: "og", follower: "og", blocked: "sq", sim: "sq" };

export type Tone = "pos" | "neg" | "tx" | "mu";
/** A sentence piece; `b` renders bold (numbers in the blocked sentence). */
export type Seg = { t: string; b?: boolean };

export type Stat = { k: string; v: string; tone?: Tone };
export type ProofLink = { label: string; href: string; hash?: string; note?: string };

export interface CardModel {
  kind: CardKind;
  /** False: the engine did not answer or the record was not found; the card shows no numbers. */
  ok: boolean;
  /** Short tag next to the brand, e.g. "Leader record · 30 days". */
  tag: string;
  /** Labels drawn on the image itself. */
  teamRun?: string;
  simulation?: string;
  /** Line above the big number (simulation card). */
  kicker?: string;
  who?: { seed: string; addr: string; sub?: string; label?: string };
  big?: { text: string; unit?: string; tone: Tone };
  sub?: string;
  chart?: { points: number[]; tone: Tone; baseline?: number; from?: string; to?: string };
  stats?: Stat[];
  blocked?: { title: string; sentence: Seg[]; cmp: Stat[]; chips: { label: string; ok: boolean }[] };
  /** Not-available text (ok=false). */
  message?: string;
  /** What the QR encodes and the URL printed next to it. */
  proof: { url: string; display: string; caption: string };
  fine: string[];
  /** Landing page: every transaction behind the card, on MonadVision. */
  links: ProofLink[];
  /** Landing page: where to continue in the app. */
  app: { label: string; href: string };
  title: string;
  description: string;
}

export interface CardRequest {
  kind: CardKind;
  id: string;
  /** Query string of the share URL (account for blocked, limits for sim, f, amounts). */
  search: URLSearchParams;
}

export function isKind(k: string): k is CardKind {
  return (CARD_KINDS as string[]).includes(k);
}
export function formatOf(req: CardRequest): CardFormat {
  const f = req.search.get("f");
  return f === "og" || f === "sq" ? f : DEFAULT_FORMAT[req.kind];
}
export function themeOf(search: URLSearchParams): CardTheme {
  return search.get("t") === "dark" ? "dark" : "light";
}
/** "Show AUSD amounts": on unless amounts=0. */
export function amountsOf(search: URLSearchParams): boolean {
  return search.get("amounts") !== "0";
}

/** Query keys that change what the card says (kept in the landing and image URLs). */
const KEEP = ["a", "f", "amounts", "d", "b", "r", "l", "s", "e", "m", "p", "ls", "dl", "dd", "fl", "sl", "tp"];
export function cardQuery(search: URLSearchParams, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const k of KEEP) {
    const v = search.get(k);
    if (v !== null && v !== "") q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
export const landingPath = (req: CardRequest) => `/c/${req.kind}/${encodeURIComponent(req.id)}${cardQuery(req.search)}`;
export const imagePath = (req: CardRequest, theme: CardTheme) => `/c/${req.kind}/${encodeURIComponent(req.id)}/image${cardQuery(req.search, { t: theme })}`;
