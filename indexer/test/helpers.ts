/** Builders for simulated events. Each `tx()` starts a new transaction in a new block. */
export const DAY = 86_400;
/** A UTC midnight: 2026-10-01T00:00:00Z */
export const T0 = 1_790_812_800;
export const ETH = 20n; // lotDecimals 3, priceDecimals 2
export const LONG = 0n;
export const SHORT = 1n;
export const usd = (n: number) => BigInt(Math.round(n * 1_000_000)); // CNS

export const FACTORY = "0x00000000000000000000000000000000000000fA";
export const ZERO_REF = `0x${"00".repeat(32)}`;
export const MATCH_NOW = "0xba0016f6adaf21b42d77802a90dc5029b55fb1e05349c9553b7e1c7ed60e7d12";

export const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

type Item = Record<string, unknown>;

export type Proof = { leaderFillPNS: bigint; leaderEntryPNS: bigint; markPNS: bigint; fillPNS: bigint; entryDeviationBps: bigint; builderFeeCNS: bigint };

export class Timeline {
  private blockNo = 60_000_100;
  private ts = T0;
  private hash = "";
  private log = 0;
  readonly items: Item[] = [];

  /** Start a new transaction at unix time `ts`, `blocks` blocks after the previous one. */
  tx(ts: number, blocks = 1): this {
    this.blockNo += blocks;
    this.ts = ts;
    this.hash = `0x${this.blockNo.toString(16).padStart(64, "0")}`;
    this.log = 0;
    return this;
  }

  get txHash(): string {
    return this.hash;
  }

  get block(): number {
    return this.blockNo;
  }

  /** Leave `n` log indexes unused in the current transaction. */
  skip(n = 1): this {
    this.log += n;
    return this;
  }

  add(contract: string, event: string, params: Record<string, unknown>, srcAddress?: string, logIndex?: number): this {
    this.items.push({
      contract,
      event,
      params,
      ...(srcAddress ? { srcAddress } : {}),
      block: { number: this.blockNo, timestamp: this.ts },
      transaction: { hash: this.hash },
      logIndex: logIndex ?? this.log++,
    });
    return this;
  }

  // ---- Perpl
  open(accountId: bigint, perpId: bigint, side: bigint, lots: bigint, price: bigint, o: { lev?: bigint; fee?: bigint; residue?: bigint } = {}): this {
    return this.add("PerplExchange", "PositionOpenedV2", {
      perpId, accountId, positionType: side, leverageHdths: o.lev ?? 500n, depositCNS: 1_000_000n,
      pnlCollateralizedCNS: 0n, pricePNS: price, lotLNS: lots, insFeeCNS: 0n, protFeeCNS: o.fee ?? 0n,
      priceResiduePNSQ16: o.residue ?? 0n,
    });
  }

  increase(accountId: bigint, perpId: bigint, side: bigint, start: bigint, end: bigint, newEntry: bigint, o: { lev?: bigint; fee?: bigint } = {}): this {
    return this.add("PerplExchange", "PositionIncreasedV2", {
      perpId, accountId, positionType: side, leverageHdths: o.lev ?? 500n, startDepositCNS: 1_000_000n,
      endDepositCNS: 2_000_000n, pnlCollateralizedCNS: 0n, premiumPnlSettledCNS: 0n, maxNegPnlCollatBPS: 300n,
      pricePNS: newEntry, startLotLNS: start, endLotLNS: end, insFeeCNS: 0n, protFeeCNS: o.fee ?? 0n,
      priceResiduePNSQ16: 0n,
    });
  }

  decrease(accountId: bigint, perpId: bigint, side: bigint, start: bigint, end: bigint, pnl: bigint, funding = 0n): this {
    return this.add("PerplExchange", "PositionDecreased", {
      perpId, accountId, positionType: side, startDepositCNS: 2_000_000n, endDepositCNS: 1_000_000n,
      startLotLNS: start, endLotLNS: end, deltaPnlCNS: pnl, fundingCNS: funding,
    });
  }

  close(accountId: bigint, perpId: bigint, side: bigint, price: bigint, pnl: bigint, funding = 0n): this {
    return this.add("PerplExchange", "PositionClosed", {
      perpId, accountId, positionType: side, pricePNS: price, deltaPnlCNS: pnl, fundingCNS: funding,
    });
  }

  invert(accountId: bigint, perpId: bigint, newSide: bigint, start: bigint, end: bigint, price: bigint, pnl: bigint, o: { lev?: bigint; fee?: bigint } = {}): this {
    return this.add("PerplExchange", "PositionInverted", {
      perpId, accountId, positionType: newSide, leverageHdths: o.lev ?? 500n, startDepositCNS: 1_000_000n,
      endDepositCNS: 3_000_000n, pnlCollateralizedCNS: 0n, pricePNS: price, startLotLNS: start, endLotLNS: end,
      deltaPnlCNS: pnl, fundingCNS: 0n, insFeeCNS: 0n, protFeeCNS: o.fee ?? 0n,
    });
  }

  liquidate(accountId: bigint, perpId: bigint, side: bigint, liqLots: bigint, remaining: bigint, liqPrice: bigint, pnl: bigint): this {
    return this.add("PerplExchange", "PositionLiquidated", {
      perpId, posAccountId: accountId, positionType: side, markPricePNS: liqPrice, liqPricePNS: liqPrice,
      liqLotLNS: liqLots, posLotLNS: remaining, deltaPnlCNS: pnl, fundingCNS: 0n, posAmountCNS: 0n,
      posDepositCNS: 0n, accAmountCNS: 0n, accBalanceCNS: 0n, onOrderBook: true,
    });
  }

  /** Perpl TakerOrderFilledV2 (builder id 26 = Mirror by default). `logIndex` overrides the next log index. */
  takerFill(builderFeeCNS: bigint, o: { builderId?: bigint; lot?: bigint; price?: bigint; fee?: bigint; logIndex?: number } = {}): this {
    return this.add("PerplExchange", "TakerOrderFilledV2", {
      entryPricePNS: o.price ?? 300000n, collatPricePNS: o.price ?? 300000n, pnlPricePNS: o.price ?? 300000n,
      lotLNS: o.lot ?? 100n, feeCNS: o.fee ?? 0n, amountCNS: 0n, balanceCNS: 0n, builderId: o.builderId ?? 26n,
      builderFeeCNS,
    }, undefined, o.logIndex);
  }

  deposit(accountId: bigint, amount: bigint, balance: bigint): this {
    return this.add("PerplExchange", "CollateralDeposit", { accountId, amountCNS: amount, balanceCNS: balance });
  }

  perplAccountCreated(account: string, id: bigint): this {
    return this.add("PerplExchange", "AccountCreated", { account, id });
  }

  // ---- Mirror
  createMirror(owner: string, account: string): this {
    return this.add("MirrorAccountFactory", "AccountCreated", { owner, account, salt: ZERO_REF }, FACTORY);
  }

  mirror(src: string, event: string, params: Record<string, unknown>): this {
    return this.add("MirrorAccount", event, params, src);
  }

  mirrored(src: string, o: { leader: bigint; perpId: bigint; orderType: bigint; lot: bigint; price: bigint; before: bigint; after: bigint; lev?: bigint; ref?: string; keeper?: string; proof?: Partial<Proof> }): this {
    return this.mirror(src, "Mirrored", {
      keeper: o.keeper ?? addr(0xbeef), leaderAccountId: o.leader, perpId: o.perpId, orderType: o.orderType,
      lotLNS: o.lot, pricePNS: o.price, leverageHdths: o.lev ?? 500n, lotsBefore: o.before, lotsAfter: o.after,
      leaderRef: o.ref ?? `0x${"ab".repeat(32)}`,
      proof: { leaderFillPNS: 0n, leaderEntryPNS: 0n, markPNS: 0n, fillPNS: 0n, entryDeviationBps: 0n, builderFeeCNS: 0n, ...o.proof },
    });
  }

  blocked(src: string, o: { leader: bigint; perpId: bigint; reason: bigint; limit: bigint; actual: bigint; orderType?: bigint; lot?: bigint; leaderFill?: bigint; mark?: bigint }): this {
    return this.mirror(src, "Blocked", {
      keeper: addr(0xbeef), leaderAccountId: o.leader, perpId: o.perpId, reason: o.reason, orderType: o.orderType ?? 0n,
      lotLNS: o.lot ?? 100n, limit: o.limit, actual: o.actual, leaderRef: `0x${"cd".repeat(32)}`,
      leaderFillPNS: o.leaderFill ?? 0n, markPNS: o.mark ?? 0n,
    });
  }

  /** leaders: [accountId, ratioBps, budgetCNS?, lossStopBps?] */
  policy(src: string, leaders: [bigint, bigint, bigint?, bigint?][], markets: [bigint, bigint][], o: { maxLev?: bigint; maxEntryDev?: bigint; flatten?: boolean; maxBuilderFee?: bigint } = {}): this {
    return this.mirror(src, "PolicyUpdated", {
      maxLeverageHdths: o.maxLev ?? 1000n, maxSlippageBps: 50n, dailyLossBps: 500n, drawdownBps: 1000n,
      expiry: BigInt(T0 + 30 * DAY), maxEntryDeviationBps: o.maxEntryDev ?? 0n, stopSlippageBps: 300n,
      flattenOnStop: o.flatten ?? false, maxBuilderFeePer100K: o.maxBuilderFee ?? 20n,
      leaders: leaders.map(([accountId, ratioBps, budgetCNS, lossStopBps]) => ({
        accountId, ratioBps, budgetCNS: budgetCNS ?? 100_000_000n, lossStopBps: lossStopBps ?? 0n,
      })),
      markets: markets.map(([perpId, maxNotionalCNS]) => ({ perpId, maxNotionalCNS })),
    });
  }
}

export function chain143(items: Item[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { chains: { 143: { simulate: items as any } } };
}
