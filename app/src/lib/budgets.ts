// Several leaders in one MirrorAccount: per-leader books (budget, margin used, PnL, loss stop), the deposit
// split and its validation, and the Policy every multi-leader action signs. Pure functions; screens never
// assemble a multi-leader Policy by hand.
//
// Contract facts (contracts/src/MirrorAccount.sol): up to 4 leaders, each with ratioBps, budgetCNS (margin its
// positions may hold) and lossStopBps (of the budget; realised since added + unrealised). A market belongs to
// the leader whose copy opened it. A new policy re-arms every stopped leader it keeps.
import { ausd, shortAddr } from "./format";
import { signablePolicy } from "./levels";
import type { Address, LeaderRule, MarketRule, MirrorAccount, Policy, Position } from "./types";

export const MAX_LEADERS = 4;
const BPS = 10_000n;
const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0") || "0");
  } catch {
    return 0n;
  }
};

export type LeaderStatus = "copying" | "paused" | "stopped" | "unfollowed";

export interface LeaderBook {
  account: Address;
  leaderId: number;
  ratioBps: number;
  budgetCNS: bigint;
  lossStopBps: number;
  marginCNS: bigint;
  unrealisedCNS: bigint;
  realisedCNS: bigint;
  /** Realised since added (or re-armed) + unrealised: what the leader's loss stop is checked against. */
  pnlCNS: bigint;
  stopped: boolean;
  /** Positions held for this leader (MirrorAccount.marketLeader). */
  positions: Position[];
  /** lossStopBps x budget (0 when the stop is off). */
  lossLimitCNS: bigint;
  /** Budget minus the loss limit: the leader stops when budget + PnL falls below it. */
  stopAtCNS: bigint;
  /** How much more it can lose before the stop (negative once past it). */
  lossLeftCNS: bigint;
  status: LeaderStatus;
  inPolicy: boolean;
}

const lossLimit = (budget: bigint, bps: number) => (budget * BigInt(Math.max(0, bps))) / BPS;

/** Leader ids of an account's policy (the engine's `leader` when the policy is missing). */
export function policyLeaderIds(a: Pick<MirrorAccount, "policy" | "leader">): number[] {
  return a.policy?.leaders?.length ? a.policy.leaders.map((l) => Number(l.accountId)) : a.leader ? [a.leader.accountId] : [];
}

export const isMultiLeader = (a: Pick<MirrorAccount, "policy" | "leader" | "positions">) => policyLeaderIds(a).length > 1 || unfollowedIds(a).length > 0;

/** Leaders whose positions are still in the account although they left the policy ("keep its positions"). */
export function unfollowedIds(a: Pick<MirrorAccount, "policy" | "leader" | "positions">): number[] {
  const ids = new Set(policyLeaderIds(a));
  if (ids.size === 0) return [];
  return [...new Set(a.positions.map((p) => Number(p.leaderAccountId)).filter((id) => id > 0 && !ids.has(id)))];
}

/** One book per policy leader, then one per leader that was removed but still has positions here. */
export function leaderBooks(a: MirrorAccount): LeaderBook[] {
  const ids = policyLeaderIds(a);
  const only = ids.length <= 1 && unfollowedIds(a).length === 0;
  const make = (id: number, rule: (LeaderRule & { stopped?: boolean }) | undefined): LeaderBook => {
    const attr = a.pnl?.byLeader?.find((x) => Number(x.leaderAccountId) === id);
    const positions = a.positions.filter((p) => only || Number(p.leaderAccountId) === id);
    const marginFromPositions = positions.reduce((s, p) => s + big(p.marginCNS), 0n);
    const unrealFromPositions = positions.reduce((s, p) => s + big(p.upnlCNS), 0n);
    const budgetCNS = big(rule?.budgetCNS ?? attr?.budgetCNS ?? 0);
    const marginCNS = attr?.marginCNS !== undefined && big(attr.marginCNS) > 0n ? big(attr.marginCNS) : marginFromPositions;
    const unrealisedCNS = attr ? big(attr.unrealisedCNS) : unrealFromPositions;
    const realisedCNS = attr ? big(attr.realisedCNS) : 0n;
    const pnlCNS = realisedCNS + unrealisedCNS;
    const lossStopBps = Number(rule?.lossStopBps ?? 0);
    const limit = lossLimit(budgetCNS, lossStopBps);
    const stopped = !!(attr?.stopped ?? rule?.stopped);
    const inPolicy = !!rule;
    const status: LeaderStatus = !inPolicy || a.detached ? "unfollowed" : stopped ? "stopped" : a.paused ? "paused" : "copying";
    return {
      account: a.account, leaderId: id, ratioBps: Number(rule?.ratioBps ?? 0), budgetCNS, lossStopBps, marginCNS, unrealisedCNS, realisedCNS, pnlCNS, stopped, positions,
      lossLimitCNS: limit, stopAtCNS: budgetCNS - limit, lossLeftCNS: limit + pnlCNS, status, inPolicy,
    };
  };
  const rules = (a.policy?.leaders ?? []) as (LeaderRule & { stopped?: boolean })[];
  const out = ids.map((id) => make(id, rules.find((r) => Number(r.accountId) === id)));
  for (const id of unfollowedIds(a)) out.push(make(id, undefined));
  return out;
}

/** The account (if any) whose policy follows `leaderId`, with that leader's book. */
export function findFollow(accounts: MirrorAccount[] | undefined, leaderId: number): { account: MirrorAccount; book: LeaderBook } | null {
  for (const a of accounts ?? []) {
    if (!policyLeaderIds(a).includes(Number(leaderId))) continue;
    const book = leaderBooks(a).find((b) => b.leaderId === Number(leaderId));
    if (book) return { account: a, book };
  }
  return null;
}

/** An account that left `leaderId` but still holds its positions ("Stopped following"). */
export function findUnfollowed(accounts: MirrorAccount[] | undefined, leaderId: number): { account: MirrorAccount; book: LeaderBook } | null {
  for (const a of accounts ?? []) {
    if (!unfollowedIds(a).includes(Number(leaderId))) continue;
    const book = leaderBooks(a).find((b) => b.leaderId === Number(leaderId));
    if (book) return { account: a, book };
  }
  return null;
}

/** Accounts a new leader can join: deployed, with a policy, fewer than 4 leaders, not following it yet. */
export function splitTargets(accounts: MirrorAccount[] | undefined, leaderId: number): MirrorAccount[] {
  return (accounts ?? []).filter((a) => a.deployed && !a.teamRun && !!a.policy && a.policy.leaders.length < MAX_LEADERS && !policyLeaderIds(a).includes(Number(leaderId)));
}

// ---------------------------------------------------------------- the split
export interface SplitRow {
  accountId: number;
  budgetCNS: bigint;
  ratioBps: number;
  lossStopBps: number;
  /** Margin its positions hold now: the budget can't go below it. */
  marginCNS?: bigint;
  isNew?: boolean;
  stopped?: boolean;
}

export function splitTotals(depositCNS: bigint, rows: Pick<SplitRow, "budgetCNS">[]) {
  const assigned = rows.reduce((s, r) => s + r.budgetCNS, 0n);
  return { depositCNS, assigned, unassigned: depositCNS - assigned };
}

export interface SplitIssue {
  field: "leaders" | "budget" | "total" | "ratio" | "lossStop" | "topUp";
  leaderId?: number;
  message: string;
}

export interface SplitInput {
  /** Net deposits already in the account. */
  depositCNS: bigint;
  rows: SplitRow[];
  /** AUSD added by permit in the same approval. */
  topUpCNS?: bigint;
  walletCNS?: bigint;
  capCNS?: bigint;
  name?: (leaderId: number) => string;
}

/** Everything that must hold before the split can be signed (the contract checks the rest). */
export function validateSplit(s: SplitInput): SplitIssue[] {
  const out: SplitIssue[] = [];
  const name = s.name ?? ((id: number) => `Perpl #${id}`);
  const topUp = s.topUpCNS ?? 0n;
  if (s.rows.length === 0) out.push({ field: "leaders", message: "Follow at least one leader" });
  if (s.rows.length > MAX_LEADERS) out.push({ field: "leaders", message: `One account follows at most ${MAX_LEADERS} leaders` });
  const seen = new Set<number>();
  for (const r of s.rows) {
    if (seen.has(r.accountId)) out.push({ field: "leaders", leaderId: r.accountId, message: `${name(r.accountId)} is in the split twice` });
    seen.add(r.accountId);
    if (r.budgetCNS <= 0n) out.push({ field: "budget", leaderId: r.accountId, message: `Give ${name(r.accountId)} a budget above 0` });
    else if (r.marginCNS !== undefined && r.budgetCNS < r.marginCNS) out.push({ field: "budget", leaderId: r.accountId, message: `${name(r.accountId)} uses ${ausd(r.marginCNS)} margin now, so its budget can't go below ${ausd(r.marginCNS)}` });
    if (r.ratioBps < 1 || r.ratioBps > 10_000) out.push({ field: "ratio", leaderId: r.accountId, message: "Sizing between 0.01% and 100%" });
    if (r.lossStopBps < 0 || r.lossStopBps > 10_000) out.push({ field: "lossStop", leaderId: r.accountId, message: "Loss stop between 0% (off) and 100%" });
  }
  if (topUp < 0n) out.push({ field: "topUp", message: "Enter an amount" });
  if (s.walletCNS !== undefined && topUp > s.walletCNS) out.push({ field: "topUp", message: "More than your wallet balance" });
  if (s.capCNS !== undefined && s.depositCNS + topUp > s.capCNS) out.push({ field: "topUp", message: `Beta limit is ${ausd(s.capCNS)} AUSD per account` });
  const t = splitTotals(s.depositCNS + topUp, s.rows);
  if (t.unassigned < 0n) out.push({ field: "total", message: `Budgets add up to ${ausd(t.assigned)}, ${ausd(-t.unassigned)} more than your ${ausd(t.depositCNS)} AUSD deposit. Lower a budget${s.walletCNS ? " or add to the deposit" : ""}.` });
  return out;
}

/** Split rows of an account's current leaders (stopped and margin read from their books). */
export function currentSplit(a: MirrorAccount): SplitRow[] {
  return leaderBooks(a)
    .filter((b) => b.inPolicy)
    .map((b) => ({ accountId: b.leaderId, budgetCNS: b.budgetCNS, ratioBps: b.ratioBps, lossStopBps: b.lossStopBps, marginCNS: b.marginCNS, stopped: b.stopped }));
}

/**
 * Current leaders plus the new one, which starts with whatever is not assigned yet. With nothing unassigned it
 * proposes half (whole AUSD) of the unused budget of the leader with the most unused budget; the sheet shows the
 * proposal in the split before anything is signed.
 */
export function splitWithNewLeader(a: MirrorAccount, leaderId: number, ratioBps: number, lossStopBps: number, topUpCNS = 0n): SplitRow[] {
  const rows = currentSplit(a);
  const free = splitTotals(big(a.netDepositsCNS) + topUpCNS, rows).unassigned;
  let budget = free > 0n ? free : 0n;
  if (budget === 0n) {
    const idle = (r: SplitRow) => (r.stopped ? 0n : r.budgetCNS - (r.marginCNS ?? 0n));
    const donor = rows.reduce<SplitRow | null>((best, r) => (idle(r) > (best ? idle(best) : 0n) ? r : best), null);
    const move = donor ? (idle(donor) / 2n / 1_000_000n) * 1_000_000n : 0n;
    if (donor && move > 0n) {
      donor.budgetCNS -= move;
      budget = move;
    }
  }
  return [...rows, { accountId: leaderId, budgetCNS: budget, ratioBps, lossStopBps, marginCNS: 0n, isNew: true }];
}

/**
 * The Policy to sign: account-wide limits from `base` (the account's policy, or the follow form's), every
 * leader from `rows`, and the base markets plus any `extraMarkets` (existing caps win).
 */
export function buildSplitPolicy(base: Policy, rows: Pick<SplitRow, "accountId" | "budgetCNS" | "ratioBps" | "lossStopBps">[], extraMarkets: MarketRule[] = []): Policy {
  const p = signablePolicy(base);
  const markets = [...p.markets];
  for (const m of extraMarkets) if (!markets.some((x) => Number(x.perpId) === Number(m.perpId))) markets.push({ perpId: Number(m.perpId), maxNotionalCNS: String(m.maxNotionalCNS) });
  return {
    ...p,
    leaders: rows.map((r) => ({ accountId: Number(r.accountId), ratioBps: Math.round(r.ratioBps), budgetCNS: r.budgetCNS.toString(), lossStopBps: Math.round(r.lossStopBps) })),
    markets,
  };
}

/** Re-arm: the same limits signed again (the contract clears `stopped` and the leader's loss record). */
export function rearmPolicy(a: Pick<MirrorAccount, "policy">, leaderId?: number, lossStopBps?: number): Policy | null {
  if (!a.policy) return null;
  const p = signablePolicy(a.policy);
  if (leaderId === undefined || lossStopBps === undefined) return p;
  return { ...p, leaders: p.leaders.map((l) => (l.accountId === leaderId ? { ...l, lossStopBps } : l)) };
}

// ---------------------------------------------------------------- market ownership
export interface HeldMarket {
  perpId: number;
  holder: number;
}

/** Markets the account holds for another leader among `perpIds` (a new leader's copies there are blocked). */
export function heldByOthers(a: Pick<MirrorAccount, "positions">, leaderId: number, perpIds: number[]): HeldMarket[] {
  const want = new Set(perpIds.map(Number));
  const out: HeldMarket[] = [];
  for (const p of a.positions) {
    const holder = Number(p.leaderAccountId);
    if (!want.has(Number(p.perpId)) || !holder || holder === Number(leaderId)) continue;
    if (!out.some((x) => x.perpId === Number(p.perpId))) out.push({ perpId: Number(p.perpId), holder });
  }
  return out;
}

/** "BTC is held by 0x7a3f…c91e, so this leader's BTC trades are blocked until it closes." */
export function ownershipSentence(held: HeldMarket[], symbol: (perpId: number) => string, holderName: (leaderId: number) => string): string {
  const general = "A market belongs to the leader whose copy opened it.";
  if (!held.length) return `${general} You hold nothing this leader trades, so none of its trades wait on another leader.`;
  const byHolder = new Map<number, string[]>();
  for (const h of held) byHolder.set(h.holder, [...(byHolder.get(h.holder) ?? []), symbol(h.perpId)]);
  const parts = [...byHolder.entries()].map(([holder, syms]) => {
    const list = syms.length > 1 ? `${syms.slice(0, -1).join(", ")} and ${syms.at(-1)}` : syms[0];
    return `${list} ${syms.length > 1 ? "are" : "is"} held by ${holderName(holder)}, so this leader's ${list} trades are blocked until ${syms.length > 1 ? "they close" : "it closes"}.`;
  });
  return `${general} ${parts.join(" ")}`;
}

export const leaderLabel = (address: string | undefined | null, id: number) => (address ? shortAddr(address) : `Perpl #${id}`);
