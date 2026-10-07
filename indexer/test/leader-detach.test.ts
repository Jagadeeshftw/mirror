import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { getAddress } from "viem";

import { BLOCK_REASONS, blockReason } from "../src/lib/constants.js";
import { ETH, T0, Timeline, addr, chain143, usd } from "./helpers.js";

const OWNER = addr(0xa1);
const CLONE = getAddress(addr(0xc1));
const FOLLOWER = 500n;
const L1 = 100n;
const L2 = 200n;

function onboard(tl: Timeline, leaders: bigint[]) {
  tl.tx(T0 + 10).createMirror(OWNER, CLONE).mirror(CLONE, "OwnerInitialized", { owner: OWNER });
  tl.tx(T0 + 20).policy(CLONE, leaders.map((l) => [l, 5000n] as [bigint, bigint]), [[ETH, usd(10_000)]]);
  tl.tx(T0 + 30)
    .mirror(CLONE, "Deposited", { from: OWNER, amount: usd(500), netDeposits: usd(500) })
    .perplAccountCreated(CLONE, FOLLOWER)
    .deposit(FOLLOWER, usd(500), usd(500))
    .mirror(CLONE, "PerplAccountCreated", { perplAccountId: FOLLOWER });
}

const detach = (tl: Timeline, leader: bigint, detached: boolean) =>
  tl.mirror(CLONE, "LeaderDetachedSet", { leaderAccountId: leader, detached });

describe("leader detach", () => {
  it("maps BlockReason 22 to LeaderDetached", () => {
    expect(BLOCK_REASONS.length).toBe(23);
    expect(blockReason(21)).toBe("BuilderFeeTooHigh");
    expect(blockReason(22)).toBe("LeaderDetached");
    expect(blockReason(23)).toBe("Unknown");
  });

  it("sets and clears the flag, records events, keeps it across setPolicy and clears it on removal and follow", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    onboard(tl, [L1, L2]);
    const rule = (l: bigint) => indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${l}`);

    // 1. Owner detaches L1.
    detach(tl.tx(T0 + 100), L1, true);
    const detachTx = tl.txHash;
    // 2. A copy naming L1 is refused (limit 0, actual = leader id).
    tl.tx(T0 + 110).blocked(CLONE, { leader: L1, perpId: ETH, reason: 22n, limit: 0n, actual: L1, orderType: 2n });
    // 3. setPolicy keeping L1 (new ratio) keeps the flag.
    tl.tx(T0 + 120).policy(CLONE, [[L1, 2500n], [L2, 5000n]], [[ETH, usd(10_000)]]);
    await indexer.process(chain143(tl.items));

    const r1 = await rule(L1);
    expect([r1.detached, r1.detachedAt, r1.detachCount, r1.active, r1.ratioBps]).toEqual([true, T0 + 100, 1, true, 2500]);
    expect((await rule(L2)).detached).toBe(false);
    const ma = await indexer.MirrorAccount.getOrThrow(CLONE);
    expect(ma.detachedLeaderAccountIds).toEqual([L1]);

    const ev = await indexer.LeaderDetachEvent.getOrThrow(`${detachTx}-0`);
    expect([ev.mirrorAccount_id, ev.leaderAccountId, ev.leader_id, ev.detached, ev.teamRun, ev.timestamp, ev.txHash, ev.logIndex]).toEqual([
      CLONE, L1, String(L1), true, false, T0 + 100, detachTx, 0,
    ]);

    const blocked = await indexer.BlockedCopy.getAll();
    expect(blocked.map((b) => [b.reason, b.reasonCode, b.limit, b.actual, b.orderType])).toEqual([["LeaderDetached", 22, 0n, L1, "CLOSE_LONG"]]);
    expect((await indexer.BlockReasonCount.getOrThrow("global-LeaderDetached")).count).toBe(1);

    const kinds = (await indexer.MirrorActivity.getAll()).map((a) => a.kind);
    expect(kinds).toContain("LEADER_DETACHED");

  });

  it("clears the flag when the leader is removed from the policy and when follow() lists it", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    onboard(tl, [L1, L2]);
    const rule = (l: bigint) => indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${l}`);
    detach(tl.tx(T0 + 100), L1, true);
    // Removing L1 from the policy clears it (the contract emits the clear before PolicyUpdated).
    tl.tx(T0 + 200);
    detach(tl, L1, false).policy(CLONE, [[L2, 5000n]], [[ETH, usd(10_000)]]);
    // Detach L2, then follow() listing L2 and L1 again: PolicyUpdated, then the clear for L2, then Followed.
    detach(tl.tx(T0 + 300), L2, true);
    tl.tx(T0 + 400).policy(CLONE, [[L2, 5000n], [L1, 5000n]], [[ETH, usd(10_000)]]);
    detach(tl, L2, false).mirror(CLONE, "Followed", { matchOrders: 0n, matchesExecuted: 0n });
    await indexer.process(chain143(tl.items));

    const r1 = await rule(L1);
    expect([r1.detached, r1.active, r1.detachCount, r1.detachedAt]).toEqual([false, true, 1, T0 + 100]);
    const r2 = await rule(L2);
    expect([r2.detached, r2.active, r2.detachCount, r2.detachedAt]).toEqual([false, true, 1, T0 + 300]);
    expect((await indexer.MirrorAccount.getOrThrow(CLONE)).detachedLeaderAccountIds).toEqual([]);

    const events = (await indexer.LeaderDetachEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    expect(events.map((e) => [e.leaderAccountId, e.detached])).toEqual([
      [L1, true],
      [L1, false],
      [L2, true],
      [L2, false],
    ]);
    const activity = (await indexer.MirrorActivity.getAll()).filter((a) => a.kind.startsWith("LEADER_"));
    expect(activity.map((a) => a.kind).sort()).toEqual(["LEADER_DETACHED", "LEADER_DETACHED", "LEADER_REATTACHED", "LEADER_REATTACHED"]);
  });

  it("clears a removed leader's flag even when PolicyUpdated is the only log seen", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    onboard(tl, [L1, L2]);
    detach(tl.tx(T0 + 100), L1, true);
    tl.tx(T0 + 200).policy(CLONE, [[L2, 5000n]], [[ETH, usd(10_000)]]);
    tl.tx(T0 + 300).policy(CLONE, [[L2, 5000n], [L1, 5000n]], [[ETH, usd(10_000)]]);
    await indexer.process(chain143(tl.items));
    const r1 = await indexer.MirrorLeaderRule.getOrThrow(`${CLONE}-${L1}`);
    expect([r1.detached, r1.active]).toEqual([false, true]);
    expect((await indexer.MirrorAccount.getOrThrow(CLONE)).detachedLeaderAccountIds).toEqual([]);
  });
});
