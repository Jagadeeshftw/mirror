/** One leader position event, from the engine's perpl_events or the indexer's PositionEvent. */
export interface TradeEvent {
  /** Unix seconds. */
  t: number;
  perpId: number;
  /** open | increase | decrease | close | invert | liquidate | deleverage (indexer kinds are mapped onto these). */
  kind: string;
  /** Position size after the event; null when unknown. */
  lotsAfter: bigint | null;
  /** Realised PnL of the event (closing kinds), collateral units; null when none. */
  pnlCNS: bigint | null;
}

export interface TradeStats {
  /** Gross realised profit / gross realised loss; null without a loss (undefined ratio). */
  profitFactor: number | null;
  grossProfitCNS: string;
  grossLossCNS: string;
  /** Most negative single realised PnL (0 when there was no losing close). */
  largestLossCNS: string;
  /** Mean time from flat to flat again per market, seconds; null without a completed round trip. */
  avgHoldSec: number | null;
  roundTrips: number;
}

const INDEXER_KINDS: Record<string, string> = { liquidation: 'liquidate' };
export const normalizeKind = (k: string) => {
  const s = String(k).toLowerCase();
  return INDEXER_KINDS[s] ?? s;
};

const REALIZING = new Set(['decrease', 'close', 'invert', 'liquidate', 'deleverage']);

/** Profit factor, largest loss and average holding time from a leader's position events (any order). */
export function tradeStats(events: TradeEvent[]): TradeStats {
  const evs = [...events].sort((a, b) => a.t - b.t);
  let profit = 0n;
  let loss = 0n;
  let largest = 0n;
  const openedAt = new Map<number, number>();
  const holds: number[] = [];
  for (const e of evs) {
    const kind = normalizeKind(e.kind);
    if (REALIZING.has(kind) && e.pnlCNS !== null) {
      if (e.pnlCNS > 0n) profit += e.pnlCNS;
      if (e.pnlCNS < 0n) {
        loss -= e.pnlCNS;
        if (e.pnlCNS < largest) largest = e.pnlCNS;
      }
    }
    const flat = kind === 'close' || e.lotsAfter === 0n;
    const start = openedAt.get(e.perpId);
    if (kind === 'invert') {
      // The old position is closed and a new one opened in the same event.
      if (start !== undefined) holds.push(e.t - start);
      openedAt.set(e.perpId, e.t);
    } else if (flat) {
      if (start !== undefined) holds.push(e.t - start);
      openedAt.delete(e.perpId);
    } else if (start === undefined && (kind === 'open' || kind === 'increase')) {
      openedAt.set(e.perpId, e.t);
    }
  }
  return {
    profitFactor: loss > 0n ? Math.round((Number(profit) / Number(loss)) * 100) / 100 : null,
    grossProfitCNS: profit.toString(),
    grossLossCNS: loss.toString(),
    largestLossCNS: largest.toString(),
    avgHoldSec: holds.length ? Math.round(holds.reduce((s, x) => s + x, 0) / holds.length) : null,
    roundTrips: holds.length,
  };
}
