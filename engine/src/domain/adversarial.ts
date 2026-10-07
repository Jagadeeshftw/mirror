import { LONG, SHORT, isBid, type Side } from './types.js';

/** An executed opening keeper copy: the follower bought (long) or sold (short) at `fillPNS` in `block`. */
export interface FollowerOpenFill {
  leaderId: number;
  perpId: number;
  side: Side;
  fillPNS: bigint;
  block: number;
  leaderRef: string;
  timestamp: number | null;
}

/** A leader's own Perpl position event that reduced exposure (decrease, close, invert), with a price. */
export interface LeaderExit {
  leaderId: number;
  perpId: number;
  kind: 'decrease' | 'close' | 'invert';
  /** Side after the event (the closed side for close, the new side for invert). */
  positionType: Side;
  pricePNS: bigint;
  block: number;
  txHash: string;
  timestamp: number | null;
}

/** One copied leader fill: the leader's price, the last price before it, and how the followers filled. */
export interface CopiedLeaderFill {
  leaderId: number;
  perpId: number;
  leaderRef: string;
  /** Order type of the copies (same direction as the leader's trade). */
  orderType: number;
  leaderFillPNS: bigint | null;
  /** Last traded price in the market before the leader's transaction (null if unknown). */
  preTradePNS: bigint | null;
  /** Deviation (bps, positive = worse) of each follower copy of this fill. */
  deviationsBps: number[];
  timestamp: number | null;
}

export interface AdversarialOptions {
  exitBlocks: number;
  moveBps: number;
  worseBps: number;
  flagScore: number;
  minIncidents: number;
}

export interface AdversarialFlags {
  exitsIntoFollowers: number;
  bookMoving: number;
  lastSeen: number | null;
  /** 0..100: share of copied leader fills that were followed by an incident. */
  score: number;
  flagged: boolean;
  copiedFills: number;
}

export const NO_FLAGS: AdversarialFlags = { exitsIntoFollowers: 0, bookMoving: 0, lastSeen: null, score: 0, flagged: false, copiedFills: 0 };

/** Side whose exposure an exit reduced: the event side for decrease/close, the old side for invert. */
export const reducedSide = (e: Pick<LeaderExit, 'kind' | 'positionType'>): Side => (e.kind === 'invert' ? (e.positionType === LONG ? SHORT : LONG) : e.positionType);

/**
 * Rule (i), "exits into followers": the leader reduces or closes the same market within `exitBlocks` blocks
 * after followers' opening copies filled, at a price at or beyond their fills on their side (a long exit at
 * >= the followers' buy price, a short exit at <= their sell price), i.e. the leader sells into the followers'
 * buying. One incident per leader exit transaction.
 */
export function exitIncidents(fills: FollowerOpenFill[], exits: LeaderExit[], exitBlocks: number): LeaderExit[] {
  const out: LeaderExit[] = [];
  for (const e of exits) {
    const side = reducedSide(e);
    const hit = fills.some((f) =>
      f.leaderId === e.leaderId && f.perpId === e.perpId && f.side === side && f.leaderRef !== e.txHash &&
      e.block >= f.block && e.block <= f.block + exitBlocks &&
      (side === LONG ? e.pricePNS >= f.fillPNS : e.pricePNS <= f.fillPNS));
    if (hit) out.push(e);
  }
  return out;
}

/** Signed move of the leader's fill against the pre-trade price in the leader's trade direction, bps. */
export function leaderMoveBps(orderType: number, preTradePNS: bigint | null, leaderFillPNS: bigint | null): number | null {
  if (!preTradePNS || !leaderFillPNS || preTradePNS <= 0n) return null;
  const diff = isBid(orderType) ? leaderFillPNS - preTradePNS : preTradePNS - leaderFillPNS;
  return Number((diff * 10_000n) / preTradePNS);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(0.5 * s.length) - 1]! : null;
};

/**
 * Rule (ii), "moves the book": the leader's own fill moved the last price by more than `moveBps` in its trade
 * direction, and the followers' copies of that fill filled worse than the leader by more than `worseBps`
 * (median over the fill's copies).
 */
export function bookMovingIncidents(fills: CopiedLeaderFill[], moveBps: number, worseBps: number): CopiedLeaderFill[] {
  return fills.filter((f) => {
    const move = leaderMoveBps(f.orderType, f.preTradePNS, f.leaderFillPNS);
    const dev = median(f.deviationsBps);
    return move !== null && move > moveBps && dev !== null && dev > worseBps;
  });
}

/** Per-leader flags from the two rules. */
export function adversarialFlags(
  leaderId: number,
  input: { opens: FollowerOpenFill[]; exits: LeaderExit[]; copied: CopiedLeaderFill[] },
  o: AdversarialOptions,
): AdversarialFlags {
  const opens = input.opens.filter((f) => f.leaderId === leaderId);
  const exits = exitIncidents(opens, input.exits.filter((e) => e.leaderId === leaderId), o.exitBlocks);
  const copied = input.copied.filter((c) => c.leaderId === leaderId);
  const moving = bookMovingIncidents(copied, o.moveBps, o.worseBps);
  const incidents = exits.length + moving.length;
  const copiedFills = copied.length;
  const score = copiedFills ? Math.min(100, Math.round((100 * incidents) / copiedFills)) : 0;
  const times = [...exits.map((e) => e.timestamp), ...moving.map((m) => m.timestamp)].filter((t): t is number => t !== null);
  return {
    exitsIntoFollowers: exits.length,
    bookMoving: moving.length,
    lastSeen: times.length ? Math.max(...times) : null,
    score,
    flagged: score >= o.flagScore && incidents >= o.minIncidents,
    copiedFills,
  };
}
