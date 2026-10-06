import type { Address, PublicClient } from 'viem';
import { perplExchangeAbi } from '../abi/PerplExchange.js';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import { authTokenAbi } from '../abi/erc20.js';
import type { Side } from '../domain/types.js';

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
  leaders: { accountId: number; ratioBps: number }[];
  markets: { perpId: number; allowed: boolean; lotDecimals: number; priceDecimals: number; maxNotionalCNS: bigint }[];
  equity: bigint;
  riskDay: number;
  dayStartEquity: bigint;
  highWaterEquity: bigint;
  netDeposits: bigint;
  idleBalance: bigint;
  actionNonce: bigint;
}

export class Reads {
  constructor(
    readonly client: PublicClient,
    readonly exchange: Address,
    readonly collateral: Address,
  ) {}

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

  async account(address: Address): Promise<AccountState> {
    const c = { address, abi: mirrorAccountAbi } as const;
    const r = this.client;
    const [owner, perplAccountId, paused, expiry, maxLev, maxSlip, dailyLoss, drawdown, leaders, marketIds, equity, riskDay, dayStart, hwm, netDeposits, actionNonce, idle] =
      await Promise.all([
        r.readContract({ ...c, functionName: 'owner' }),
        r.readContract({ ...c, functionName: 'perplAccountId' }),
        r.readContract({ ...c, functionName: 'paused' }),
        r.readContract({ ...c, functionName: 'expiry' }),
        r.readContract({ ...c, functionName: 'maxLeverageHdths' }),
        r.readContract({ ...c, functionName: 'maxSlippageBps' }),
        r.readContract({ ...c, functionName: 'dailyLossBps' }),
        r.readContract({ ...c, functionName: 'drawdownBps' }),
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
        const [allowed, lotDecimals, priceDecimals, maxNotionalCNS] = await r.readContract({ ...c, functionName: 'markets', args: [BigInt(id)] });
        return { perpId: Number(id), allowed, lotDecimals, priceDecimals, maxNotionalCNS };
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
      leaders: leaders.map((l) => ({ accountId: Number(l.accountId), ratioBps: Number(l.ratioBps) })),
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
}
