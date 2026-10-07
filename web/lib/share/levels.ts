/**
 * Friend's page math for a shared position (engine GET /v1/share/:id). Raw integers as the engine sends them:
 * PNS = price with the market's priceDecimals, LNS = lots, CNS = AUSD with 6 decimals. The checks match the engine's
 * (engine/src/services/share-rules.ts): the contract's order rule for the side, merged with the current level, and a
 * level already reached at the mark.
 */
export type Side = "long" | "short";

export interface SharedCard {
  status: "open" | "revoked" | "closed";
  endedReason?: string;
  perpId: number;
  symbol: string;
  side: Side;
  sharedBy: string;
  copiedFrom?: string | null;
  lotLNS?: string;
  entryPNS?: string;
  markPNS?: string;
  depositCNS?: string;
  pnlCNS?: string;
  stopLossPNS?: string;
  takeProfitPNS?: string;
  lotDecimals: number;
  priceDecimals: number;
  block?: number;
}

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return BigInt(0);
  }
};
const Z = BigInt(0);

/** "112,000.0" / "112000" -> PNS, null when it does not parse, 0 for empty. */
export function parsePrice(text: string, decimals: number): bigint | null {
  const t = text.replace(/[,\s]/g, "");
  if (t === "") return Z;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w + f.padEnd(decimals, "0"));
}

/** PNS -> "112,000.0" (one decimal at least, as the app shows prices). */
export function fmtPrice(pns: bigint | string | undefined, decimals: number): string {
  const n = Number(big(pns)) / 10 ** decimals;
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(1, decimals), maximumFractionDigits: decimals });
}

/** Signed move in percent from `from` to `to`, positive in the position's favour. */
export function movePct(from: bigint, to: bigint, side: Side): number {
  if (from <= Z) return 0;
  const raw = (Number(to - from) / Number(from)) * 100;
  return side === "long" ? raw : -raw;
}

export const pctText = (p: number) => `${p < 0 ? "−" : "+"}${Math.abs(p).toFixed(1)}%`;

/** Estimated result in CNS (signed, before fees) of closing the whole position at `at`. */
export function resultAtCNS(c: Pick<SharedCard, "lotLNS" | "entryPNS" | "side" | "lotDecimals" | "priceDecimals">, at: bigint): bigint {
  const entry = big(c.entryPNS);
  const diff = c.side === "long" ? at - entry : entry - at;
  return (big(c.lotLNS) * diff * BigInt(10) ** BigInt(6)) / BigInt(10) ** BigInt(c.lotDecimals + c.priceDecimals);
}

export function ausdSigned(cns: bigint): string {
  const n = Number(cns) / 1e6;
  const t = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return t === "0.00" ? "0.00" : `${n < 0 ? "−" : "+"}${t}`;
}

/** Leverage from notional at entry over the position's margin, e.g. "4x" / "2.5x". */
export function leverageText(c: SharedCard): string | null {
  const dep = big(c.depositCNS);
  if (dep <= Z) return null;
  const notional = (big(c.lotLNS) * big(c.entryPNS) * BigInt(10) ** BigInt(6)) / BigInt(10) ** BigInt(c.lotDecimals + c.priceDecimals);
  const x = Number(notional) / Number(dep);
  if (!Number.isFinite(x) || x <= 0) return null;
  return `${x >= 10 || Math.abs(x - Math.round(x)) < 0.05 ? Math.round(x) : x.toFixed(1)}x`;
}

export function roePct(c: SharedCard): number | null {
  const dep = big(c.depositCNS);
  return dep > Z ? (Number(big(c.pnlCNS)) / Number(dep)) * 100 : null;
}

export interface Check {
  field: "sl" | "tp";
  message: string;
}

/** null = may be sent. `sl` / `tp`: 0 = not suggested (the current level stays). */
export function checkSuggestion(c: SharedCard, sl: bigint, tp: bigint): Check | null {
  const long = c.side === "long";
  const mark = big(c.markPNS);
  if (sl === Z && tp === Z) return { field: "sl", message: "Suggest a stop-loss, a take-profit or both" };
  const fsl = sl || big(c.stopLossPNS);
  const ftp = tp || big(c.takeProfitPNS);
  if (fsl !== Z && ftp !== Z && (long ? fsl >= ftp : fsl <= ftp)) return { field: sl ? "sl" : "tp", message: long ? "On a long the stop-loss must be below the take-profit" : "On a short the stop-loss must be above the take-profit" };
  if (mark > Z) {
    if (sl && (long ? sl >= mark : sl <= mark)) return { field: "sl", message: long ? "Stop-loss must be below the mark, or it fires at once" : "Stop-loss must be above the mark, or it fires at once" };
    if (tp && (long ? tp <= mark : tp >= mark)) return { field: "tp", message: long ? "Take-profit must be above the mark, or it fires at once" : "Take-profit must be below the mark, or it fires at once" };
  }
  return null;
}

/** The engine's note rule, so the counter matches what is accepted (it also strips control characters). */
export function noteLength(note: string): number {
  return [...note.replace(/\s+/g, " ").trim()].length;
}
