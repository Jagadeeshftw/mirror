import { encodeFunctionData, getAddress, isAddress, isHex, pad, toHex, type Address, type Hex, type PublicClient } from 'viem';
import { z } from 'zod';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Reads } from '../chain/reads.js';
import { simulateCall, decodeBoolArray } from '../chain/simulate.js';
import { addedMarginCNS, classifyOpen, entryBound, notionalCNS, openPrice, targetLots, mulDiv } from '../domain/planner.js';
import { encodeFollowData, encodeOrders, toOrderStruct, toPolicyStruct, ZERO_REF } from '../domain/encode.js';
import { LONG, ORDER_TYPE_NAMES, openTypeFor, type MirrorOrder, type Policy, type Side } from '../domain/types.js';
import type { MarketData } from '../perpl/market.js';
import type { Relayer } from './relayer.js';
import type { ThinBookGuard } from './guard.js';
import type { AdversarialService } from './adversarial.js';

export interface QuoteExtras {
  guard?: ThinBookGuard;
  adversarial?: AdversarialService;
  /** Refuse quotes (new follows) for leaders flagged as adversarial. */
  refuseFlagged?: boolean;
}

const u = z.union([z.string(), z.number()]).transform((v) => BigInt(v));

const flag = z.union([z.boolean(), z.literal('true'), z.literal('false'), z.literal(0), z.literal(1)]).transform((v) => v === true || v === 'true' || v === 1);

export const PolicyBody = z.object({
  maxLeverageHdths: z.coerce.number().int(),
  maxSlippageBps: z.coerce.number().int(),
  dailyLossBps: z.coerce.number().int().default(0),
  drawdownBps: z.coerce.number().int().default(0),
  expiry: z.coerce.number().int(),
  maxEntryDeviationBps: z.coerce.number().int().min(0).max(5_000).default(0),
  // Required onchain (1..2000): no default, the user picks how much slippage a triggered stop may take.
  stopSlippageBps: z.coerce.number().int().min(1).max(2_000),
  flattenOnStop: flag.default(false),
  leaders: z
    .array(
      z.object({
        accountId: z.coerce.number().int(),
        ratioBps: z.coerce.number().int(),
        budgetCNS: u.refine((v) => v > 0n, 'budgetCNS must be > 0'),
        lossStopBps: z.coerce.number().int().min(0).max(10_000).default(0),
      }),
    )
    .min(1)
    .max(4),
  markets: z.array(z.object({ perpId: z.coerce.number().int(), maxNotionalCNS: u })).min(1).max(16),
});

export const QuoteBody = z.object({
  owner: z.string().refine((v) => isAddress(v), 'invalid owner').transform((v) => getAddress(v)),
  leaderAccountId: z.coerce.number().int().positive(),
  policy: PolicyBody,
  account: z.string().refine((v) => isAddress(v)).transform((v) => getAddress(v)).optional(),
  salt: z.union([z.string(), z.number()]).optional(),
});

export interface QuoteLine {
  perpId: number;
  symbol: string | undefined;
  orderType: number;
  orderTypeName: string;
  lotLNS: string;
  sizeDisplay: string;
  markPNS: string;
  perplMarkPNS: string | null;
  perplMarkSource: string | null;
  pricePNS: string;
  expectedFillPNS: string | null;
  expectedFillLots: string | null;
  bookSource: string | null;
  notionalCNS: string;
  marginCNS: string;
  leverageHdths: number;
  leaderLeverageHdths: number;
  leaderLotLNS: string;
  /** Leader's onchain average entry and the entry guard's bound (null when the guard is off). */
  leaderEntryPNS: string;
  entryBoundPNS: string | null;
  wouldBlock: null | { reason: string; limit: string; actual: string };
  /** Engine-side thin-book guard (not an onchain block): shrunk or skipped, with the numbers. */
  thinBook: null | { decision: string; reason: string | null; requestedLots: string; finalLots: string; depthLots: string | null; requiredLots: string; bookSource: string };
  /** Set when the engine leaves this line out of the match orders (e.g. 'ThinBook', 'BookUnavailable'). */
  engineSkip: string | null;
}

/** Follow-sheet quote: the match-now orders that would bring a new follower to the leader's positions. */
export class QuoteService {
  constructor(
    private readonly client: PublicClient,
    private readonly reads: Reads,
    private readonly market: MarketData,
    private readonly relayer: Relayer,
    private readonly safetyBps: number,
    private readonly maxMatches: number,
    private readonly extras: QuoteExtras = {},
  ) {}

  async quote(b: z.infer<typeof QuoteBody>) {
    const policy: Policy = b.policy;
    if (!policy.leaders.some((l) => l.accountId === b.leaderAccountId)) throw Object.assign(new Error('policy.leaders must include leaderAccountId'), { statusCode: 400 });
    if (this.extras.refuseFlagged && this.extras.adversarial) {
      const adv = this.extras.adversarial.forLeader(b.leaderAccountId);
      if (adv.flagged) throw Object.assign(new Error(`leader ${b.leaderAccountId} is flagged as adversarial to followers (score ${adv.score}); new follows are refused`), { statusCode: 409 });
    }

    let account = b.account;
    if (!account) {
      const salt = b.salt !== undefined && typeof b.salt === 'string' && isHex(b.salt) && b.salt.length === 66 ? (b.salt as Hex) : pad(toHex(BigInt(b.salt ?? 0)), { size: 32 });
      account = await this.relayer.predict(b.owner, salt).catch(() => undefined);
    }
    const deployed = account ? await this.relayer.isAccount(account) : false;
    const state = deployed && account ? await this.reads.account(account) : undefined;
    const funded = Boolean(state && state.perplAccountId !== 0);

    const lines: QuoteLine[] = [];
    const orders: MirrorOrder[] = [];
    /** lines index of each order (skipped lines have no order). */
    const orderLine: number[] = [];
    const rule = policy.leaders.find((l) => l.accountId === b.leaderAccountId)!;
    const book = funded && account ? await this.reads.leaderBook(account, b.leaderAccountId) : { marginCNS: 0n, unrealizedCNS: 0n, realizedCNS: 0n, stopped: false };
    // follow() executes the match orders in sequence; each one adds to this leader's margin.
    let marginSoFar = book.marginCNS;
    for (const m of policy.markets) {
      const leader = await this.reads.position(m.perpId, b.leaderAccountId);
      if (leader.lots === 0n) continue;
      const meta = this.market.meta(m.perpId);
      const lotDecimals = meta?.lotDecimals ?? 0;
      const priceDecimals = meta?.priceDecimals ?? 0;
      const side: Side = leader.side;
      // Per-leader target: ratio x this leader's own lots (no netting with other leaders).
      const target = targetLots({ ratioBps: rule.ratioBps, side: leader.side, lots: leader.lots }, side);
      const follower = funded && state ? await this.reads.position(m.perpId, state.perplAccountId) : { side: LONG as Side, lots: 0n, mark: leader.mark, markValid: leader.markValid };
      const marketLeader = funded && account && follower.lots > 0n ? await this.reads.marketLeader(account, m.perpId) : 0;
      const ownsMarket = follower.lots === 0n || marketLeader === b.leaderAccountId;
      const have = ownsMarket && follower.lots > 0n && follower.side === side ? follower.lots : 0n;
      let lots = ownsMarket ? (target > have ? target - have : 0n) : target;
      if (lots === 0n) continue;

      const orderType = openTypeFor(side);
      const mark = leader.mark;
      const price = openPrice(orderType, mark, policy.maxSlippageBps, this.safetyBps, leader.entryPricePNS, policy.maxEntryDeviationBps);
      let thinBook: QuoteLine['thinBook'] = null;
      let engineSkip: string | null = null;
      const guard = this.extras.guard;
      if (guard?.enabled) {
        const g = await guard.check(m.perpId, orderType, lots, price);
        if (g.decision !== 'ok') {
          guard.record({ account: deployed && account ? account : null, source: 'quote', leaderId: b.leaderAccountId, leaderRef: null, perpId: m.perpId, orderType, limitPNS: price, block: 0 }, g);
          thinBook = { decision: g.decision, reason: g.reason, requestedLots: g.requestedLots.toString(), finalLots: g.finalLots.toString(), depthLots: g.depthLots?.toString() ?? null, requiredLots: g.requiredLots.toString(), bookSource: g.bookSource };
          if (g.decision === 'shrunk') lots = g.finalLots;
          else engineSkip = g.reason === 'book_unavailable' ? 'BookUnavailable' : 'ThinBook';
        }
      }
      const eb = entryBound(side, leader.entryPricePNS, policy.maxEntryDeviationBps);
      const leaderNotional = notionalCNS(leader.lots, mark, lotDecimals, priceDecimals);
      const leaderLev = leader.depositCNS > 0n ? Number(mulDiv(leaderNotional, 100n, leader.depositCNS)) : policy.maxLeverageHdths;
      // Match now opens at the leader's effective leverage capped by the follower's max (keeper copies use the
      // leader's order leverage exactly, so a higher-leverage leader trade is blocked onchain instead).
      const leverage = Math.max(100, Math.min(leaderLev, policy.maxLeverageHdths));
      const notional = notionalCNS(lots, mark, lotDecimals, priceDecimals);
      const perplMark = await this.market.mark(m.perpId).catch(() => undefined);
      const fill = await this.market.expectedFill(m.perpId, orderType, lots, price).catch(() => undefined);
      const order: MirrorOrder = { leaderAccountId: b.leaderAccountId, perpId: m.perpId, orderType, lotLNS: lots, pricePNS: price, leverageHdths: leverage, maxMatches: this.maxMatches, leaderRef: ZERO_REF, leaderFillPNS: 0n };
      if (!engineSkip) {
        orders.push(order);
        orderLine.push(lines.length);
      }
      lines.push({
        perpId: m.perpId,
        symbol: meta?.symbol,
        orderType,
        orderTypeName: ORDER_TYPE_NAMES[orderType]!,
        lotLNS: lots.toString(),
        sizeDisplay: (Number(lots) / 10 ** lotDecimals).toFixed(lotDecimals),
        markPNS: mark.toString(),
        perplMarkPNS: perplMark?.markPNS.toString() ?? null,
        perplMarkSource: perplMark?.source ?? null,
        pricePNS: price.toString(),
        expectedFillPNS: fill?.pricePNS?.toString() ?? null,
        expectedFillLots: fill ? fill.filledLots.toString() : null,
        bookSource: fill?.source ?? null,
        notionalCNS: notional.toString(),
        marginCNS: mulDiv(notional, 100n, BigInt(leverage)).toString(),
        leverageHdths: leverage,
        leaderLeverageHdths: leaderLev,
        leaderLotLNS: leader.lots.toString(),
        leaderEntryPNS: leader.entryPricePNS.toString(),
        entryBoundPNS: eb?.toString() ?? null,
        wouldBlock: null,
        thinBook,
        engineSkip,
      });
      if (engineSkip) continue;

      // Off-chain replay (used when the account is not funded yet, or to explain a simulated block).
      const mr = policy.markets.find((x) => x.perpId === m.perpId)!;
      const now = Math.floor(Date.now() / 1000);
      const eq = state?.equity ?? 0n;
      const r = classifyOpen(order, {
        now,
        paused: false,
        expiry: policy.expiry,
        marketAllowed: true,
        marketHalted: false,
        maxNotionalCNS: mr.maxNotionalCNS,
        lotDecimals,
        priceDecimals,
        leaderAllowed: true,
        leaderStopped: false,
        maxLeverageHdths: policy.maxLeverageHdths,
        follower: { side: follower.side, lots: follower.lots },
        marketLeader,
        markValid: leader.markValid,
        mark,
        maxSlippageBps: policy.maxSlippageBps,
        leader: { side: leader.side, lots: leader.lots },
        leaderEntryPNS: leader.entryPricePNS,
        maxEntryDeviationBps: policy.maxEntryDeviationBps,
        target,
        budgetCNS: rule.budgetCNS,
        lossStopBps: rule.lossStopBps,
        leaderMarginCNS: marginSoFar,
        leaderUnrealizedCNS: book.unrealizedCNS,
        leaderRealizedCNS: book.realizedCNS,
        equity: eq,
        riskDay: state?.riskDay ?? Math.floor(now / 86_400),
        dayStartEquity: state?.dayStartEquity ?? eq,
        highWaterEquity: state?.highWaterEquity ?? eq,
        dailyLossBps: policy.dailyLossBps,
        drawdownBps: policy.drawdownBps,
      });
      if (r.reason !== 'None') lines.at(-1)!.wouldBlock = { reason: r.reason, limit: r.limit.toString(), actual: r.actual.toString() };
      else marginSoFar += addedMarginCNS(lots, price, mark, leverage, lotDecimals, priceDecimals);
    }

    let simulation: 'follow' | 'replay' = 'replay';
    let simulationError: string | undefined;
    if (funded && account && orders.length) {
      const data = encodeFunctionData({
        abi: mirrorAccountAbi,
        functionName: 'follow',
        args: [toPolicyStruct(policy), orders.map(toOrderStruct)],
      });
      const sim = await simulateCall(this.client, b.owner, account, data);
      if (!sim.ok) simulationError = sim.revert?.message;
      else {
        simulation = 'follow';
        const executed = decodeBoolArray(sim.returnData, 'follow');
        let bi = 0;
        executed?.forEach((ok, i) => {
          const line = lines[orderLine[i]!]!;
          if (ok) line.wouldBlock = null;
          else {
            const b2 = sim.blocked[bi++];
            if (b2) line.wouldBlock = { reason: b2.reason, limit: b2.limit.toString(), actual: b2.actual.toString() };
            else line.wouldBlock ??= { reason: 'Blocked', limit: '0', actual: '0' };
          }
        });
      }
    }

    const passing = orders.filter((_, i) => !lines[orderLine[i]!]!.wouldBlock);
    return {
      owner: b.owner,
      account: account ?? null,
      deployed,
      funded,
      leaderAccountId: b.leaderAccountId,
      simulation,
      simulationError: simulationError ?? null,
      quotes: lines,
      matchOrders: passing.map((o) => ({ ...o, lotLNS: o.lotLNS.toString(), pricePNS: o.pricePNS.toString(), leaderFillPNS: o.leaderFillPNS.toString() })),
      encodedMatchOrders: encodeOrders(passing),
      followActionData: encodeFollowData(policy, passing),
    };
  }
}

export type { Address };
