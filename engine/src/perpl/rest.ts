/** Perpl public REST API (no key). https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md */

export interface BlockTimestamp {
  b: number;
  t: number;
}

export interface MarketState {
  at: BlockTimestamp;
  orl: number;
  mrk: number;
  lst: number;
  mid: number;
  bid: number;
  ask: number;
  prv: number;
  dv: number;
  dva: string;
  oi: number;
  tvl: string;
}

export interface ContextMarket {
  id: number;
  perpetual_id: number;
  name: string;
  symbol: string;
  size_units?: string;
  order_ttl_blocks?: number;
  order_max_market_slippage_bps?: number;
  order_max_neg_pnl_collat_bps?: number;
  funding_interval_sec?: number;
  config: {
    is_open: boolean;
    price_decimals: number;
    size_decimals: number;
    min_posting_amount: string;
    min_settle_amount: string;
    initial_margin: number;
    maintenance_margin: number;
    maker_fee: number;
    taker_fee: number;
  };
  state?: MarketState;
  funding?: { at: BlockTimestamp; rate: number; idx?: number; sum?: number };
}

export interface PerplContext {
  chain: { chain_id: number; name: string; gas?: { base?: string; p50?: string } };
  instances: Array<{ id: number; address: string; min_account_open_amount: string; min_deposit_amount?: string }>;
  tokens: Array<{ id: number; address: string; symbol: string; decimals: number }>;
  markets: ContextMarket[];
  features?: unknown;
}

export interface L2Level {
  p: number;
  s: number;
  o: number;
}

export interface L2Book {
  mt: number;
  sn?: number;
  at: BlockTimestamp;
  bid: L2Level[];
  ask: L2Level[];
}

export class PerplRest {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 8_000) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`perpl ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  context() {
    return this.get<PerplContext>('/v1/pub/context');
  }

  ticker() {
    return this.get<{ mt: number; sn: number; d: Record<string, MarketState> }>('/v1/market-data/ticker');
  }

  book(marketId: number, levels = 50) {
    return this.get<L2Book>(`/v1/market-data/${marketId}/book?levels=${levels}`);
  }
}
