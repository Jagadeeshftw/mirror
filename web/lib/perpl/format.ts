/** Display helpers for the Perpl analytics view (server and client safe). "—" means not available. */

export const DASH = "—";

/** Integer string or bigint in a native scale to a JS number in display units. */
export function scale(v: string | bigint | number | null | undefined, decimals: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n / 10 ** decimals : null;
}

export const cns = (v: string | bigint | number | null | undefined) => scale(v, 6);

/** Compact amount: 14.2M, 212.4k, 950. */
export function compact(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(digits)}k`;
  return `${s}${a.toFixed(a >= 100 ? 0 : a >= 1 ? 2 : 2)}`;
}

export function int(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? DASH : Math.round(n).toLocaleString("en-US");
}

export function money(n: number | null | undefined, digits = 2, signed = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return signed && n > 0 ? `+${s}` : s;
}

/** Price with the market's decimals. */
export function price(n: number | null | undefined, decimals: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function size(n: number | null | undefined, decimals: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const d = Math.min(decimals, Math.abs(n) >= 1000 ? 0 : decimals);
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}

export function pct(f: number | null | undefined, digits = 1, signed = false): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return DASH;
  const s = (f * 100).toFixed(digits);
  return `${signed && f > 0 ? "+" : ""}${s}%`;
}

export function lev(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return DASH;
  if (!Number.isFinite(x)) return "∞";
  return `${x.toFixed(x >= 10 ? 1 : 2)}x`;
}

export function shortHex(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return DASH;
  return h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;
}

export function utc(sec: number | null | undefined, withDate = true): string {
  if (!sec) return DASH;
  return (
    new Date(sec * 1000).toLocaleString("en-GB", {
      ...(withDate ? { day: "2-digit", month: "short" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }) + " UTC"
  );
}

export function ago(sec: number | null | undefined, now = Date.now() / 1000): string {
  if (!sec) return DASH;
  const d = Math.max(0, now - sec);
  if (d < 90) return `${Math.round(d)}s`;
  if (d < 5400) return `${Math.round(d / 60)}m`;
  if (d < 172800) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86400)}d`;
}

/** Funding rate per interval (fraction) as a percentage with 4 decimals. */
export function rate(f: number | null | undefined): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return DASH;
  return `${f > 0 ? "+" : ""}${(f * 100).toFixed(4)}%`;
}

/** UTC date only: "07 Oct". */
export function day(sec: number | null | undefined): string {
  if (!sec) return DASH;
  return new Date(sec * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}
