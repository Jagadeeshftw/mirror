// Copy proof arithmetic for the copy detail: fill vs fill deviation, the entry-filter bound and
// how much of it a copy used. All prices are raw PNS integers; results are plain numbers for display.
import type { CopyProof } from "./types";

/** Buy side: open long or close short. A buy is worse when it pays more. */
export function isBuy(orderType: number): boolean {
  return orderType === 0 || orderType === 3;
}

/** Signed bps of `fill` vs `ref`, positive = follower got the worse price. null when ref is 0 (no leader fill). */
export function deviationBps(refPNS: string | bigint, fillPNS: string | bigint, orderType: number): number | null {
  const ref = BigInt(refPNS);
  const fill = BigInt(fillPNS);
  if (ref === 0n || fill === 0n) return null;
  const diff = isBuy(orderType) ? fill - ref : ref - fill;
  // two decimals of bps, rounded half away from zero
  const x = (diff * 1_000_000n) / ref;
  return Number(x) / 100;
}

/** Fill vs the leader's fill from the proof. */
export function fillDeviationBps(p: CopyProof, orderType: number): number | null {
  return deviationBps(p.leaderFillPNS, p.fillPNS, orderType);
}

/** Price difference in PNS units, positive = worse for the follower. null when either fill is unknown
 * (the contract records no fill price for closes: fillPNS = 0). */
export function worseByPNS(p: CopyProof, orderType: number): bigint | null {
  if (BigInt(p.fillPNS) === 0n || BigInt(p.leaderFillPNS) === 0n) return null;
  const d = BigInt(p.fillPNS) - BigInt(p.leaderFillPNS);
  return isBuy(orderType) ? d : -d;
}

/** Entry filter bound, rounded like the contract: up for longs' ceiling, down for shorts' floor. */
export function entryBoundPNS(leaderEntryPNS: string | bigint, maxEntryDeviationBps: number, long: boolean): bigint {
  const e = BigInt(leaderEntryPNS);
  const dev = BigInt(maxEntryDeviationBps);
  return long ? (e * (10_000n + dev)) / 10_000n : (e * (10_000n - dev) + 9_999n) / 10_000n;
}

/** Share of the entry allowance a copy used, 0..1+ (entryDeviationBps / maxEntryDeviationBps). */
export function entryUsed(p: CopyProof, maxEntryDeviationBps: number): number | null {
  if (!maxEntryDeviationBps) return null;
  return Math.max(0, p.entryDeviationBps) / maxEntryDeviationBps;
}

/** "+1.0" / "−0.7" for bps chips (true minus). */
export function bpsText(n: number | null | undefined, d = 1): string {
  if (n === null || n === undefined) return "—";
  const body = Math.abs(n).toFixed(d);
  return (n < 0 && Number(body) !== 0 ? "−" : "+") + body;
}
