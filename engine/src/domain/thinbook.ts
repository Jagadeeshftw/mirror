import { isBid } from './types.js';

/**
 * Thin-book guard: an opening copy is only sent when Perpl's book on the taking side holds at least
 * `multiple` x the order's lots at or better than the order's limit price. Otherwise the order is shrunk to
 * floor(depth / multiple) lots when that is at least one lot, or skipped. This protects followers from a
 * leader who trades into an empty book so that the copies fill against the leader's own resting orders.
 */

export type GuardDecision = 'ok' | 'shrunk' | 'skipped';
export type GuardReason = 'thin_book' | 'book_unavailable';

export interface BookLevel {
  p: number;
  s: number;
}

export interface GuardResult {
  decision: GuardDecision;
  reason: GuardReason | null;
  requestedLots: bigint;
  finalLots: bigint;
  depthLots: bigint | null;
  requiredLots: bigint;
  multipleBps: number;
}

/**
 * Lots available to an IOC of `orderType` limited at `limitPNS`: a bid takes asks priced <= limit, an ask
 * takes bids priced >= limit. Levels may be in any order.
 */
export function depthWithinLimit(levels: { bids: BookLevel[]; asks: BookLevel[] }, orderType: number, limitPNS: bigint): bigint {
  const bid = isBid(orderType);
  const side = bid ? levels.asks : levels.bids;
  let depth = 0n;
  for (const l of side) {
    const p = BigInt(l.p);
    if (l.s <= 0) continue;
    if (bid ? p <= limitPNS : p >= limitPNS) depth += BigInt(l.s);
  }
  return depth;
}

/** Multiple as basis points (2x = 20_000), at least 1x. */
export function multipleToBps(multiple: number): number {
  return Math.max(10_000, Math.round(multiple * 10_000));
}

/**
 * Decision for an order of `lots` given the measured `depth` (null when no book could be read).
 * required = ceil(lots x multiple); depth >= required passes unchanged; else shrink to floor(depth / multiple)
 * when that is >= 1 lot; else skip.
 */
export function thinBookDecision(lots: bigint, depth: bigint | null, multipleBps: number): GuardResult {
  const m = BigInt(multipleBps);
  const requiredLots = (lots * m + 9_999n) / 10_000n;
  const base = { requestedLots: lots, depthLots: depth, requiredLots, multipleBps };
  if (depth === null) return { ...base, decision: 'skipped', reason: 'book_unavailable', finalLots: 0n };
  if (depth >= requiredLots) return { ...base, decision: 'ok', reason: null, finalLots: lots };
  const shrunk = (depth * 10_000n) / m;
  if (shrunk >= 1n && shrunk < lots) return { ...base, decision: 'shrunk', reason: 'thin_book', finalLots: shrunk };
  return { ...base, decision: 'skipped', reason: 'thin_book', finalLots: 0n };
}

/** Feed label of an engine-side guard event. */
export function guardLabel(r: Pick<GuardResult, 'decision' | 'reason'>): string {
  if (r.decision === 'shrunk') return 'Shrunk: thin book';
  if (r.reason === 'book_unavailable') return 'Skipped: book unavailable';
  return 'Skipped: thin book';
}
