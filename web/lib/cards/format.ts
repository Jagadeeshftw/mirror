/**
 * Number and text formatting for the share cards. Inputs are the engine's raw units (docs/api.md):
 * CNS = AUSD with 6 decimals, PNS = price with the market's priceDecimals, hdths = leverage x 100.
 * Every formatter returns null for a missing input so a card can leave the value out instead of guessing.
 */
export const MINUS = "−";
export const ZERO = BigInt(0);

export function toBig(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

export function toNum(v: unknown): number | null {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** "0x7a3f…c91e" */
export function shortAddr(a: string | null | undefined): string {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Raw 6-decimal AUSD to "1,234.56" (no sign). Small non-zero amounts show all 6 decimals so a fee is never shown as 0.00. */
export function ausd(cns: unknown, dp = 2): string | null {
  const b = toBig(cns);
  if (b === null) return null;
  const abs = b < ZERO ? -b : b;
  const n = Number(abs) / 1e6;
  let d = dp;
  if (n > 0 && n < 10 ** -dp) d = 6; // exact: AUSD has 6 decimals
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: d });
}

/** "+0.92" / "−0.15" */
export function ausdSigned(cns: unknown, dp = 2): string | null {
  const b = toBig(cns);
  const s = ausd(cns, dp);
  if (b === null || s === null) return null;
  return `${b < ZERO ? MINUS : "+"}${s}`;
}

/** 4.6 → "+4.6%", -9.2 → "−9.2%" */
export function pctSigned(p: unknown, dp = 1): string | null {
  const n = toNum(p);
  if (n === null) return null;
  return `${n < 0 ? MINUS : "+"}${Math.abs(n).toFixed(dp)}%`;
}

export function pct(p: unknown, dp = 1): string | null {
  const n = toNum(p);
  return n === null ? null : `${n.toFixed(dp)}%`;
}

/** Price in PNS to "118,414.0". */
export function price(pns: unknown, decimals: number | undefined): string | null {
  const b = toBig(pns);
  if (b === null || decimals === undefined) return null;
  const n = Number(b) / 10 ** decimals;
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(decimals, 2), maximumFractionDigits: decimals });
}

/** Lots in LNS to "0.0001". */
export function lots(lns: unknown, decimals: number | undefined): string | null {
  const b = toBig(lns);
  if (b === null || decimals === undefined) return null;
  return (Number(b) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** 1200 hdths → "12x", 250 → "2.5x". */
export function leverage(hdths: unknown): string | null {
  const n = toNum(hdths);
  if (n === null) return null;
  const x = n / 100;
  return `${Number.isInteger(x) ? x : x.toFixed(1)}x`;
}

/** 150 bps → "1.5%". */
export function bpsPct(bps: unknown): string | null {
  const n = toNum(bps);
  if (n === null) return null;
  const p = n / 100;
  return `${Number.isInteger(p) ? p : p.toFixed(p < 1 ? 2 : 1).replace(/0+$/, "")}%`;
}

/** Signed bps with one decimal: "+0.8 bps". */
export function bpsSigned(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return `${v < 0 ? MINUS : "+"}${Math.abs(v).toFixed(1)} bps`;
}

/** Unix seconds to "Sep 14". */
export function dateShort(sec: unknown): string | null {
  const n = toNum(sec);
  if (n === null || n <= 0) return null;
  return new Date(n * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 610 ms → "0.61 s". */
export function seconds(ms: number | null): string | null {
  return ms === null ? null : `${(ms / 1000).toFixed(2)} s`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
