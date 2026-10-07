/**
 * Risk math for the Perpl analytics view. Pure functions in display units (prices in USD, sizes in the
 * market's base asset, collateral in AUSD), so they can be unit tested without a chain.
 *
 * Perpl margins positions one by one: each position holds its own deposit, and a position is liquidated when
 * its equity (deposit + unrealised PnL, funding included) falls below the maintenance margin of its
 * notional at the mark price. Perpl's REST context gives the maintenance margin as a leverage in hundredths
 * (`maintenance_margin: 2000` = 20x = 5% of notional, Perpl api-docs types.md).
 *
 * Every liquidation figure here is an ESTIMATE and errs on the early side:
 *  - the maintenance fraction is raised by the taker fee, the cost of closing the position;
 *  - only the position's own deposit counts; free account balance is ignored;
 *  - accrued funding is frozen at its current value and the mark is the only price that moves.
 */

export type Side = "long" | "short";

export type PositionInput = {
  side: Side;
  /** Size in base units, > 0. */
  size: number;
  /** Average entry price. */
  entry: number;
  /** Current mark price. */
  mark: number;
  /** Collateral held by the position, AUSD. */
  deposit: number;
  /**
   * Unrealised PnL including accrued funding, AUSD (Perpl's `pnlCNS` from getPositionV2). When absent, the
   * price PnL at `mark` is used, i.e. no accrued funding.
   */
  pnl?: number;
};

/** Price PnL of a position at `price` (no funding). */
export function pricePnl(side: Side, size: number, entry: number, price: number): number {
  return side === "long" ? size * (price - entry) : size * (entry - price);
}

/**
 * Maintenance margin as a fraction of notional, from Perpl's `maintenance_margin` (leverage in hundredths)
 * plus the taker fee (per 100,000) as a conservative closing cost. Returns null for a missing or invalid config.
 */
export function maintenanceFraction(maintenanceLevHdths: number | null | undefined, takerFeePer100k = 0): number | null {
  if (!maintenanceLevHdths || !Number.isFinite(maintenanceLevHdths) || maintenanceLevHdths <= 0) return null;
  const fee = Number.isFinite(takerFeePer100k) && takerFeePer100k > 0 ? takerFeePer100k / 100_000 : 0;
  return 100 / maintenanceLevHdths + fee;
}

/** Accrued funding implied by `pnl` (total unrealised) minus the price PnL at the mark. */
function accruedFunding(p: PositionInput): number {
  if (p.pnl === undefined || !Number.isFinite(p.pnl)) return 0;
  return p.pnl - pricePnl(p.side, p.size, p.entry, p.mark);
}

/** Position equity at the current mark: deposit + unrealised PnL (funding included). */
export function equity(p: PositionInput): number {
  return p.deposit + (p.pnl ?? pricePnl(p.side, p.size, p.entry, p.mark));
}

/**
 * Estimated liquidation price: the mark at which equity equals `m` x notional.
 *   long:  D + F + S(P - E) = S P m   =>  P = (S E - D - F) / (S (1 - m))
 *   short: D + F + S(E - P) = S P m   =>  P = (S E + D + F) / (S (1 + m))
 * Returns null when there is no positive liquidation price (a long with collateral above its notional).
 */
export function liquidationPrice(p: PositionInput, m: number): number | null {
  if (!(p.size > 0) || !(m >= 0) || m >= 1) return null;
  const f = accruedFunding(p);
  const px =
    p.side === "long"
      ? (p.size * p.entry - p.deposit - f) / (p.size * (1 - m))
      : (p.size * p.entry + p.deposit + f) / (p.size * (1 + m));
  return Number.isFinite(px) && px > 0 ? px : null;
}

/**
 * Adverse move of the mark, as a fraction of the mark, before the estimated liquidation price is reached.
 * 0 means already at or past it. null when there is no liquidation price (cannot be liquidated by price alone).
 */
export function distanceToLiquidation(p: PositionInput, m: number): number | null {
  if (!(p.mark > 0)) return null;
  const liq = liquidationPrice(p, m);
  if (liq === null) return null;
  const d = p.side === "long" ? (p.mark - liq) / p.mark : (liq - p.mark) / p.mark;
  return Math.max(0, d);
}

/** Share of the position's equity that the maintenance margin takes, 0..1+ (1 = at liquidation). */
export function marginUsed(p: PositionInput, m: number): number | null {
  const eq = equity(p);
  const req = p.size * p.mark * m;
  if (eq <= 0) return req > 0 ? Infinity : null;
  return req / eq;
}

/** Effective leverage: notional at the mark over equity. Infinity when equity is gone. */
export function effectiveLeverage(p: PositionInput): number {
  const eq = equity(p);
  const notional = p.size * p.mark;
  if (eq <= 0) return notional > 0 ? Infinity : 0;
  return notional / eq;
}

/**
 * Share of the total held by the `n` largest values (e.g. top-10 accounts' share of open interest).
 * Negative and non-finite values are ignored. Returns null for an empty or zero total.
 */
export function topShare(values: number[], n = 10): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a);
  const total = clean.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const top = clean.slice(0, Math.max(0, n)).reduce((s, v) => s + v, 0);
  return top / total;
}

/** Herfindahl-Hirschman index of the shares, 0..1 (1 = a single holder). */
export function hhi(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  const total = clean.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  return clean.reduce((s, v) => s + (v / total) ** 2, 0);
}

export type Bucket = { label: string; min: number; max: number; count: number; notional: number };

/** Default leverage buckets: [1-2x), [2-5x), [5-10x), [10-20x), 20x and above. Below 1x falls in the first. */
export const LEVERAGE_EDGES = [2, 5, 10, 20];

/**
 * Counts positions (and their notional) per leverage bucket. `edges` are the upper bounds of each bucket
 * except the last, ascending. A leverage exactly on an edge goes to the higher bucket. Non-finite leverage
 * (equity gone) counts in the last bucket.
 */
export function leverageBuckets(items: { leverage: number; notional?: number }[], edges = LEVERAGE_EDGES): Bucket[] {
  const bounds = [0, ...edges, Infinity];
  const buckets: Bucket[] = bounds.slice(0, -1).map((min, i) => {
    const max = bounds[i + 1];
    const lo = i === 0 ? 1 : min;
    return { label: max === Infinity ? `${lo}x+` : `${lo}-${max}x`, min, max, count: 0, notional: 0 };
  });
  for (const it of items) {
    if (Number.isNaN(it.leverage)) continue;
    const lev = it.leverage;
    let idx = buckets.findIndex((b) => lev >= b.min && lev < b.max);
    if (idx < 0) idx = buckets.length - 1;
    buckets[idx].count += 1;
    buckets[idx].notional += it.notional && Number.isFinite(it.notional) ? it.notional : 0;
  }
  return buckets;
}

/** Relative divergence of mark from oracle, signed: (mark - oracle) / oracle. */
export function divergence(mark: number | null, oracle: number | null): number | null {
  if (mark === null || oracle === null || !(oracle > 0)) return null;
  return (mark - oracle) / oracle;
}
