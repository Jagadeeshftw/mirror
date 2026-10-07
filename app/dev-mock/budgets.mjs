// Several leaders in one MirrorAccount in the dev mock (scenario "multi"): one 24 AUSD account following
// 0x7a3f…c91e (12), 0x19be…04d2 (8) and 0xc4e0…7b13 (4, stopped by its loss stop), as in the design
// (#leaders-budget). Also the per-leader book the engine serves (views.ts pnlByLeader from leaderBook:
// marginCNS, budgetCNS, stopped) and the contract's leader rules the mock relay applies:
// MarketHeldByOtherLeader, LeaderBudgetExceeded, LeaderLossStop, and re-arm on a new policy.
import { getAddress, toHex } from "viem";
import { bySymbol, leaderById, lns, pns } from "./data.mjs";

const cs = (a) => getAddress(a);
const BPS = 10_000n;
const DAY = 86_400_000;

/** leaderBook(leader) for every policy leader: margin and unrealised of the markets it holds, realised, stopped. */
export function leaderBooks(a, { marginOf, upnl }) {
  const stopped = (a.stoppedLeaders ??= new Set());
  return (a.policy?.leaders ?? []).map((l) => {
    const mine = a.positions.filter((p) => p.leaderAccountId === l.accountId);
    return {
      leaderAccountId: l.accountId,
      marginCNS: mine.reduce((s, p) => s + marginOf(p), 0n),
      unrealisedCNS: mine.reduce((s, p) => s + upnl(p), 0n),
      realisedCNS: a.realisedByLeader.get(l.accountId) ?? 0n,
      budgetCNS: BigInt(l.budgetCNS),
      stopped: stopped.has(l.accountId),
    };
  });
}

/** MirrorAccount._setPolicy: a newly added or re-armed (kept while stopped) leader starts with a clean record. */
export function applyPolicyLeaders(a, oldLeaders, newLeaders) {
  const stopped = (a.stoppedLeaders ??= new Set());
  for (const l of newLeaders) {
    const kept = oldLeaders.some((o) => o.accountId === l.accountId);
    if (!kept || stopped.has(l.accountId)) {
      a.realisedByLeader.set(l.accountId, 0n);
      stopped.delete(l.accountId);
    }
  }
}

/** The contract's leader checks for an opening copy (after leverage / notional): null when it may open. */
export function leaderBlock(a, o, { marginOf, upnl, notionalAt }) {
  const id = Number(o.leaderAccountId);
  const rule = a.policy?.leaders.find((l) => l.accountId === id);
  if (!rule) return { reason: "LeaderNotAllowed", limit: "0", actual: String(id) };
  if ((a.stoppedLeaders ??= new Set()).has(id)) return { reason: "LeaderLossStop", limit: "0", actual: "0" };
  const held = a.positions.find((p) => p.perpId === Number(o.perpId) && p.leaderAccountId !== id);
  if (held) return { reason: "MarketHeldByOtherLeader", limit: String(id), actual: String(held.leaderAccountId) };
  const book = leaderBooks(a, { marginOf, upnl }).find((b) => b.leaderAccountId === id);
  const add = (notionalAt(Number(o.perpId), BigInt(o.lotLNS)) * 100n) / BigInt(Math.max(100, Number(o.leverageHdths)));
  if (book.marginCNS + add > book.budgetCNS) return { reason: "LeaderBudgetExceeded", limit: book.budgetCNS.toString(), actual: (book.marginCNS + add).toString() };
  return null;
}

/** Scenario "multi": the design's Home with leaders, budgets, margin used, PnL and one leader stopped. */
export function seedMulti(owner, h) {
  const { newAccount, policyFor, ev, equity, pos } = h;
  const A = leaderById[1043], B = leaderById[877], C = leaderById[1588];
  const p = policyFor(A.accountId, { lev: 500, ratio: 1, mk: ["BTC", "SOL", "ETH", "HYPE"], cap: 12_000_000n });
  p.leaders = [
    { accountId: A.accountId, ratioBps: 1, budgetCNS: "12000000", lossStopBps: 1500 },
    { accountId: B.accountId, ratioBps: 1, budgetCNS: "8000000", lossStopBps: 1000 },
    { accountId: C.accountId, ratioBps: 1, budgetCNS: "4000000", lossStopBps: 1500 },
  ];
  const a = newAccount(owner, toHex(0n, { size: 32 }), {
    perplAccountId: 12841, collateral: 23_820_000n, netDeposits: 24_000_000n, actionNonce: 4n, leaderAccountId: A.accountId, policy: p,
    positions: [pos("BTC", "long", 0.0001, 117880.0, 400, A.accountId), pos("SOL", "long", 0.047, 198.1, 300, A.accountId), pos("ETH", "short", 0.002, 4350.0, 300, B.accountId)],
    createdAt: Date.now() - 21 * DAY,
  });
  a.realisedByLeader.set(A.accountId, 120_000n);
  a.realisedByLeader.set(B.accountId, 0n);
  a.realisedByLeader.set(C.accountId, -600_000n);
  a.stoppedLeaders = new Set([C.accountId]);
  a.todayStart = equity(a) - 210_000n;
  a.hwm = equity(a) + 50_000n;
  const L = (x) => ({ leaderAccountId: x.accountId, leaderAddress: cs(x.address) });
  const order = (sym, side, open) => ({ perpId: bySymbol[sym].perpId, orderType: open ? (side === "long" ? 0 : 1) : side === "long" ? 2 : 3 });
  const mir = (x, age, sym, side, open, lotsF, pxF, lev, extra = {}) =>
    ev(a, "Mirrored", { ...L(x), ...order(sym, side, open), lotLNS: lns(sym, lotsF).toString(), pricePNS: pns(sym, pxF).toString(), leverageHdths: lev, notionalCNS: ((lns(sym, lotsF) * pns(sym, pxF) * 10n ** 6n) / 10n ** BigInt(bySymbol[sym].lotDecimals + bySymbol[sym].priceDecimals)).toString(), latencyMs: 610, ...extra }, age, "finalized");
  const blk = (x, age, sym, side, lotsF, pxF, lev, reason, limit, actual) =>
    ev(a, "Blocked", { ...L(x), ...order(sym, side, true), lotLNS: lns(sym, lotsF).toString(), pricePNS: pns(sym, pxF).toString(), leverageHdths: lev, leaderLotLNS: lns(sym, lotsF * 100).toString(), leaderLeverageHdths: lev, blocked: { reason, reasonCode: 0, limit: String(limit), actual: String(actual) } }, age, "finalized");
  ev(a, "Deposited", { amountCNS: "24000000" }, 21 * DAY);
  ev(a, "Followed", L(A), 21 * DAY - 60_000);
  ev(a, "PolicyUpdated", L(B), 9 * DAY);
  ev(a, "PolicyUpdated", L(C), 3 * DAY);
  mir(A, 2 * 3600e3, "SOL", "long", true, 0.047, 198.1, 300);
  mir(B, 38 * 60e3, "ETH", "short", true, 0.002, 4350.0, 300);
  // C's HYPE long fell 15% below its budget: a stranger executed its leader loss stop (reduce-only).
  mir(C, 2 * DAY, "HYPE", "long", true, 0.1, 46.92, 500);
  mir(C, DAY - 60_000, "HYPE", "long", false, 0.1, 41.12, 0, { realisedPnlCNS: "-580000" });
  ev(a, "LeaderStopped", { ...L(C), limit: "600000", actual: "-600000", data: { pnlCNS: "-600000", limitCNS: "600000" } }, DAY, "finalized");
  ev(a, "StopTriggered", { ...L(C), reason: "LeaderLoss", keeper: h.STRANGER, limit: "600000", actual: "600000", data: { kind: "LeaderLoss", scope: C.accountId, caller: h.STRANGER, limit: "600000", actual: "600000", oraclePNS: "0", closed: "1" } }, DAY - 30_000, "finalized");
  blk(B, 25 * 60e3, "BTC", "long", 0.0001, 118390.0, 300, "MarketHeldByOtherLeader", B.accountId, A.accountId);
  blk(B, 12 * 60e3, "ETH", "short", 0.004, 4352.0, 300, "LeaderBudgetExceeded", 8_000_000, 8_420_000);
  blk(C, 6 * 60e3, "SOL", "long", 0.05, 199.2, 300, "LeaderLossStop", 0, 0);
  mir(A, 4e3, "BTC", "long", true, 0.0001, 117880.0, 400);
  a.feed.sort((x, y) => y.timestamp - x.timestamp);
  return [a];
}
