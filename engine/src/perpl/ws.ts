import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { Logger } from '../log.js';
import { metrics } from '../metrics.js';
import type { BlockTimestamp, L2Level, MarketState } from './rest.js';

export interface Trade {
  at: BlockTimestamp & { tx?: number; txid?: string };
  p: number;
  s: number;
  sd: 1 | 2;
}

type Msg = {
  mt: number;
  sid?: number;
  sn?: number;
  subs?: Array<{ stream: string; sid?: number; status?: { code: number; error?: string } }>;
  d?: unknown;
  at?: BlockTimestamp;
  bid?: L2Level[];
  ask?: L2Level[];
  h?: number;
};

export class BookSide {
  private levels = new Map<number, number>();
  constructor(private readonly desc: boolean) {}
  reset(levels: L2Level[]) {
    this.levels.clear();
    this.apply(levels);
  }
  apply(levels: L2Level[]) {
    for (const l of levels) {
      if (l.o === 0 || l.s === 0) this.levels.delete(l.p);
      else this.levels.set(l.p, l.s);
    }
  }
  sorted(): Array<{ p: number; s: number }> {
    return [...this.levels]
      .map(([p, s]) => ({ p, s }))
      .sort((a, b) => (this.desc ? b.p - a.p : a.p - b.p));
  }
  best(): number | undefined {
    let best: number | undefined;
    for (const p of this.levels.keys()) if (best === undefined || (this.desc ? p > best : p < best)) best = p;
    return best;
  }
}

export interface BookState {
  bids: BookSide;
  asks: BookSide;
  at?: BlockTimestamp;
  updatedMs: number;
}

/**
 * Perpl market-data WebSocket: market-state for all markets, order-book and trades for selected markets.
 * One subscription frame per connection (the server allows 10 requests/min and 16 subscriptions).
 */
export class PerplWs extends EventEmitter {
  private ws?: WebSocket;
  private closed = false;
  private backoff = 1_000;
  private bySid = new Map<number, { kind: 'state' | 'book' | 'trades' | 'heartbeat'; market?: number }>();
  connected = false;
  lastMessageMs = 0;
  headBlock = 0;
  readonly states = new Map<number, { state: MarketState; updatedMs: number }>();
  readonly books = new Map<number, BookState>();
  readonly trades = new Map<number, Trade[]>();

  constructor(
    private readonly url: string,
    private readonly chainId: number,
    private readonly bookMarkets: number[],
    private readonly tradeMarkets: number[],
    private readonly log: Logger,
  ) {
    super();
  }

  start() {
    this.connect();
  }

  private streams(): string[] {
    const s = [`market-state@${this.chainId}`, `heartbeat@${this.chainId}`];
    for (const m of this.bookMarkets) s.push(`order-book@${m}`);
    for (const m of this.tradeMarkets) s.push(`trades@${m}`);
    return s.slice(0, 16);
  }

  private connect() {
    const ws = new WebSocket(`${this.url}/ws/v1/market-data`, { handshakeTimeout: 10_000 });
    this.ws = ws;
    let ping: NodeJS.Timeout | undefined;
    ws.on('open', () => {
      this.connected = true;
      this.backoff = 1_000;
      metrics.perplWsConnected.set(1);
      const subs = this.streams().map((stream) => ({ stream, subscribe: true }));
      ws.send(JSON.stringify({ mt: 5, subs }));
      ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 25_000);
      this.log.info({ url: this.url, streams: subs.length }, 'perpl ws connected');
    });
    ws.on('message', (raw) => this.onMessage(raw.toString()));
    ws.on('error', (err) => this.log.warn({ err: err.message }, 'perpl ws error'));
    ws.on('close', (code, reason) => {
      clearInterval(ping);
      this.connected = false;
      metrics.perplWsConnected.set(0);
      this.bySid.clear();
      if (this.closed) return;
      this.log.warn({ code, reason: reason.toString(), retryMs: this.backoff }, 'perpl ws closed; reconnecting');
      setTimeout(() => !this.closed && this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    });
  }

  private onMessage(text: string) {
    let m: Msg;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    this.lastMessageMs = Date.now();
    metrics.perplWsMessages.inc({ mt: m.mt });
    switch (m.mt) {
      case 6:
        for (const s of m.subs ?? []) {
          if (s.status && s.status.code !== 0) {
            this.log.warn({ stream: s.stream, status: s.status }, 'perpl ws subscription failed');
            continue;
          }
          if (s.sid === undefined) continue;
          const [kind, arg] = s.stream.split('@');
          const market = Number(arg);
          if (kind === 'market-state') this.bySid.set(s.sid, { kind: 'state' });
          else if (kind === 'order-book') this.bySid.set(s.sid, { kind: 'book', market });
          else if (kind === 'trades') this.bySid.set(s.sid, { kind: 'trades', market });
          else if (kind === 'heartbeat') this.bySid.set(s.sid, { kind: 'heartbeat' });
        }
        return;
      case 9: {
        const d = (m.d ?? {}) as Record<string, MarketState | undefined>;
        const now = Date.now();
        for (const [id, st] of Object.entries(d)) if (st) this.states.set(Number(id), { state: st, updatedMs: now });
        this.emit('state');
        return;
      }
      case 15:
      case 16: {
        const sub = m.sid !== undefined ? this.bySid.get(m.sid) : undefined;
        if (!sub?.market) return;
        let book = this.books.get(sub.market);
        if (!book || m.mt === 15) {
          book = { bids: new BookSide(true), asks: new BookSide(false), updatedMs: 0 };
          this.books.set(sub.market, book);
          book.bids.reset(m.bid ?? []);
          book.asks.reset(m.ask ?? []);
        } else {
          book.bids.apply(m.bid ?? []);
          book.asks.apply(m.ask ?? []);
        }
        book.at = m.at;
        book.updatedMs = Date.now();
        return;
      }
      case 17:
      case 18: {
        const sub = m.sid !== undefined ? this.bySid.get(m.sid) : undefined;
        if (!sub?.market) return;
        const list = m.mt === 17 ? [] : (this.trades.get(sub.market) ?? []);
        list.push(...((m.d as Trade[]) ?? []));
        this.trades.set(sub.market, list.slice(-50));
        if (m.mt === 18) this.emit('trades', sub.market);
        return;
      }
      case 100:
        if (typeof m.h === 'number') this.headBlock = m.h;
        return;
      default:
        return;
    }
  }

  stop() {
    this.closed = true;
    this.ws?.close();
  }
}
