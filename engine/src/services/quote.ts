import { encodeFunctionData, getAddress, isAddress, isHex, pad, toHex, type Address, type Hex, type PublicClient } from 'viem';
import { z } from 'zod';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Reads } from '../chain/reads.js';
import { simulateCall, decodeBoolArray } from '../chain/simulate.js';
import { classifyOpen, copyPriceBound, notionalCNS, targetLots, mulDiv } from '../domain/planner.js';
import { encodeFollowData, encodeOrders, ZERO_REF } from '../domain/encode.js';
import { LONG, ORDER_TYPE_NAMES, openTypeFor, type MirrorOrder, type Policy, type Side } from '../domain/types.js';
import type { MarketData } from '../perpl/market.js';
import type { Relayer } from './relayer.js';

const u = z.union([z.string(), z.number()]).transform((v) => BigInt(v));

export const PolicyBody = z.object({
  maxLeverageHdths: z.coerce.number().int(),
  maxSlippageBps: z.coerce.number().int(),
  dailyLossBps: z.coerce.number().int().default(0),
  drawdownBps: z.coerce.number().int().default(0),
  expiry: z.coerce.number().int(),
  leaders: z.array(z.object({ accountId: z.coerce.number().int(), ratioBps: z.coerce.number().int() })).min(1).max(4),
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
  wouldBlock: null | { reason: string; limit: string; actual: string };
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
  ) {}

  async quote(b: z.infer<typeof QuoteBody>) {
    const policy: Policy = b.policy;
    if (!policy.leaders.some((l) => l.accountId === b.leaderAccountId)) throw Object.assign(new Error('policy.leaders must include leaderAccountId'), { statusCode: 400 });

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
    for (const m of policy.markets) {
      const leader = await this.reads.position(m.perpId, b.leaderAccountId);
      if (leader.lots === 0n) continue;
      const meta = this.market.meta(m.perpId);
      const lotDecimals = meta?.lotDecimals ?? 0;
      const priceDecimals = meta?.priceDecimals ?? 0;
      const positions = await Promise.all(policy.leaders.map(async (l) => ({ ratioBps: l.ratioBps, ...(await this.reads.position(m.perpId, l.accountId)) })));
      const side: Side = leader.side;
      const target = targetLots(positions.map((p) => ({ ratioBps: p.ratioBps, side: p.side, lots: p.lots })), side);
      const follower = funded && state ? await this.reads.position(m.perpId, state.perplAccountId) : { side: LONG as Side, lots: 0n, mark: leader.mark, markValid: leader.markValid };
      const have = follower.lots > 0n && follower.side === side ? follower.lots : 0n;
      const lots = target > have ? target - have : 0n;
      if (lots === 0n) continue;

      const orderType = openTypeFor(side);
      const mark = leader.mark;
      const price = copyPriceBound(orderType, mark, policy.maxSlippageBps, this.safetyBps);
      const leaderNotional = notionalCNS(leader.lots, mark, lotDecimals, priceDecimals);
      const leaderLev = leader.depositCNS > 0n ? Number(mulDiv(leaderNotional, 100n, leader.depositCNS)) : policy.maxLeverageHdths;
      // Match now opens at the leader's effective leverage capped by the follower's max (keeper copies use the
      // leader's order leverage exactly, so a higher-leverage leader trade is blocked onchain instead).
      const leverage = Math.max(100, Math.min(leaderLev, policy.maxLeverageHdths));
      const notional = notionalCNS(lots, mark, lotDecimals, priceDecimals);
      const perplMark = await this.market.mark(m.perpId).catch(() => undefined);
      const fill = await this.market.expectedFill(m.perpId, orderType, lots, price).catch(() => undefined);
      const order: MirrorOrder = { leaderAccountId: b.leaderAccountId, perpId: m.perpId, orderType, lotLNS: lots, pricePNS: price, leverageHdths: leverage, maxMatches: this.maxMatches, leaderRef: ZERO_REF };
      orders.push(order);
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
        wouldBlock: null,
      });

      // Off-chain replay (used when the account is not funded yet, or to explain a simulated block).
      const mr = policy.markets.find((x) => x.perpId === m.perpId)!;
      const now = Math.floor(Date.now() / 1000);
      const eq = state?.equity ?? 0n;
      const r = classifyOpen(order, {
        now,
        paused: false,
        expiry: policy.expiry,
        marketAllowed: true,
        maxNotionalCNS: mr.maxNotionalCNS,
        lotDecimals,
        priceDecimals,
        leaderAllowed: true,
        maxLeverageHdths: policy.maxLeverageHdths,
        follower: { side: follower.side, lots: follower.lots },
        markValid: leader.markValid,
        mark,
        maxSlippageBps: policy.maxSlippageBps,
        leader: { side: leader.side, lots: leader.lots },
        target,
        equity: eq,
        riskDay: state?.riskDay ?? Math.floor(now / 86_400),
        dayStartEquity: state?.dayStartEquity ?? eq,
        highWaterEquity: state?.highWaterEquity ?? eq,
        dailyLossBps: policy.dailyLossBps,
        drawdownBps: policy.drawdownBps,
      });
      if (r.reason !== 'None') lines.at(-1)!.wouldBlock = { reason: r.reason, limit: r.limit.toString(), actual: r.actual.toString() };
    }

    let simulation: 'follow' | 'replay' = 'replay';
    let simulationError: string | undefined;
    if (funded && account && orders.length) {
      const data = encodeFunctionData({
        abi: mirrorAccountAbi,
        functionName: 'follow',
        args: [
          {
            ...policy,
            leaders: policy.leaders,
            markets: policy.markets,
          },
          orders.map((o) => ({ ...o })),
        ],
      });
      const sim = await simulateCall(this.client, b.owner, account, data);
      if (!sim.ok) simulationError = sim.revert?.message;
      else {
        simulation = 'follow';
        const executed = decodeBoolArray(sim.returnData, 'follow');
        let bi = 0;
        executed?.forEach((ok, i) => {
          const line = lines[i]!;
          if (ok) line.wouldBlock = null;
          else {
            const b2 = sim.blocked[bi++];
            if (b2) line.wouldBlock = { reason: b2.reason, limit: b2.limit.toString(), actual: b2.actual.toString() };
            else line.wouldBlock ??= { reason: 'Blocked', limit: '0', actual: '0' };
          }
        });
      }
    }

    const passing = orders.filter((_, i) => !lines[i]!.wouldBlock);
    return {
      owner: b.owner,
      account: account ?? null,
      deployed,
      funded,
      leaderAccountId: b.leaderAccountId,
      simulation,
      simulationError: simulationError ?? null,
      quotes: lines,
      matchOrders: passing.map((o) => ({ ...o, lotLNS: o.lotLNS.toString(), pricePNS: o.pricePNS.toString() })),
      encodedMatchOrders: encodeOrders(passing),
      followActionData: encodeFollowData(policy, passing),
    };
  }
}

export type { Address };
