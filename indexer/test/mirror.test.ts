import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { getAddress } from "viem";

import { ETH, LONG, MATCH_NOW, T0, Timeline, addr, chain143, usd } from "./helpers.js";

const OWNER = addr(0xa1);
const CLONE = getAddress(addr(0xc1));
const FOLLOWER = 500n;
const L1 = 100n;
const L2 = 200n;

/** Factory create, policy, deposit, Perpl account creation. */
function onboard(tl: Timeline, owner = OWNER, clone = CLONE, perplId = FOLLOWER) {
  tl.tx(T0 + 10).createMirror(owner, clone).mirror(clone, "OwnerInitialized", { owner });
  tl.tx(T0 + 20).policy(clone, [[L1, 5000n], [L2, 10000n]], [[ETH, usd(10_000)]]);
  tl.tx(T0 + 30)
    .mirror(clone, "Deposited", { from: owner, amount: usd(500), netDeposits: usd(500) })
    .perplAccountCreated(clone, perplId)
    .deposit(perplId, usd(500), usd(500))
    .mirror(clone, "PerplAccountCreated", { perplAccountId: perplId });
}

describe("Mirror accounts, copies and FIFO leader attribution", () => {
  it("indexes the full follower lifecycle", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    onboard(tl);

    // copy L1: open 300 lots @ 3000 (Perpl event first, Mirrored after, same tx)
    tl.tx(T0 + 100)
      .open(FOLLOWER, ETH, LONG, 300n, 300000n, { fee: 30n })
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 300n, price: 300500n, before: 0n, after: 300n });
    // copy L2: +200 lots, fill 3100 (avg entry 3040)
    tl.tx(T0 + 200)
      .increase(FOLLOWER, ETH, LONG, 300n, 500n, 304000n, { fee: 20n })
      .mirrored(CLONE, { leader: L2, perpId: ETH, orderType: 0n, lot: 200n, price: 310500n, before: 300n, after: 500n });
    // owner match-now for L1: +100 lots
    tl.tx(T0 + 300)
      .increase(FOLLOWER, ETH, LONG, 500n, 600n, 305000n, { fee: 10n })
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 311000n, before: 500n, after: 600n, ref: MATCH_NOW });
    // close 400 lots copying L1, realized +40: FIFO -> L1 300 lots (+30), L2 100 lots (+10)
    tl.tx(T0 + 400)
      .decrease(FOLLOWER, ETH, LONG, 600n, 200n, usd(40))
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 2n, lot: 400n, price: 314000n, before: 600n, after: 200n });
    // close the rest copying L2, realized -8: FIFO -> L2 100 lots (-4), L1 100 lots (-4)
    tl.tx(T0 + 500)
      .close(FOLLOWER, ETH, LONG, 301000n, usd(-8))
      .mirrored(CLONE, { leader: L2, perpId: ETH, orderType: 2n, lot: 200n, price: 301000n, before: 200n, after: 0n });
    // blocked copies
    tl.tx(T0 + 600).blocked(CLONE, { leader: L1, perpId: ETH, reason: 6n, limit: 1000n, actual: 2000n });
    tl.tx(T0 + 700).blocked(CLONE, { leader: L2, perpId: ETH, reason: 13n, limit: usd(50), actual: usd(60) });
    tl.tx(T0 + 800).mirror(CLONE, "Withdrawn", { to: OWNER, amount: usd(100), netDeposits: usd(400) });
    tl.tx(T0 + 900).mirror(CLONE, "ClosedAll", { slippageBps: 500n, positionsClosed: 0n });
    tl.tx(T0 + 1000).mirror(CLONE, "PausedSet", { paused: true });
    // drop L2 from the policy
    tl.tx(T0 + 1100).policy(CLONE, [[L1, 5000n]], [[ETH, usd(10_000)]]);

    const result = await indexer.process(chain143(tl.items));
    expect(result.changes.some((c) => (c as { addresses?: { sets: { address: string }[] } }).addresses?.sets.some((s) => s.address === CLONE))).toBe(true);

    // ---- MirrorAccount
    const ma = await indexer.MirrorAccount.getOrThrow(CLONE);
    expect(ma.owner).toBe(getAddress(OWNER));
    expect(ma.perplAccountId).toBe(FOLLOWER);
    expect(ma.leaderAccountIds).toEqual([L1]);
    expect([ma.maxLeverageHdths, ma.maxSlippageBps, ma.dailyLossBps, ma.drawdownBps]).toEqual([1000, 50, 500, 1000]);
    expect([ma.netDepositsCNS, ma.totalDepositedCNS, ma.totalWithdrawnCNS, ma.funded]).toEqual([usd(400), usd(500), usd(100), true]);
    expect([ma.copiesExecuted, ma.copiesBlocked, ma.matchNowCopies, ma.closeAllCount, ma.paused, ma.policyVersion]).toEqual([5, 2, 1, 1, true, 2]);
    expect(ma.teamRun).toBe(false);

    const perpl = await indexer.PerplAccount.getOrThrow(String(FOLLOWER));
    expect([perpl.isMirrorAccount, perpl.mirrorAccount_id, perpl.address]).toEqual([true, CLONE, CLONE]);

    // ---- copies
    const copies = (await indexer.CopyEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(copies.map((c) => c.isMatchNow)).toEqual([false, false, true, false, false]);
    expect(copies.map((c) => c.orderType)).toEqual(["OPEN_LONG", "OPEN_LONG", "OPEN_LONG", "CLOSE_LONG", "CLOSE_LONG"]);
    expect(copies.map((c) => c.filledLotsLNS)).toEqual([300n, 200n, 100n, 400n, 200n]);
    // fill price comes from the follower's Perpl event in the same tx, not the IOC limit
    expect(copies[0]!.fillPricePNS).toBe(300000n);
    expect(copies[1]!.fillPricePNS).toBe(310000n);
    expect(copies[0]!.notionalCNS).toBe(usd(900));
    expect(copies[4]!.fillPricePNS).toBe(301000n);

    // ---- blocked decoding
    const blocked = (await indexer.BlockedCopy.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(blocked.map((b) => [b.reason, b.reasonCode, b.limit, b.actual])).toEqual([
      ["LeverageTooHigh", 6, 1000n, 2000n],
      ["DrawdownStop", 13, usd(50), usd(60)],
    ]);
    expect((await indexer.BlockReasonCount.getOrThrow("global-LeverageTooHigh")).count).toBe(1);
    expect((await indexer.BlockReasonCount.getOrThrow("global-DrawdownStop")).count).toBe(1);

    // ---- FIFO attribution
    const p1 = await indexer.FollowerLeaderPnl.getOrThrow(`${CLONE}-${L1}`);
    const p2 = await indexer.FollowerLeaderPnl.getOrThrow(`${CLONE}-${L2}`);
    expect(p1.realizedPnlCNS).toBe(usd(26)); // +30 - 4
    expect(p2.realizedPnlCNS).toBe(usd(6)); // +10 - 4
    expect(p1.feesCNS).toBe(40n); // open fee 30 + match-now fee 10
    expect(p2.feesCNS).toBe(20n);
    expect(p1.netPnlCNS).toBe(usd(26) - 40n);
    expect([p1.copiedOpens, p1.copiedCloses, p2.copiedOpens, p2.copiedCloses]).toEqual([2, 1, 1, 1]);
    expect([p1.wins, p1.losses, p2.wins, p2.losses]).toEqual([1, 1, 1, 1]);
    expect(p1.realizedPnlCNS + p2.realizedPnlCNS).toBe(usd(32)); // equals the follower's realized PnL
    expect((await indexer.LeaderStats.getOrThrow(String(FOLLOWER))).realizedPnlCNS).toBe(usd(32));

    // ---- leader aggregates
    const l1 = await indexer.LeaderStats.getOrThrow(String(L1));
    const l2 = await indexer.LeaderStats.getOrThrow(String(L2));
    expect([l1.followers, l1.copiesExecuted, l1.copiesBlocked, l1.followerPnlCNS]).toEqual([1, 3, 1, usd(26)]);
    expect([l2.followers, l2.copiesExecuted, l2.copiesBlocked, l2.followerPnlCNS]).toEqual([0, 2, 1, usd(6)]);
    expect((await indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${L2}`)).active).toBe(false);
    expect((await indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${L1}`)).active).toBe(true);
    expect((await indexer.LeaderStats.getOrThrow(String(FOLLOWER))).isMirrorAccount).toBe(true);

    // ---- global stats
    const g = await indexer.GlobalStats.getOrThrow("global");
    expect([g.mirrorAccounts, g.fundedAccounts, g.pausedAccounts, g.netDepositsCNS]).toEqual([1, 1, 1, usd(400)]);
    expect([g.copiesExecuted, g.copiesBlocked, g.matchNowCopies, g.closeAllCount, g.policyUpdates]).toEqual([5, 2, 1, 1, 2]);
    expect(g.followerRealizedPnlCNS).toBe(usd(32));
    expect(await indexer.TeamRunStats.get("teamRun")).toBeUndefined();

    // ---- unified feed
    const feed = (await indexer.MirrorActivity.getAll()).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    expect(feed.map((f) => f.kind)).toEqual([
      "CREATED", "POLICY_UPDATED", "DEPOSITED", "PERPL_ACCOUNT_CREATED",
      "MIRRORED", "MIRRORED", "MIRRORED", "MIRRORED", "MIRRORED",
      "BLOCKED", "BLOCKED", "WITHDRAWN", "CLOSED_ALL", "PAUSED", "POLICY_UPDATED",
    ]);
  });

  it("excludes team-run accounts from public stats and leader follower counts", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const teamOwner = addr(0xd1); // in ENVIO_TEAM_RUN_ADDRESSES
    const teamClone = getAddress(addr(0xc2));
    onboard(tl, teamOwner, teamClone, 600n);
    tl.tx(T0 + 100)
      .open(600n, ETH, LONG, 100n, 300000n)
      .mirrored(teamClone, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300500n, before: 0n, after: 100n });
    tl.tx(T0 + 200).blocked(teamClone, { leader: L1, perpId: ETH, reason: 2n, limit: 0n, actual: 0n });
    // and a regular user
    onboard(tl, addr(0xa2), getAddress(addr(0xc3)), 601n);
    await indexer.process(chain143(tl.items));

    const team = await indexer.MirrorAccount.getOrThrow(teamClone);
    expect(team.teamRun).toBe(true);
    expect((await indexer.PerplAccount.getOrThrow("600")).teamRun).toBe(true);

    const g = await indexer.GlobalStats.getOrThrow("global");
    const tr = await indexer.TeamRunStats.getOrThrow("teamRun");
    expect([g.mirrorAccounts, g.fundedAccounts, g.copiesExecuted, g.copiesBlocked, g.netDepositsCNS]).toEqual([1, 1, 0, 0, usd(500)]);
    expect([tr.mirrorAccounts, tr.fundedAccounts, tr.copiesExecuted, tr.copiesBlocked, tr.netDepositsCNS]).toEqual([1, 1, 1, 1, usd(500)]);
    expect((await indexer.BlockReasonCount.getOrThrow("teamRun-Expired")).count).toBe(1);
    expect(await indexer.BlockReasonCount.get("global-Expired")).toBeUndefined();

    // only the regular follower counts toward the leader's followers; team copies are not leader traction
    const l1 = await indexer.LeaderStats.getOrThrow(String(L1));
    expect([l1.followers, l1.copiesExecuted, l1.copiesBlocked]).toEqual([1, 0, 0]);
  });
});
