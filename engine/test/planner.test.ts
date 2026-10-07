import { describe, expect, it } from 'vitest';
import {
  addedMarginCNS,
  classifyClose,
  classifyOpen,
  closeLotsToTarget,
  contractSlippageBound,
  copyPriceBound,
  entryBound,
  notionalCNS,
  openPrice,
  planCopy,
  priceWithinSlippage,
  targetLots,
  type OpenCheckState,
  type PlanInput,
} from '../src/domain/planner.js';
import { CLOSE_LONG, CLOSE_SHORT, LONG, OPEN_LONG, OPEN_SHORT, SHORT, type MirrorOrder } from '../src/domain/types.js';

const REF = `0x${'ab'.repeat(32)}` as const;

/** Literal transcription of MirrorAccount._targetLots with OZ Math.mulDiv(..., Ceil), as a cross-check. */
function solidityTarget(l: { ratioBps: number; side: 0 | 1; lots: bigint } | undefined, side: 0 | 1) {
  if (!l) return 0n;
  if (l.lots === 0n || l.side !== side) return 0n;
  const prod = l.lots * BigInt(l.ratioBps);
  return prod / 10_000n + (prod % 10_000n === 0n ? 0n : 1n);
}

describe('targetLots (per leader, contract rounding)', () => {
  it('rounds up on the leader side and is zero on the other side or for an unfollowed leader', () => {
    expect(targetLots({ ratioBps: 100, side: LONG, lots: 150n }, LONG)).toBe(2n); // ceil(1.5)
    expect(targetLots({ ratioBps: 100, side: LONG, lots: 1n }, LONG)).toBe(1n); // ceil(0.01)
    expect(targetLots({ ratioBps: 100, side: LONG, lots: 1n }, SHORT)).toBe(0n);
    expect(targetLots(undefined, LONG)).toBe(0n);
  });

  it('matches a literal Solidity transcription on random inputs', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 5_000; i++) {
      const l = rnd(10) === 0 ? undefined : { ratioBps: 1 + rnd(10_000), side: rnd(2) as 0 | 1, lots: BigInt(rnd(3) === 0 ? 0 : rnd(1_000_000)) };
      for (const side of [LONG, SHORT] as const) expect(targetLots(l, side)).toBe(solidityTarget(l, side));
    }
  });
});

describe('slippage bounds', () => {
  it('matches the contract bound: bids floor(mark*(1+s)), asks ceil(mark*(1-s))', () => {
    expect(contractSlippageBound(OPEN_LONG, 853_439n, 80)).toBe((853_439n * 10_080n) / 10_000n);
    expect(contractSlippageBound(CLOSE_SHORT, 853_439n, 80)).toBe((853_439n * 10_080n) / 10_000n);
    expect(contractSlippageBound(OPEN_SHORT, 853_439n, 80)).toBe((853_439n * 9_920n + 9_999n) / 10_000n);
    expect(contractSlippageBound(CLOSE_LONG, 853_439n, 80)).toBe((853_439n * 9_920n + 9_999n) / 10_000n);
  });

  it('copy price sits inside the policy bound by the safety margin, for every order type', () => {
    for (const mark of [1n, 999n, 853_439n, 28_963n, 10n ** 12n]) {
      for (const s of [1, 5, 6, 50, 80, 1000]) {
        for (const t of [OPEN_LONG, OPEN_SHORT, CLOSE_LONG, CLOSE_SHORT]) {
          const p = copyPriceBound(t, mark, s, 5);
          expect(priceWithinSlippage(t, p, mark, s).ok).toBe(true);
        }
      }
    }
    // 80 bps policy with 5 bps safety -> 75 bps
    expect(copyPriceBound(OPEN_LONG, 1_000_000n, 80, 5)).toBe(1_007_500n);
    expect(copyPriceBound(OPEN_SHORT, 1_000_000n, 80, 5)).toBe(992_500n);
  });
});

describe('entry guard bound', () => {
  it('matches _checkOpen: long floor(entry*(1+d)), short ceil(entry*(1-d)); off at 0', () => {
    expect(entryBound(LONG, 1_000_003n, 50)).toBe((1_000_003n * 10_050n) / 10_000n);
    expect(entryBound(SHORT, 1_000_003n, 50)).toBe((1_000_003n * 9_950n + 9_999n) / 10_000n);
    expect(entryBound(LONG, 1_000_000n, 0)).toBeUndefined();
  });

  it('open price is the tighter of the slippage and entry bounds', () => {
    // Long, mark 1_000_000, 75 bps effective slippage -> 1_007_500; entry 1_000_000 + 30 bps -> 1_003_000.
    expect(openPrice(OPEN_LONG, 1_000_000n, 80, 5, 1_000_000n, 30)).toBe(1_003_000n);
    // Entry bound looser than slippage: slippage wins.
    expect(openPrice(OPEN_LONG, 1_000_000n, 80, 5, 1_000_000n, 500)).toBe(1_007_500n);
    // Short: max of the two.
    expect(openPrice(OPEN_SHORT, 1_000_000n, 80, 5, 1_000_000n, 30)).toBe(997_000n);
    expect(openPrice(OPEN_SHORT, 1_000_000n, 80, 5, 1_000_000n, 0)).toBe(992_500n);
  });
});

describe('notional and margin', () => {
  it('scales lots x mark into collateral units like _notional', () => {
    // 1 lot BTC (1e-5 BTC) at 85,343.9 = $0.853439 = 853439 CNS
    expect(notionalCNS(1n, 853_439n, 5, 1)).toBe(853_439n);
    expect(notionalCNS(100_000n, 853_439n, 5, 1)).toBe(85_343_900_000n);
  });
  it('added margin uses max(limit, mark) / leverage, rounded up', () => {
    expect(addedMarginCNS(1n, 900_000n, 853_439n, 200, 5, 1)).toBe(450_000n);
    expect(addedMarginCNS(1n, 800_000n, 853_439n, 300, 5, 1)).toBe(284_480n); // ceil(853439/3)
  });
});

describe('planCopy (one leader per market)', () => {
  const trig = (side: 0 | 1, increased: boolean, lev = 300, leader = 7) => ({ leaderAccountId: leader, side, increased, leverageHdths: lev, leaderRef: REF, leaderFillPNS: 1_000_100n, leaderEntryPNS: 1_000_000n });
  const base = (over: Partial<PlanInput>): PlanInput => ({
    perpId: 1, mark: 1_000_000n, maxSlippageBps: 80, safetyBps: 5, maxMatches: 100, maxEntryDeviationBps: 0,
    follower: { side: LONG, lots: 0n }, holder: 0, holderTarget: 0n, triggerTarget: 0n, trigger: trig(LONG, true), ...over,
  });

  it('opens the leader target from flat with the leader leverage and fill price', () => {
    const o = planCopy(base({ triggerTarget: 3n, trigger: trig(LONG, true, 1000) }));
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ kind: 'open', orderType: OPEN_LONG, lotLNS: 3n, leverageHdths: 1000, leaderAccountId: 7, leaderRef: REF, leaderFillPNS: 1_000_100n });
  });

  it('the holding leader adds only the shortfall', () => {
    const o = planCopy(base({ follower: { side: LONG, lots: 2n }, holder: 7, holderTarget: 5n, triggerTarget: 5n }));
    expect(o.map((x) => [x.kind, x.lotLNS])).toEqual([['open', 3n]]);
  });

  it('closes down to the holder target, never below, and never opens on a reduction', () => {
    const o = planCopy(base({ follower: { side: LONG, lots: 4n }, holder: 7, holderTarget: 2n, triggerTarget: 2n, trigger: trig(LONG, false) }));
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ kind: 'close', orderType: CLOSE_LONG, lotLNS: 2n, leverageHdths: 0, leaderAccountId: 7 });
    expect(4n - o[0]!.lotLNS).toBe(2n);
    expect(planCopy(base({ follower: { side: LONG, lots: 1n }, holder: 7, holderTarget: 3n, triggerTarget: 3n, trigger: trig(LONG, false) }))).toEqual([]);
    expect(closeLotsToTarget(4n, 2n)).toBe(2n);
    expect(closeLotsToTarget(2n, 3n)).toBe(0n);
  });

  it('closes everything when the holder closes', () => {
    const o = planCopy(base({ follower: { side: SHORT, lots: 9n }, holder: 7, trigger: trig(SHORT, false) }));
    expect(o.map((x) => [x.orderType, x.lotLNS])).toEqual([[CLOSE_SHORT, 9n]]);
  });

  it('flips via close then open when the holder inverts', () => {
    const o = planCopy(base({ follower: { side: LONG, lots: 2n }, holder: 7, holderTarget: 0n, triggerTarget: 4n, trigger: trig(SHORT, true, 500) }));
    expect(o.map((x) => [x.kind, x.orderType, x.lotLNS])).toEqual([
      ['close', CLOSE_LONG, 2n],
      ['open', OPEN_SHORT, 4n],
    ]);
  });

  it('another leader never resizes a market it does not hold', () => {
    // Leader 8 reduces; the follower's long belongs to leader 7: nothing to do.
    expect(planCopy(base({ follower: { side: LONG, lots: 4n }, holder: 7, holderTarget: 0n, triggerTarget: 1n, trigger: trig(LONG, false, 300, 8) }))).toEqual([]);
  });

  it("plans another leader's same-side open so the contract records MarketHeldByOtherLeader", () => {
    const o = planCopy(base({ follower: { side: LONG, lots: 4n }, holder: 7, triggerTarget: 2n, trigger: trig(LONG, true, 300, 8) }));
    expect(o.map((x) => [x.kind, x.leaderAccountId, x.lotLNS])).toEqual([['open', 8, 2n]]);
  });

  it('does not open against an opposite position held by another leader', () => {
    expect(planCopy(base({ follower: { side: SHORT, lots: 2n }, holder: 7, triggerTarget: 1n, trigger: trig(LONG, true, 300, 8) }))).toEqual([]);
  });

  it('skips sub-lot deltas', () => {
    expect(planCopy(base({ follower: { side: LONG, lots: 3n }, holder: 7, holderTarget: 3n, triggerTarget: 3n }))).toEqual([]);
  });

  it('prices closes within slippage and opens within slippage and the entry guard', () => {
    const [close, open] = planCopy(base({ follower: { side: LONG, lots: 2n }, holder: 7, holderTarget: 0n, triggerTarget: 1n, trigger: trig(SHORT, true), maxEntryDeviationBps: 30 }));
    expect(close!.pricePNS).toBe(992_500n);
    expect(open!.pricePNS).toBe(997_000n);
  });
});

describe('classifyOpen (replay of _checkOpen)', () => {
  const order: MirrorOrder = { leaderAccountId: 7, perpId: 1, orderType: OPEN_LONG, lotLNS: 1n, pricePNS: 1_005_000n, leverageHdths: 300, maxMatches: 100, leaderRef: REF, leaderFillPNS: 0n };
  const ok: OpenCheckState = {
    now: 1_000_000,
    paused: false,
    expiry: 2_000_000,
    marketAllowed: true,
    marketHalted: false,
    maxNotionalCNS: 10_000_000n,
    lotDecimals: 5,
    priceDecimals: 1,
    leaderAllowed: true,
    leaderStopped: false,
    maxLeverageHdths: 300,
    follower: { side: LONG, lots: 0n },
    marketLeader: 0,
    markValid: true,
    mark: 1_000_000n,
    maxSlippageBps: 80,
    leader: { side: LONG, lots: 100n },
    leaderEntryPNS: 1_000_000n,
    maxEntryDeviationBps: 0,
    target: 1n,
    budgetCNS: 10_000_000n,
    lossStopBps: 0,
    leaderMarginCNS: 0n,
    leaderUnrealizedCNS: 0n,
    leaderRealizedCNS: 0n,
    equity: 12_000_000n,
    riskDay: Math.floor(1_000_000 / 86_400),
    dayStartEquity: 12_000_000n,
    highWaterEquity: 12_000_000n,
    dailyLossBps: 500,
    drawdownBps: 1500,
  };

  it('passes a compliant order', () => expect(classifyOpen(order, ok).reason).toBe('None'));
  it('LeverageTooHigh with limit and actual', () => expect(classifyOpen({ ...order, leverageHdths: 1000 }, ok)).toEqual({ reason: 'LeverageTooHigh', limit: 300n, actual: 1000n }));
  it('checks in contract order (paused before leverage)', () => expect(classifyOpen({ ...order, leverageHdths: 1000 }, { ...ok, paused: true }).reason).toBe('Paused'));
  it('SlippageTooHigh', () => expect(classifyOpen({ ...order, pricePNS: 1_009_000n }, ok)).toMatchObject({ reason: 'SlippageTooHigh', limit: 1_008_000n }));
  it('ExceedsLeaderTarget', () => expect(classifyOpen({ ...order, lotLNS: 2n }, ok)).toMatchObject({ reason: 'ExceedsLeaderTarget', limit: 1n, actual: 2n }));
  it('LeaderSideMismatch', () => expect(classifyOpen(order, { ...ok, leader: { side: SHORT, lots: 5n } }).reason).toBe('LeaderSideMismatch'));
  it('ExceedsMaxNotional', () => expect(classifyOpen(order, { ...ok, maxNotionalCNS: 1n }).reason).toBe('ExceedsMaxNotional'));
  it('FlipNotAllowed', () => expect(classifyOpen(order, { ...ok, follower: { side: SHORT, lots: 1n } }).reason).toBe('FlipNotAllowed'));
  it('MarketHalted after a level fired', () => expect(classifyOpen(order, { ...ok, marketHalted: true }).reason).toBe('MarketHalted'));
  it('MarketHeldByOtherLeader (limit = this leader, actual = holder)', () =>
    expect(classifyOpen(order, { ...ok, follower: { side: LONG, lots: 1n }, marketLeader: 9, target: 5n })).toEqual({ reason: 'MarketHeldByOtherLeader', limit: 7n, actual: 9n }));
  it('EntryTooFar on the limit price', () =>
    expect(classifyOpen(order, { ...ok, maxEntryDeviationBps: 30 })).toEqual({ reason: 'EntryTooFar', limit: 1_003_000n, actual: 1_005_000n }));
  it('EntryTooFar on the mark when the limit is inside', () =>
    expect(classifyOpen({ ...order, pricePNS: 1_002_000n }, { ...ok, maxEntryDeviationBps: 30, mark: 1_004_000n, leaderEntryPNS: 1_000_000n })).toEqual({ reason: 'EntryTooFar', limit: 1_003_000n, actual: 1_004_000n }));
  it('LeaderBudgetExceeded', () =>
    expect(classifyOpen(order, { ...ok, budgetCNS: 300_000n })).toEqual({ reason: 'LeaderBudgetExceeded', limit: 300_000n, actual: 335_000n }));
  it('LeaderLossStop from realized + unrealized', () =>
    expect(classifyOpen(order, { ...ok, lossStopBps: 1000, leaderRealizedCNS: -900_000n, leaderUnrealizedCNS: -200_000n })).toEqual({ reason: 'LeaderLossStop', limit: 1_000_000n, actual: 1_100_000n }));
  it('LeaderLossStop once latched', () => expect(classifyOpen(order, { ...ok, leaderStopped: true }).reason).toBe('LeaderLossStop'));
  it('DailyLossStop', () => expect(classifyOpen(order, { ...ok, equity: 11_000_000n }).reason).toBe('DailyLossStop'));
  it('DrawdownStop uses the high-water mark', () =>
    expect(classifyOpen(order, { ...ok, dailyLossBps: 0, equity: 10_000_000n, highWaterEquity: 12_000_000n }).reason).toBe('DrawdownStop'));
  it('a new day resets the daily baseline to current equity', () =>
    expect(classifyOpen(order, { ...ok, drawdownBps: 0, equity: 11_000_000n, riskDay: ok.riskDay - 1 }).reason).toBe('None'));
});

describe('classifyClose (replay of _checkClose)', () => {
  const close: MirrorOrder = { leaderAccountId: 7, perpId: 1, orderType: CLOSE_LONG, lotLNS: 2n, pricePNS: 995_000n, leverageHdths: 0, maxMatches: 100, leaderRef: REF, leaderFillPNS: 0n };
  const s = { follower: { side: LONG as 0, lots: 4n }, leaderAllowed: true, marketLeader: 7, target: 2n, markValid: true, mark: 1_000_000n, maxSlippageBps: 80 };
  it('passes a close to exactly the target', () => expect(classifyClose(close, s)).toMatchObject({ reason: 'None' }));
  it('CloseBelowTarget', () => expect(classifyClose({ ...close, lotLNS: 3n }, s)).toEqual({ reason: 'CloseBelowTarget', limit: 2n, actual: 1n }));
  it('MarketHeldByOtherLeader', () => expect(classifyClose({ ...close, leaderAccountId: 8 }, s)).toMatchObject({ reason: 'MarketHeldByOtherLeader' }));
  it('reverts when there is nothing on that side', () => expect(classifyClose({ ...close, orderType: CLOSE_SHORT }, s)).toBe('revert'));
});
