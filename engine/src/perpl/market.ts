import type { Address, PublicClient } from 'viem';
import { perplExchangeAbi } from '../abi/PerplExchange.js';
import type { MarketMeta } from '../config.js';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import { isBid } from '../domain/types.js';
import { depthWithinLimit } from '../domain/thinbook.js';
import { PerplRest, type ContextMarket, type L2Book, type MarketState, type PerplContext } from './rest.js';
import { PerplWs, type Trade } from './ws.js';

export type Source = 'ws' | 'rest' | 'chain' | 'none';

export interface MarketInfo {
  perpId: number;
  symbol: string;
  lotDecimals: number;
  priceDecimals: number;
  isOpen: boolean;
  minPostingCNS: string;
  takerFeePer100k: number | undefined;
  makerFeePer100k: number | undefined;
  initialMarginHdths: number | undefined;
  maxMarketSlippageBps: number | undefined;
}

export interface MarketView extends MarketInfo {
  markPNS: string | null;
  oraclePNS: string | null;
  lastPNS: string | null;
  bestBidPNS: string | null;
  bestAskPNS: string | null;
  fundingRatePct100k: number | null;
  openInterestLNS: string | null;
  dayVolumeLNS: string | null;
  markDisplay: number | null;
  minOrderLots: number;
  minOrderSize: string;
  source: { mark: Source; book: Source };
  markAgeMs: number | null;
  recentTrades: Array<{ pricePNS: string; lotLNS: string; side: 'buy' | 'sell'; block: number; time: number; txid?: string }>;
}

export interface BookLevels {
  bids: Array<{ p: number; s: number }>;
  asks: Array<{ p: number; s: number }>;
  source: Source;
}

const FRESH_MS = 10_000;

/**
 * Market data from Perpl's public API: market config and minimums from REST `/v1/pub/context`; mark, best
 * bid/ask, L2 book and trades from the market-data WebSocket; REST ticker/book as a fallback and the Exchange
 * contract as the last resort. The copy engine uses it for quote prices, slippage sanity checks and expected fills.
 */
export class MarketData {
  readonly rest: PerplRest;
  readonly ws?: PerplWs;
  private context?: PerplContext;
  private contextMs = 0;
  private info = new Map<number, MarketInfo>();
  private restBooks = new Map<number, { book: L2Book; ms: number }>();
  private restTicker?: { d: Record<string, MarketState>; ms: number };
  private timers: NodeJS.Timeout[] = [];
  minAccountOpenCNS: string | undefined;

  constructor(
    private readonly client: PublicClient,
    private readonly exchange: Address,
    private readonly configured: MarketMeta[],
    opts: { apiUrl: string; wsUrl: string; wsEnabled: boolean; chainId: number; bookMarkets: number[] },
    private readonly log: Logger,
  ) {
    this.rest = new PerplRest(opts.apiUrl);
    for (const m of configured) {
      this.info.set(m.perpId, {
        perpId: m.perpId,
        symbol: m.symbol,
        lotDecimals: m.lotDecimals,
        priceDecimals: m.priceDecimals,
        isOpen: true,
        minPostingCNS: '0',
        takerFeePer100k: undefined,
        makerFeePer100k: undefined,
        initialMarginHdths: undefined,
        maxMarketSlippageBps: undefined,
      });
    }
    if (opts.wsEnabled) {
      const books = opts.bookMarkets.slice(0, 7);
      const trades = opts.bookMarkets.slice(0, 7);
      this.ws = new PerplWs(opts.wsUrl, opts.chainId, books, trades, log);
    }
  }

  async start() {
    await this.refreshContext().catch((err) => this.log.warn({ err: (err as Error).message }, 'perpl context unavailable; using shared config'));
    this.ws?.start();
    this.timers.push(setInterval(() => void this.refreshContext().catch(() => {}), 5 * 60_000));
    this.timers.push(setInterval(() => this.logSnapshot(), 60_000));
    for (const t of this.timers) t.unref();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.ws?.stop();
  }

  private async refreshContext() {
    const ctx = await this.rest.context();
    this.context = ctx;
    this.contextMs = Date.now();
    this.minAccountOpenCNS = ctx.instances[0]?.min_account_open_amount;
    for (const m of ctx.markets) this.info.set(m.perpetual_id ?? m.id, this.fromContext(m));
    this.log.info(
      { markets: ctx.markets.length, minAccountOpenCNS: this.minAccountOpenCNS, gasBase: ctx.chain.gas?.base },
      'perpl context loaded (REST /v1/pub/context)',
    );
  }

  private fromContext(m: ContextMarket): MarketInfo {
    const configured = this.configured.find((c) => c.perpId === (m.perpetual_id ?? m.id));
    return {
      perpId: m.perpetual_id ?? m.id,
      symbol: configured?.symbol ?? (m.symbol || m.name),
      lotDecimals: m.config.size_decimals,
      priceDecimals: m.config.price_decimals,
      isOpen: m.config.is_open,
      minPostingCNS: m.config.min_posting_amount,
      takerFeePer100k: m.config.taker_fee,
      makerFeePer100k: m.config.maker_fee,
      initialMarginHdths: m.config.initial_margin,
      maxMarketSlippageBps: m.order_max_market_slippage_bps,
    };
  }

  get wsConnected() {
    return this.ws?.connected ?? false;
  }

  get lastMarkAt(): number | null {
    let last = 0;
    for (const s of this.ws?.states.values() ?? []) last = Math.max(last, s.updatedMs);
    return last || null;
  }

  markets(): MarketInfo[] {
    return [...this.info.values()].sort((a, b) => a.perpId - b.perpId);
  }

  meta(perpId: number): MarketInfo | undefined {
    return this.info.get(perpId);
  }

  private wsState(perpId: number) {
    const s = this.ws?.states.get(perpId);
    return s && Date.now() - s.updatedMs < FRESH_MS ? s : undefined;
  }

  private async restState(perpId: number): Promise<MarketState | undefined> {
    if (!this.restTicker || Date.now() - this.restTicker.ms > 3_000) {
      try {
        const t = await this.rest.ticker();
        this.restTicker = { d: t.d, ms: Date.now() };
      } catch {
        return undefined;
      }
    }
    return this.restTicker.d[String(perpId)];
  }

  /** Perpl mark price: WS market-state, then REST ticker, then the Exchange contract. */
  async mark(perpId: number): Promise<{ markPNS: bigint; source: Source; ageMs: number | null }> {
    const ws = this.wsState(perpId);
    if (ws) return { markPNS: BigInt(ws.state.mrk), source: 'ws', ageMs: Date.now() - ws.updatedMs };
    const rest = await this.restState(perpId);
    if (rest) return { markPNS: BigInt(rest.mrk), source: 'rest', ageMs: Date.now() - rest.at.t };
    const info = await this.client.readContract({ address: this.exchange, abi: perplExchangeAbi, functionName: 'getPerpetualInfoV2', args: [BigInt(perpId)] });
    return { markPNS: info.markPNS, source: 'chain', ageMs: null };
  }

  async book(perpId: number): Promise<BookLevels> {
    const b = this.ws?.books.get(perpId);
    if (b && Date.now() - b.updatedMs < FRESH_MS * 3) return { bids: b.bids.sorted(), asks: b.asks.sorted(), source: 'ws' };
    const cached = this.restBooks.get(perpId);
    if (cached && Date.now() - cached.ms < 2_000) return { bids: cached.book.bid, asks: cached.book.ask, source: 'rest' };
    try {
      const book = await this.rest.book(perpId, 50);
      this.restBooks.set(perpId, { book, ms: Date.now() });
      return { bids: book.bid, asks: book.ask, source: 'rest' };
    } catch {
      return { bids: [], asks: [], source: 'none' };
    }
  }

  /**
   * Volume-weighted price an IOC order of `lots` would get from the current Perpl book, limited by `limitPNS`.
   * Returns undefined when no book is available.
   */
  async expectedFill(perpId: number, orderType: number, lots: bigint, limitPNS?: bigint) {
    const book = await this.book(perpId);
    const levels = isBid(orderType) ? book.asks : book.bids;
    if (!levels.length) return undefined;
    return { ...walkBook(levels, orderType, lots, limitPNS), source: book.source };
  }

  /**
   * Lots on the taking side of `orderType` within `limitPNS`, for the thin-book guard. Source order: the WS
   * L2 book while fresh, then Perpl's REST book (the same book, polled). The Exchange contract only exposes
   * best prices without sizes, so there is no onchain depth fallback: with neither book, depth is null.
   */
  async depth(perpId: number, orderType: number, limitPNS: bigint): Promise<{ depthLots: bigint | null; source: Source; ageMs: number | null }> {
    const ws = this.ws?.books.get(perpId);
    const wsAge = ws ? Date.now() - ws.updatedMs : null;
    const book = await this.book(perpId).catch(() => undefined);
    if (!book || book.source === 'none') return { depthLots: null, source: 'none', ageMs: wsAge };
    const levels = isBid(orderType) ? book.asks : book.bids;
    if (!levels.length) return { depthLots: null, source: book.source, ageMs: book.source === 'ws' ? wsAge : null };
    return { depthLots: depthWithinLimit(book, orderType, limitPNS), source: book.source, ageMs: book.source === 'ws' ? wsAge : null };
  }

  recentTrades(perpId: number): Trade[] {
    return this.ws?.trades.get(perpId) ?? [];
  }

  async views(): Promise<MarketView[]> {
    const out: MarketView[] = [];
    for (const m of this.markets()) {
      const ws = this.wsState(m.perpId);
      const st = ws?.state ?? (await this.restState(m.perpId)) ?? this.context?.markets.find((c) => c.perpetual_id === m.perpId)?.state;
      const book = this.ws?.books.get(m.perpId);
      const funding = this.context?.markets.find((c) => c.perpetual_id === m.perpId)?.funding;
      const bestBid = book?.bids.best() ?? st?.bid;
      const bestAsk = book?.asks.best() ?? st?.ask;
      out.push({
        ...m,
        markPNS: st ? String(st.mrk) : null,
        oraclePNS: st ? String(st.orl) : null,
        lastPNS: st ? String(st.lst) : null,
        bestBidPNS: bestBid !== undefined ? String(bestBid) : null,
        bestAskPNS: bestAsk !== undefined ? String(bestAsk) : null,
        fundingRatePct100k: funding?.rate ?? null,
        openInterestLNS: st ? String(st.oi) : null,
        dayVolumeLNS: st ? String(st.dv) : null,
        markDisplay: st ? st.mrk / 10 ** m.priceDecimals : null,
        minOrderLots: 1,
        minOrderSize: (1 / 10 ** m.lotDecimals).toFixed(m.lotDecimals),
        source: { mark: ws ? 'ws' : st ? 'rest' : 'none', book: book ? 'ws' : 'none' },
        markAgeMs: ws ? Date.now() - ws.updatedMs : st ? Date.now() - st.at.t : null,
        recentTrades: this.recentTrades(m.perpId)
          .slice(-10)
          .reverse()
          .map((t) => ({ pricePNS: String(t.p), lotLNS: String(t.s), side: t.sd === 1 ? 'buy' : 'sell', block: t.at.b, time: t.at.t, txid: t.at.txid })),
      });
    }
    return out;
  }

  private logSnapshot() {
    if (!this.ws) return;
    const snap = [];
    for (const [id, s] of this.ws.states) {
      const meta = this.info.get(id);
      const book = this.ws.books.get(id);
      const last = this.ws.trades.get(id)?.at(-1);
      metrics.perplMarkAgeMs.set(Date.now() - s.updatedMs, { perpId: id });
      if (!book) continue;
      snap.push({ perpId: id, symbol: meta?.symbol, mark: s.state.mrk, bid: book.bids.best(), ask: book.asks.best(), lastTrade: last?.p });
    }
    this.log.info({ wsConnected: this.ws.connected, perplHead: this.ws.headBlock, markets: snap }, 'perpl market snapshot (WS)');
  }

  contextAgeMs() {
    return this.contextMs ? Date.now() - this.contextMs : null;
  }
}

/** Walks one side of the book (best first) for an IOC of `lots` bounded by `limitPNS`; VWAP in PNS. */
export function walkBook(levels: Array<{ p: number; s: number }>, orderType: number, lots: bigint, limitPNS?: bigint) {
  let remaining = lots;
  let cost = 0n;
  let filled = 0n;
  for (const l of levels) {
    const p = BigInt(l.p);
    if (limitPNS !== undefined && (isBid(orderType) ? p > limitPNS : p < limitPNS)) break;
    const size = BigInt(l.s);
    const take = size < remaining ? size : remaining;
    cost += take * p;
    filled += take;
    remaining -= take;
    if (remaining === 0n) break;
  }
  return { pricePNS: filled === 0n ? undefined : cost / filled, filledLots: filled };
}
