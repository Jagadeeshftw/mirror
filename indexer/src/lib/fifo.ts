/**
 * FIFO lot attribution for follower positions.
 *
 * Each follower position (MirrorAccount's Perpl account + perp) keeps a queue of tranches
 * `{leaderId, lots}`, oldest first, whose lots always sum to the position size:
 *  - every Perpl opening leg on the follower pushes a tranche labelled UNATTRIBUTED ("0");
 *  - the Mirrored event that follows in the same transaction relabels the newest unattributed
 *    lots with the copied leader (owner/manual trades stay "0");
 *  - every reduction consumes the oldest lots first, and the realized PnL of that reduction is
 *    split across the consumed tranches pro rata by lots (Perpl realizes PnL against the average
 *    entry price, so a lot-weighted split of the exact realized amount is the consistent choice).
 */
import { UNATTRIBUTED_LEADER } from "./constants.js";

export type LotQueue = { readonly leaderIds: readonly string[]; readonly lots: readonly bigint[] };
export type Tranche = { leaderId: string; lots: bigint };

export const EMPTY_QUEUE: LotQueue = { leaderIds: [], lots: [] };

function toTranches(q: LotQueue): Tranche[] {
  return q.leaderIds.map((leaderId, i) => ({ leaderId, lots: q.lots[i] ?? 0n }));
}

function fromTranches(ts: readonly Tranche[]): LotQueue {
  const merged: Tranche[] = [];
  for (const t of ts) {
    if (t.lots <= 0n) continue;
    const last = merged[merged.length - 1];
    if (last && last.leaderId === t.leaderId) last.lots += t.lots;
    else merged.push({ ...t });
  }
  return { leaderIds: merged.map((t) => t.leaderId), lots: merged.map((t) => t.lots) };
}

export function totalLots(q: LotQueue): bigint {
  return q.lots.reduce((a, b) => a + b, 0n);
}

/** Append lots at the back of the queue. */
export function pushLots(q: LotQueue, leaderId: string, lots: bigint): LotQueue {
  if (lots <= 0n) return q;
  return fromTranches([...toTranches(q), { leaderId, lots }]);
}

/**
 * Remove `lots` from the front. Returns the consumed parts in FIFO order. If the queue holds fewer
 * lots than requested (history before indexing), the shortfall is reported as unattributed.
 */
export function consumeLots(q: LotQueue, lots: bigint): { queue: LotQueue; parts: Tranche[] } {
  const ts = toTranches(q);
  const parts: Tranche[] = [];
  let remaining = lots;
  while (remaining > 0n && ts.length > 0) {
    const head = ts[0]!;
    const take = head.lots < remaining ? head.lots : remaining;
    parts.push({ leaderId: head.leaderId, lots: take });
    head.lots -= take;
    remaining -= take;
    if (head.lots === 0n) ts.shift();
  }
  if (remaining > 0n) parts.push({ leaderId: UNATTRIBUTED_LEADER, lots: remaining });
  return { queue: fromTranches(ts), parts: toTranches(fromTranches(parts)) };
}

/**
 * Label the newest unattributed lots (up to `lots`) with `leaderId`, walking from the back of the
 * queue and stopping at the first attributed tranche. Returns the number of lots relabelled.
 */
export function attributeNewestLots(q: LotQueue, lots: bigint, leaderId: string): { queue: LotQueue; relabelled: bigint } {
  const ts = toTranches(q);
  let remaining = lots;
  let relabelled = 0n;
  for (let i = ts.length - 1; i >= 0 && remaining > 0n; i--) {
    const t = ts[i]!;
    if (t.leaderId !== UNATTRIBUTED_LEADER) break;
    if (t.lots <= remaining) {
      t.leaderId = leaderId;
      remaining -= t.lots;
      relabelled += t.lots;
    } else {
      // split: older part stays unattributed, newest `remaining` lots go to the leader
      ts.splice(i + 1, 0, { leaderId, lots: remaining });
      t.lots -= remaining;
      relabelled += remaining;
      remaining = 0n;
    }
  }
  return { queue: fromTranches(ts), relabelled };
}

/** Split `amount` across parts pro rata by lots; the last part takes the rounding remainder. */
export function allocateByLots(amount: bigint, parts: readonly Tranche[]): bigint[] {
  const total = parts.reduce((a, p) => a + p.lots, 0n);
  if (parts.length === 0) return [];
  if (total === 0n) return parts.map((_, i) => (i === parts.length - 1 ? amount : 0n));
  const out: bigint[] = [];
  let used = 0n;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) out.push(amount - used);
    else {
      const share = (amount * p.lots) / total;
      out.push(share);
      used += share;
    }
  });
  return out;
}
