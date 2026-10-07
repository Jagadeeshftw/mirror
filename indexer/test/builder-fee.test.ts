import { describe, expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { getAddress } from "viem";

import { DAY, ETH, LONG, MATCH_NOW, T0, Timeline, addr, chain143, usd } from "./helpers.js";

const OWNER = addr(0xa1);
const CLONE = getAddress(addr(0xc1));
const FOLLOWER = 500n;
const L1 = 100n;
const BTC = 1n;
const TEAM_LEADER = 999n; // in ENVIO_TEAM_RUN_ACCOUNT_IDS
const DAY0 = Math.floor(T0 / DAY);

function onboard(tl: Timeline, owner = OWNER, clone = CLONE, perplId = FOLLOWER, leaders: bigint[] = [L1], maxBuilderFee = 25n) {
  tl.tx(T0 + 10).createMirror(owner, clone).mirror(clone, "OwnerInitialized", { owner });
  tl.tx(T0 + 20).policy(clone, leaders.map((l) => [l, 5000n] as [bigint, bigint]), [[ETH, usd(10_000)]], { maxBuilderFee });
  tl.tx(T0 + 30)
    .mirror(clone, "Deposited", { from: owner, amount: usd(500), netDeposits: usd(500) })
    .perplAccountCreated(clone, perplId)
    .deposit(perplId, usd(500), usd(500))
    .mirror(clone, "PerplAccountCreated", { perplAccountId: perplId });
}

describe("builder fees", () => {
  it("stores the policy cap, decodes the proof fee, links Perpl's fee and aggregates", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    onboard(tl);

    tl.tx(T0 + 100).open(L1, ETH, LONG, 1000n, 300000n);
    const ref = tl.txHash;
    // Opening copy: Perpl fill with Mirror's builder id (and an unrelated builder's fill, ignored), then Mirrored.
    tl.tx(T0 + 101)
      .open(FOLLOWER, ETH, LONG, 500n, 300000n)
      .takerFill(301n, { builderId: 7n })
      .takerFill(300n)
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 500n, price: 300100n, before: 0n, after: 500n, ref, proof: { fillPNS: 300000n, builderFeeCNS: 300n } });
    const openTx = tl.txHash;
    // Two copies in one tx: each claims only the fill logged before it.
    tl.tx(T0 + 200)
      .increase(FOLLOWER, ETH, LONG, 500n, 600n, 300000n)
      .takerFill(60n)
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 500n, after: 600n, ref, proof: { builderFeeCNS: 60n } })
      .open(FOLLOWER, BTC, LONG, 1000n, 1000000n)
      .takerFill(20n)
      .mirrored(CLONE, { leader: L1, perpId: BTC, orderType: 0n, lot: 1000n, price: 1000100n, before: 0n, after: 1000n, ref, proof: { builderFeeCNS: 20n } });
    // Closing copy: no builder fee, no Perpl builder fill.
    tl.tx(T0 + 300)
      .decrease(FOLLOWER, ETH, LONG, 600n, 300n, usd(1))
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 2n, lot: 300n, price: 299000n, before: 600n, after: 300n, ref });
    // Owner match-now pays the builder fee too.
    tl.tx(T0 + 400)
      .increase(FOLLOWER, ETH, LONG, 300n, 400n, 300000n)
      .takerFill(5n)
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 300n, after: 400n, ref: MATCH_NOW, proof: { builderFeeCNS: 5n } });
    // Fallback order: the Mirrored log reaches the indexer before the earlier Perpl fill of its tx.
    tl.tx(T0 + 500)
      .skip()
      .mirrored(CLONE, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 400n, after: 500n, ref, proof: { builderFeeCNS: 7n } })
      .takerFill(7n, { logIndex: 0 });
    const fallbackTx = tl.txHash;
    // The account's fixed builder fee is above the owner's cap.
    tl.tx(T0 + 600).blocked(CLONE, { leader: L1, perpId: ETH, reason: 21n, limit: 10n, actual: 20n });
    await indexer.process(chain143(tl.items));

    const ma = await indexer.MirrorAccount.getOrThrow(CLONE);
    expect(ma.maxBuilderFeePer100K).toBe(25);
    const policyRow = (await indexer.MirrorActivity.getAll()).find((a) => a.kind === "POLICY_UPDATED")!;
    expect(JSON.parse(policyRow.detail!).maxBuilderFeePer100K).toBe(25);

    const copies = (await indexer.CopyEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    expect(copies.map((c) => [c.builderFeeCNS, c.builderFeePerplCNS])).toEqual([
      [300n, 300n],
      [60n, 60n],
      [20n, 20n],
      [0n, undefined],
      [5n, 5n],
      [7n, 7n],
    ]);
    expect(copies[0]!.txHash).toBe(openTx);

    const fills = (await indexer.BuilderFeeFill.getAll()).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    expect(fills.map((f) => [f.builderId, f.builderFeeCNS, f.copy_id])).toEqual([
      [26n, 300n, copies[0]!.id],
      [26n, 60n, copies[1]!.id],
      [26n, 20n, copies[2]!.id],
      [26n, 5n, copies[4]!.id],
      [26n, 7n, `${fallbackTx}-1`],
    ]);

    const blocked = await indexer.BlockedCopy.getAll();
    expect(blocked.map((b) => [b.reason, b.reasonCode])).toEqual([["BuilderFeeTooHigh", 21]]);
    expect((await indexer.BlockReasonCount.getOrThrow("global-BuilderFeeTooHigh")).count).toBe(1);

    // 300 + 60 + 20 + 0 + 5 + 7
    const total = 392n;
    expect(ma.builderFeesCNS).toBe(total);
    expect((await indexer.GlobalStats.getOrThrow("global")).builderFeesCNS).toBe(total);
    expect((await indexer.DailyStats.getOrThrow(`global-${DAY0}`)).builderFeesCNS).toBe(total);
    expect((await indexer.LeaderStats.getOrThrow(String(L1))).builderFeesCNS).toBe(total);
    for (const id of ["global-all-all", `global-all-${DAY0}`, `global-${L1}-all`, `global-${L1}-${DAY0}`]) {
      expect((await indexer.CopyQualityStats.getOrThrow(id)).builderFeesCNS).toBe(total);
    }
    expect(await indexer.TeamRunStats.get("teamRun")).toBeUndefined();
  });

  it("keeps team-run builder fees out of the public aggregates", async () => {
    const indexer = createTestIndexer();
    const tl = new Timeline();
    const teamClone = getAddress(addr(0xc2));
    onboard(tl, addr(0xd1), teamClone, 600n, [L1]); // team-run follower
    onboard(tl, addr(0xa2), CLONE, FOLLOWER, [TEAM_LEADER]); // real follower of the team-run leader

    tl.tx(T0 + 100)
      .open(600n, ETH, LONG, 100n, 300000n)
      .takerFill(30n)
      .mirrored(teamClone, { leader: L1, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 0n, after: 100n, proof: { builderFeeCNS: 30n } });
    tl.tx(T0 + 200)
      .open(FOLLOWER, ETH, LONG, 100n, 300000n)
      .takerFill(40n)
      .mirrored(CLONE, { leader: TEAM_LEADER, perpId: ETH, orderType: 0n, lot: 100n, price: 300100n, before: 0n, after: 100n, proof: { builderFeeCNS: 40n } });
    await indexer.process(chain143(tl.items));

    const copies = (await indexer.CopyEvent.getAll()).sort((a, b) => a.blockNumber - b.blockNumber);
    expect(copies.map((c) => [c.builderFeeCNS, c.builderFeePerplCNS, c.teamRun, c.excludedFromStats])).toEqual([
      [30n, 30n, true, true],
      [40n, 40n, false, true],
    ]);
    // Traction stats follow the follower's teamRun flag (like copiesExecuted).
    expect((await indexer.GlobalStats.getOrThrow("global")).builderFeesCNS).toBe(40n);
    expect((await indexer.TeamRunStats.getOrThrow("teamRun")).builderFeesCNS).toBe(30n);
    expect((await indexer.DailyStats.getOrThrow(`global-${DAY0}`)).builderFeesCNS).toBe(40n);
    expect((await indexer.DailyStats.getOrThrow(`teamRun-${DAY0}`)).builderFeesCNS).toBe(30n);
    expect((await indexer.MirrorAccount.getOrThrow(teamClone)).builderFeesCNS).toBe(30n);
    expect((await indexer.LeaderStats.get(String(L1)))?.builderFeesCNS ?? 0n).toBe(0n);
    expect((await indexer.LeaderStats.getOrThrow(String(TEAM_LEADER))).builderFeesCNS).toBe(40n);
    // Copy-quality rows exclude any copy with a team-run follower or leader.
    expect(await indexer.CopyQualityStats.get("global-all-all")).toBeUndefined();
    expect((await indexer.CopyQualityStats.getOrThrow("teamRun-all-all")).builderFeesCNS).toBe(70n);
    expect((await indexer.CopyQualityStats.getOrThrow(`teamRun-${TEAM_LEADER}-all`)).builderFeesCNS).toBe(40n);
  });
});
