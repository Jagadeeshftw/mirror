import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { Logger } from '../log.js';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
type SubSpec = { params: unknown[]; onData: (data: unknown) => void; id?: string };

export class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/**
 * JSON-RPC over WebSocket with automatic reconnect and re-subscription. Emits 'open' after every (re)connect,
 * so callers can backfill gaps.
 */
export class RpcWs extends EventEmitter {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<number, SubSpec>();
  private bySubId = new Map<string, SubSpec>();
  private closed = false;
  private backoff = 500;
  private pingTimer?: NodeJS.Timeout;
  connected = false;

  constructor(readonly url: string, private readonly log: Logger) {
    super();
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, { handshakeTimeout: 10_000 });
      this.ws = ws;
      let settled = false;
      let opened = false;
      ws.on('open', () => {
        opened = true;
        this.connected = true;
        this.backoff = 500;
        settled = true;
        resolve();
        this.pingTimer = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 20_000);
        void this.resubscribe().then(() => this.emit('open'));
      });
      ws.on('message', (raw) => this.onMessage(raw.toString()));
      ws.on('error', (err) => {
        this.log.warn({ err: err.message, url: this.url }, 'rpc ws error');
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      ws.on('close', () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('ws closed'));
        }
        this.pending.clear();
        this.bySubId.clear();
        this.emit('close');
        if (!this.closed && opened) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect() {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15_000);
    setTimeout(() => {
      if (this.closed) return;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private onMessage(text: string) {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string }; method?: string; params?: { subscription: string; result: unknown } };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.method === 'eth_subscription' && msg.params) {
      this.bySubId.get(msg.params.subscription)?.onData(msg.params.result);
      return;
    }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message));
      else p.resolve(msg.result);
    }
  }

  request<T = unknown>(method: string, params: unknown[] = [], timeoutMs = 15_000): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.reject(new Error('ws not connected'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ws request ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Subscribes and keeps the subscription alive across reconnects. Rejects if the first attempt fails. */
  async subscribe(params: unknown[], onData: (data: unknown) => void): Promise<() => void> {
    const key = this.nextId++;
    const spec: SubSpec = { params, onData };
    const id = await this.request<string>('eth_subscribe', params);
    spec.id = id;
    this.subs.set(key, spec);
    this.bySubId.set(id, spec);
    return () => {
      this.subs.delete(key);
      if (spec.id) {
        this.bySubId.delete(spec.id);
        this.request('eth_unsubscribe', [spec.id]).catch(() => {});
      }
    };
  }

  private async resubscribe() {
    for (const spec of this.subs.values()) {
      try {
        const id = await this.request<string>('eth_subscribe', spec.params);
        spec.id = id;
        this.bySubId.set(id, spec);
      } catch (err) {
        this.log.error({ err: (err as Error).message, params: spec.params }, 'resubscribe failed');
      }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
