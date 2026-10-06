import { describe, expect, it } from 'vitest';
import {
  classifyOpen,
  contractSlippageBound,
  copyPriceBound,
  notionalCNS,
  planCopy,
  priceWithinSlippage,
  targetLots,
  type OpenCheckState,
} from '../src/domain/planner.js';
import { CLOSE_LONG, CLOSE_SHORT, LONG, OPEN_LONG, OPEN_SHORT, SHORT, type MirrorOrder } from '../src/domain/types.js';

const REF = `0x${'ab'.repeat(32)}` as const;

/** Literal transcription of MirrorAccount._targetLots with OZ Math.mulDiv rounding, as a cross-check. */
function solidityTarget(leaders: Array<{ ratioBps: number; side: 0 | 1; lots: bigint }>, side: 0 | 1) {
  let plus = 0n;
  let minus = 0n;
  for (const l of leaders) {
    if (l.lots === 0n) continue;
    const prod = l.lots * BigInt(l.ratioBps);
    const floor = prod / 10_000n;
    const ceil = floor + (prod % 10_000n === 0n ? 0n : 1n);
    if (l.side === side) plus += ceil;
    else minus += floor;
  }
  return plus > minus ? plus - minus : 0n;
}

describe('targetLots (contract rounding)', () => {
  it('rounds up per leader on the same side and down on the opposite side', () => {
    expect(targetLots([{ ratioBps: 100, side: LONG, lots: 150n }], LONG)).toBe(2n); // ceil(1.5)
    expect(targetLots([{ ratioBps: 100, side: LONG, lots: 1n }], LONG)).toBe(1n); // ceil(0.01)
    expect(targetLots([{ ratioBps: 100, side: LONG, lots: 1n }], SHORT)).toBe(0n);
    expect(
      targetLots(
        [
          { ratioBps: 5_000, side: LONG, lots: 5n }, // ceil 2.5 = 3
          { ratioBps: 5_000, side: SHORT, lots: 3n }, // floor 1.5 = 1
        ],
        LONG,
      ),
    ).toBe(2n);
    expect(targetLots([{ ratioBps: 10_000, side: SHORT, lots: 7n }, { ratioBps: 10_000, side: LONG, lots: 3n }], LONG)).toBe(0n);
  });

  it('matches a literal Solidity transcription on random inputs', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 5_000; i++) {
      const leaders = Array.from({ length: 1 + rnd(4) }, () => ({ ratioBps: 1 + rnd(10_000), side: rnd(2) as 0 | 1, lots: BigInt(rnd(3) === 0 ? 0 : rnd(1_000_000)) }));
      for (const side of [LONG, SHORT] as const) expect(targetLots(leaders, side)).toBe(solidityTarget(leaders, side));
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

describe('notional', () => {
  it('scales lots x mark into collateral units like _notional', () => {
    // 1 lot BTC (1e-5 BTC) at 85,343.9 = $0.853439 = 853439 CNS
    expect(notionalCNS(1n, 853_439n, 5, 1)).toBe(853_439n);
    expect(notionalCNS(100_000n, 853_439n, 5, 1)).toBe(85_343_900_000n);
  });
});

describe('planCopy', () => {
  const base = { perpId: 1, mark: 1_000_000n, maxSlippageBps: 80, safetyBps: 5, maxMatches: 100 };
  const trig = (side: 0 | 1, increased: boolean, lev = 300) => ({ leaderAccountId: 7, side, increased, leverageHdths: lev, leaderRef: REF });

  it('opens the target from flat with the leader leverage', () => {
    const o = planCopy({ ...base, follower: { side: LONG, lots: 0n }, targetLong: 3n, targetShort: 0n, trigger: trig(LONG, true, 1000) });
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ kind: 'open', orderType: OPEN_LONG, lotLNS: 3n, leverageHdths: 1000, leaderAccountId: 7, leaderRef: REF });
  });

  it('opens only the shortfall when already holding', () => {
    const o = planCopy({ ...base, follower: { side: LONG, lots: 2n }, targetLong: 5n, targetShort: 0n, trigger: trig(LONG, true) });
    expect(o.map((x) => [x.kind, x.lotLNS])).toEqual([['open', 3n]]);
  });

  it('closes down to target when the leader reduces, and never opens on a reduction', () => {
    const o = planCopy({ ...base, follower: { side: LONG, lots: 4n }, targetLong: 2n, targetShort: 0n, trigger: trig(LONG, false) });
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ kind: 'close', orderType: CLOSE_LONG, lotLNS: 2n, leverageHdths: 0 });
    expect(planCopy({ ...base, follower: { side: LONG, lots: 1n }, targetLong: 3n, targetShort: 0n, trigger: trig(LONG, false) })).toEqual([]);
  });

  it('closes everything when the leader closes', () => {
    const o = planCopy({ ...base, follower: { side: SHORT, lots: 9n }, targetLong: 0n, targetShort: 0n, trigger: trig(SHORT, false) });
    expect(o.map((x) => [x.orderType, x.lotLNS])).toEqual([[CLOSE_SHORT, 9n]]);
  });

  it('flips via close then open when the leader inverts', () => {
    const o = planCopy({ ...base, follower: { side: LONG, lots: 2n }, targetLong: 0n, targetShort: 4n, trigger: trig(SHORT, true, 500) });
    expect(o.map((x) => [x.kind, x.orderType, x.lotLNS])).toEqual([
      ['close', CLOSE_LONG, 2n],
      ['open', OPEN_SHORT, 4n],
    ]);
  });

  it('does not open against an existing opposite position from another leader', () => {
    const o = planCopy({ ...base, follower: { side: SHORT, lots: 2n }, targetLong: 1n, targetShort: 2n, trigger: trig(LONG, true) });
    expect(o).toEqual([]);
  });

  it('skips sub-lot deltas', () => {
    expect(planCopy({ ...base, follower: { side: LONG, lots: 3n }, targetLong: 3n, targetShort: 0n, trigger: trig(LONG, true) })).toEqual([]);
  });

  it('prices opens and closes within the policy slippage', () => {
    const [close, open] = planCopy({ ...base, follower: { side: LONG, lots: 2n }, targetLong: 0n, targetShort: 1n, trigger: trig(SHORT, true) });
    expect(close!.pricePNS).toBe(992_500n);
    expect(open!.pricePNS).toBe(992_500n);
  });
});

describe('classifyOpen (replay of _checkOpen)', () => {
  const order: MirrorOrder = { leaderAccountId: 7, perpId: 1, orderType: OPEN_LONG, lotLNS: 1n, pricePNS: 1_005_000n, leverageHdths: 300, maxMatches: 100, leaderRef: REF };
  const ok: OpenCheckState = {
    now: 1_000_000,
    paused: false,
    expiry: 2_000_000,
    marketAllowed: true,
    maxNotionalCNS: 10_000_000n,
    lotDecimals: 5,
    priceDecimals: 1,
    leaderAllowed: true,
    maxLeverageHdths: 300,
    follower: { side: LONG, lots: 0n },
    markValid: true,
    mark: 1_000_000n,
    maxSlippageBps: 80,
    leader: { side: LONG, lots: 100n },
    target: 1n,
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
  it('DailyLossStop', () => expect(classifyOpen(order, { ...ok, equity: 11_000_000n }).reason).toBe('DailyLossStop'));
  it('DrawdownStop uses the high-water mark', () =>
    expect(classifyOpen(order, { ...ok, dailyLossBps: 0, equity: 10_000_000n, highWaterEquity: 12_000_000n }).reason).toBe('DrawdownStop'));
  it('a new day resets the daily baseline to current equity', () =>
    expect(classifyOpen(order, { ...ok, drawdownBps: 0, equity: 11_000_000n, riskDay: ok.riskDay - 1 }).reason).toBe('None'));
});
