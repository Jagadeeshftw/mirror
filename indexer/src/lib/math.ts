/**
 * Fixed-point helpers. Everything is bigint; nothing goes through floating point.
 *
 *   CNS: collateral native units (AUSD, 6 decimals)
 *   PNS: price native units (10^priceDecimals per 1 USD)
 *   LNS: lot native units (10^lotDecimals per 1 unit of the base asset)
 *   Q16: Perpl's price residue, a fraction of one PNS in 1/65536ths
 */
import { COLLATERAL_DECIMALS } from "./constants.js";

export const Q16 = 65536n;
export const BPS = 10_000n;
export const SECONDS_PER_DAY = 86_400;

const POW10: bigint[] = Array.from({ length: 40 }, (_, i) => 10n ** BigInt(i));

export function pow10(n: number): bigint {
  if (n < 0) throw new Error(`negative exponent ${n}`);
  return POW10[n] ?? 10n ** BigInt(n);
}

export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Signed division rounded half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  const neg = a < 0n !== b < 0n;
  const q = (abs(a) * 2n + abs(b)) / (2n * abs(b));
  return neg ? -q : q;
}

/** Notional value in CNS of `lots` at `price`: lots * price * 10^6 / 10^(lotDec + priceDec). */
export function notionalCNS(lots: bigint, pricePNS: bigint, lotDecimals: number, priceDecimals: number): bigint {
  if (lots <= 0n || pricePNS <= 0n) return 0n;
  return (lots * pricePNS * pow10(COLLATERAL_DECIMALS)) / pow10(lotDecimals + priceDecimals);
}

/** Entry price including the residue, in Q16 units of one PNS. */
export function toQ16(pricePNS: bigint, residueQ16: bigint = 0n): bigint {
  return pricePNS * Q16 + residueQ16;
}

/**
 * Exit price of a reduction, derived from Perpl's deltaPnl. Perpl realizes
 *   deltaPnl = (exit - entry) * lots  (long)   or   (entry - exit) * lots  (short)
 * against the position's average entry price (verified on mainnet events), so
 *   exit = entry +/- deltaPnl * 10^(lotDec + priceDec) / (lots * 10^6).
 * Returns null when the inputs cannot produce a meaningful price.
 */
export function exitPriceFromPnl(
  side: "LONG" | "SHORT",
  entryQ16: bigint,
  deltaPnlCNS: bigint,
  lotsClosed: bigint,
  lotDecimals: number,
  priceDecimals: number,
): bigint | null {
  if (lotsClosed <= 0n || entryQ16 <= 0n) return null;
  const deltaQ16 = divRound(
    deltaPnlCNS * pow10(lotDecimals + priceDecimals) * Q16,
    lotsClosed * pow10(COLLATERAL_DECIMALS),
  );
  const exitQ16 = side === "LONG" ? entryQ16 + deltaQ16 : entryQ16 - deltaQ16;
  if (exitQ16 <= 0n) return null;
  return divRound(exitQ16, Q16);
}

/**
 * Fill price of an increase, derived from the change in Perpl's average entry price:
 *   fill = (entryAfter * lotsAfter - entryBefore * lotsBefore) / (lotsAfter - lotsBefore)
 * Using the Q16 residue keeps the error below one PNS even for large positions.
 */
export function increaseFillPrice(
  entryBeforeQ16: bigint,
  lotsBefore: bigint,
  entryAfterQ16: bigint,
  lotsAfter: bigint,
): bigint | null {
  const added = lotsAfter - lotsBefore;
  if (added <= 0n || entryBeforeQ16 <= 0n || entryAfterQ16 <= 0n) return null;
  const fillQ16 = divRound(entryAfterQ16 * lotsAfter - entryBeforeQ16 * lotsBefore, added);
  if (fillQ16 <= 0n) return null;
  return divRound(fillQ16, Q16);
}

/** wins / (wins + losses) in basis points. */
export function winRateBps(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 0;
  return Math.round((wins * 10_000) / n);
}

/** Notional-weighted average leverage in hundredths. */
export function avgLeverageHdths(leverageNotionalSum: bigint, openingNotional: bigint): number {
  if (openingNotional <= 0n) return 0;
  return Number(divRound(leverageNotionalSum, openingNotional));
}

/** ratio of a to b in bps, clamped to the Int range; 0 when b <= 0. */
export function ratioBps(a: bigint, b: bigint): number {
  if (b <= 0n) return 0;
  const v = divRound(a * BPS, b);
  const LIMIT = 2_000_000_000n;
  if (v > LIMIT) return Number(LIMIT);
  if (v < -LIMIT) return Number(-LIMIT);
  return Number(v);
}

/**
 * Drawdown of `dd` against an equity peak of capitalBase + peakPnl, in bps. 0 when the capital base
 * is unknown: a ratio against PnL alone is meaningless.
 */
export function drawdownBps(dd: bigint, capitalBase: bigint, peakPnl: bigint): number {
  if (capitalBase <= 0n) return 0;
  return ratioBps(dd, capitalBase + peakPnl);
}

export function dayOf(timestamp: number): number {
  return Math.floor(timestamp / SECONDS_PER_DAY);
}

export function dateOf(day: number): string {
  return new Date(day * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
}
