import type { Address, PublicClient } from 'viem';
import { perplExchangeAbi } from '../abi/PerplExchange.js';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { authTokenAbi } from '../abi/erc20.js';
import { mirrorAccountFactoryAbi } from '../abi/MirrorAccountFactory.js';
import type { Level, Side } from '../domain/types.js';

export interface PerplPosition {
  side: Side;
  lots: bigint;
  mark: bigint;
  markValid: boolean;
  depositCNS: bigint;
  entryPricePNS: bigint;
  pnlCNS: bigint;
}

export interface AccountState {
  address: Address;
  owner: Address;
  perplAccountId: number;
  paused: boolean;
  expiry: number;
  maxLeverageHdths: number;
  maxSlippageBps: number;
  dailyLossBps: number;
  drawdownBps: number;
  maxEntryDeviationBps: number;
  stopSlippageBps: number;
  flattenOnStop: boolean;
  maxBuilderFeePer100K: number;
  leaders: { accountId: number; ratioBps: number; budgetCNS: bigint; lossStopBps: number }[];
  markets: { perpId: number; allowed: boolean; halted: boolean; lotDecimals: number; priceDecimals: number; maxNotionalCNS: bigint }[];
  equity: bigint;
  riskDay: number;
  dayStartEquity: bigint;
  highWaterEquity: bigint;
  netDeposits: bigint;
  idleBalance: bigint;
  actionNonce: bigint;
}

export interface LeaderBook {
  marginCNS: bigint;
  unrealizedCNS: bigint;
  realizedCNS: bigint;
  stopped: boolean;
}

/** Contract-wide Perpl builder attribution (MirrorAccount.BUILDER_ID / BUILDER_FEE_PER_100K immutables). */
export interface BuilderInfo {
  id: number;
  feePer100K: number;
}

export interface OraclePrice {
  oraclePNS: bigint;
  /** Same freshness rule as MirrorAccount._trustedMark. */
  fresh: boolean;
}

export class Reads {
  constructor(
    readonly client: PublicClient,
    readonly exchange: Address,
    readonly collateral: Address,
    /** Mirror factory: its builder immutables equal every account's (shared implementation). */
    public factory?: Address,
  ) {}

  private builderCache: Promise<BuilderInfo> | undefined;

  /**
   * The builder id and fee every account is deployed with. Immutable, so read once: from the factory when known,
   * else from `account` (any clone returns the implementation's immutables). No source: no attribution.
   */
  builder(account?: Address): Promise<BuilderInfo> {
    if (this.builderCache) return this.builderCache;
    let p: Promise<BuilderInfo>;
    if (this.factory) {
      const c = { address: this.factory, abi: mirrorAccountFactoryAbi } as const;
      p = Promise.all([this.client.readContract({ ...c, functionName: 'builderId' }), this.client.readContract({ ...c, functionName: 'builderFeePer100K' })])
        .then(([id, fee]) => ({ id: Number(id), feePer100K: Number(fee) }));
    } else if (account) {
      const c = { address: account, abi: mirrorAccountAbi } as const;
      p = Promise.all([this.client.readContract({ ...c, functionName: 'BUILDER_ID' }), this.client.readContract({ ...c, functionName: 'BUILDER_FEE_PER_100K' })])
        .then(([id, fee]) => ({ id: Number(id), feePer100K: Number(fee) }));
    } else {
      return Promise.resolve({ id: 0, feePer100K: 0 });
    }
    this.builderCache = p;
    p.catch(() => { if (this.builderCache === p) this.builderCache = undefined; });
    return p;
  }

  async position(perpId: number, accountId: number): Promise<PerplPosition> {
    const [p, mark, valid] = await this.client.readContract({
      address: this.exchange,
      abi: perplExchangeAbi,
      functionName: 'getPositionV2',
      args: [BigInt(perpId), BigInt(accountId)],
    });
    return {
      side: (p.positionType === 1 ? 1 : 0) as Side,
      lots: p.lotLNS,
      mark,
      markValid: valid,
      depositCNS: p.depositCNS,
      entryPricePNS: p.pricePNS,
      pnlCNS: p.deltaPnlCNS + p.premiumPnlCNS,
    };
  }

  async accountAddress(accountId: number): Promise<Address | undefined> {
    try {
      const a = await this.client.readContract({ address: this.exchange, abi: perplExchangeAbi, functionName: 'getAccountById', args: [BigInt(accountId)] });
      return a.accountAddr;
    } catch {
      return undefined;
    }
  }

  async accountIdOf(addr: Address): Promise<number> {
    const a = await this.client.readContract({ address: this.exchange, abi: perplExchangeAbi, functionName: 'getAccountByAddr', args: [addr] });
    return Number(a.accountId);
  }

  async perplBalance(accountId: number): Promise<bigint> {
    const a = await this.client.readContract({ address: this.exchange, abi: perplExchangeAbi, functionName: 'getAccountById', args: [BigInt(accountId)] });
    return a.balanceCNS;
  }

  async tokenBalance(addr: Address): Promise<bigint> {
    return this.client.readContract({ address: this.collateral, abi: authTokenAbi, functionName: 'balanceOf', args: [addr] });
  }

  /** MirrorAccount.equity(): idle collateral plus the Perpl account's value. */
  async equity(address: Address): Promise<bigint> {
    return this.client.readContract({ address, abi: mirrorAccountAbi, functionName: 'equity' });
  }

  async account(address: Address): Promise<AccountState> {
    const c = { address, abi: mirrorAccountAbi } as const;
    const r = this.client;
    const [owner, perplAccountId, paused, expiry, maxLev, maxSlip, dailyLoss, drawdown, maxEntryDev, stopSlip, flatten, maxBuilderFee, leaders, marketIds, equity, riskDay, dayStart, hwm, netDeposits, actionNonce, idle] =
      await Promise.all([
        r.readContract({ ...c, functionName: 'owner' }),
        r.readContract({ ...c, functionName: 'perplAccountId' }),
        r.readContract({ ...c, functionName: 'paused' }),
        r.readContract({ ...c, functionName: 'expiry' }),
        r.readContract({ ...c, functionName: 'maxLeverageHdths' }),
        r.readContract({ ...c, functionName: 'maxSlippageBps' }),
        r.readContract({ ...c, functionName: 'dailyLossBps' }),
        r.readContract({ ...c, functionName: 'drawdownBps' }),
        r.readContract({ ...c, functionName: 'maxEntryDeviationBps' }),
        r.readContract({ ...c, functionName: 'stopSlippageBps' }),
        r.readContract({ ...c, functionName: 'flattenOnStop' }),
        r.readContract({ ...c, functionName: 'maxBuilderFeePer100K' }),
        r.readContract({ ...c, functionName: 'leaders' }),
        r.readContract({ ...c, functionName: 'marketIds' }),
        r.readContract({ ...c, functionName: 'equity' }),
        r.readContract({ ...c, functionName: 'riskDay' }),
        r.readContract({ ...c, functionName: 'dayStartEquity' }),
        r.readContract({ ...c, functionName: 'highWaterEquity' }),
        r.readContract({ ...c, functionName: 'netDeposits' }),
        r.readContract({ ...c, functionName: 'actionNonce' }),
        this.tokenBalance(address),
      ]);
    const markets = await Promise.all(
      marketIds.map(async (id) => {
        const [allowed, halted, lotDecimals, priceDecimals, maxNotionalCNS] = await r.readContract({ ...c, functionName: 'markets', args: [BigInt(id)] });
        return { perpId: Number(id), allowed, halted, lotDecimals, priceDecimals, maxNotionalCNS };
      }),
    );
    return {
      address,
      owner,
      perplAccountId: Number(perplAccountId),
      paused,
      expiry: Number(expiry),
      maxLeverageHdths: maxLev,
      maxSlippageBps: maxSlip,
      dailyLossBps: dailyLoss,
      drawdownBps: drawdown,
      maxEntryDeviationBps: maxEntryDev,
      stopSlippageBps: stopSlip,
      flattenOnStop: flatten,
      maxBuilderFeePer100K: Number(maxBuilderFee),
      leaders: leaders.map((l) => ({ accountId: Number(l.accountId), ratioBps: Number(l.ratioBps), budgetCNS: l.budgetCNS, lossStopBps: Number(l.lossStopBps) })),
      markets,
      equity,
      riskDay: Number(riskDay),
      dayStartEquity: dayStart,
      highWaterEquity: hwm,
      netDeposits,
      idleBalance: idle,
      actionNonce,
    };
  }

  /** MirrorAccount.marketLeader(perpId): the leader whose copy opened the position held in the market. */
  async marketLeader(account: Address, perpId: number): Promise<number> {
    return Number(await this.client.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'marketLeader', args: [BigInt(perpId)] }));
  }

  async leaderBook(account: Address, leaderAccountId: number): Promise<LeaderBook> {
    const [marginCNS, unrealizedCNS, realizedCNS, stopped] = await this.client.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'leaderBook', args: [leaderAccountId] });
    return { marginCNS, unrealizedCNS, realizedCNS, stopped };
  }

  /** MirrorAccount.leaderDetached(leader): the owner stopped following this leader (every copy of it is refused). */
  async leaderDetached(account: Address, leaderAccountId: number): Promise<boolean> {
    return this.client.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'leaderDetached', args: [leaderAccountId] });
  }

  async level(account: Address, perpId: number): Promise<Level> {
    const l = await this.client.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'level', args: [BigInt(perpId)] });
    return { perpId: Number(l.perpId), side: (l.side === 1 ? 1 : 0) as Side, stopLossPNS: l.stopLossPNS, takeProfitPNS: l.takeProfitPNS, slippageBps: l.slippageBps };
  }

  /** MirrorAccount.targetLots view (the contract's own number, used to cross-check the planner). */
  async targetLots(account: Address, perpId: number, leaderAccountId: number, side: Side): Promise<bigint> {
    return this.client.readContract({ address: account, abi: mirrorAccountAbi, functionName: 'targetLots', args: [BigInt(perpId), leaderAccountId, side] });
  }

  /** Perpl's Chainlink price for a market and whether the stop triggers would treat it as fresh. */
  async oracle(perpId: number): Promise<OraclePrice> {
    const [info, block] = await Promise.all([
      this.client.readContract({ address: this.exchange, abi: perplExchangeAbi, functionName: 'getPerpetualInfoV2', args: [BigInt(perpId)] }),
      this.client.getBlock(),
    ]);
    const fresh = !info.ignOracle && info.oraclePNS !== 0n && info.oracleTimestampSec + info.refPriceMaxAgeSec >= block.timestamp;
    return { oraclePNS: info.oraclePNS, fresh };
  }
}
