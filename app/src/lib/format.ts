// Amount formatting. AUSD has 6 decimals; lots and prices use per-market decimals.
// Never goes through floating point for raw amounts.

export const AUSD_DECIMALS = 6;
/** True minus sign (U+2212) for negative numbers, as in the design. */
export const MINUS = "−";

export function toBig(v: bigint | string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(v);
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a raw fixed-point integer with `decimals` into a string with exactly `dp`
 * fraction digits (rounded half away from zero), with thousands grouping.
 */
export function formatFixed(
  raw: bigint | string | number,
  decimals: number,
  dp: number = decimals,
  opts: { grouping?: boolean; sign?: boolean } = {},
): string {
  let v = toBig(raw);
  const neg = v < 0n;
  if (neg) v = -v;
  if (dp < decimals) {
    const f = 10n ** BigInt(decimals - dp);
    v = (v + f / 2n) / f;
  } else if (dp > decimals) {
    v = v * 10n ** BigInt(dp - decimals);
  }
  const s = v.toString().padStart(dp + 1, "0");
  const i = s.slice(0, s.length - dp);
  const fr = dp > 0 ? s.slice(s.length - dp) : "";
  const body = (opts.grouping === false ? i : group(i)) + (dp > 0 ? "." + fr : "");
  const isZero = /^[0.,]+$/.test(body);
  if (neg && !isZero) return MINUS + body;
  if (opts.sign) return (isZero ? "+" : "+") + body;
  return body;
}

/** "21.37" from raw CNS. */
export function ausd(cns: bigint | string | number | null | undefined, dp = 2): string {
  return formatFixed(toBig(cns), AUSD_DECIMALS, dp);
}

/** "+0.92" / "−0.45" from raw CNS. */
export function ausdSigned(cns: bigint | string | number | null | undefined, dp = 2): string {
  const v = toBig(cns);
  const body = formatFixed(v < 0n ? -v : v, AUSD_DECIMALS, dp);
  return (v < 0n && !/^[0.,]+$/.test(body) ? MINUS : "+") + body;
}

/** Lots → "0.00015" (always lotDecimals digits). */
export function lots(lotLNS: bigint | string, lotDecimals: number): string {
  return formatFixed(toBig(lotLNS), lotDecimals, lotDecimals);
}

/** Price → "118,402.5" (priceDecimals digits). */
export function price(pricePNS: bigint | string, priceDecimals: number): string {
  return formatFixed(toBig(pricePNS), priceDecimals, priceDecimals);
}

/** Leverage in hundredths → "5x" / "4.5x". */
export function leverage(hdths: number): string {
  const whole = hdths / 100;
  return (Number.isInteger(whole) ? whole.toFixed(0) : whole.toFixed(whole * 10 === Math.round(whole * 10) ? 1 : 2)) + "x";
}

/** Basis points → "0.5%" / "10%". */
export function bps(b: number): string {
  const p = b / 100;
  if (Number.isInteger(p)) return `${p}%`;
  return `${p.toFixed(p < 0.1 ? 2 : p < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** Signed percent with true minus: "+38.4%" / "−1.3%". */
export function pctSigned(n: number, d = 1): string {
  const body = Math.abs(n).toFixed(d);
  return (n < 0 && Number(body) !== 0 ? MINUS : "+") + body + "%";
}

export function numSigned(n: number, d = 2): string {
  const body = Math.abs(n).toFixed(d);
  return (n < 0 && Number(body) !== 0 ? MINUS : "+") + body;
}

export function comma(n: number, d = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Compact USD for leader stats: "+$212.4k", "−$7.2k", "$1.2M". */
export function usdCompact(n: number, signed = false): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  const sign = n < 0 ? MINUS : signed ? "+" : "";
  return `${sign}$${s}`;
}

export function shortAddr(a: string | null | undefined, head = 4, tail = 4): string {
  if (!a) return "";
  return `${a.slice(0, 2 + head)}…${a.slice(-tail)}`;
}

export function shortHash(h: string | null | undefined): string {
  return shortAddr(h, 4, 4);
}

/** Address grouped in fours for eyeball checks: "0x4b21 C7e0 5A93 …". */
export function groupedAddress(a: string): string {
  return a
    .slice(2)
    .match(/.{1,4}/g)!
    .map((g, i) => (i === 0 ? "0x" : "") + g)
    .join(" ");
}

export function latency(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return "";
  return `${(ms / 1000).toFixed(2)} s`;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateShort(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export function dateLong(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
export function timeHM(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Parses a user-typed decimal ("12.5") into raw units. Returns null when invalid or
 * when it has more fraction digits than `decimals`.
 */
export function parseUnits(input: string, decimals: number): bigint | null {
  const t = input.trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return null;
  const [i, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt((i || "0") + f.padEnd(decimals, "0"));
}

export function cnsFromAusd(n: number): bigint {
  return BigInt(Math.round(n * 1e6));
}

export function cnsToNumber(cns: bigint | string | null | undefined): number {
  return Number(toBig(cns)) / 1e6;
}

/** Notional in CNS for lots at a price: lots * price * 1e6 / 10^(lotDec+priceDec). */
export function notionalCNS(lotLNS: bigint, pricePNS: bigint, lotDecimals: number, priceDecimals: number): bigint {
  return (lotLNS * pricePNS * 10n ** 6n) / 10n ** BigInt(lotDecimals + priceDecimals);
}

export const ORDER_TYPES = ["Open long", "Open short", "Close long", "Close short"] as const;
export function orderSide(t: number): "Long" | "Short" {
  return t === 0 || t === 2 ? "Long" : "Short";
}
export function orderAction(t: number): "Open" | "Close" {
  return t <= 1 ? "Open" : "Close";
}
