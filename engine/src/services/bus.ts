import { EventEmitter } from 'node:events';

export interface BusEvent {
  type: string;
  [k: string]: unknown;
}

/** In-process pub/sub keyed by channel (a lowercase account address, or 'demo'). Feeds SSE and push. */
export class Bus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(10_000);
  }
  publish(channel: string, event: BusEvent) {
    this.ee.emit(channel.toLowerCase(), event);
    this.ee.emit('*', channel.toLowerCase(), event);
  }
  subscribe(channel: string, fn: (e: BusEvent) => void): () => void {
    const c = channel.toLowerCase();
    this.ee.on(c, fn);
    return () => this.ee.off(c, fn);
  }
  subscribeAll(fn: (channel: string, e: BusEvent) => void): () => void {
    this.ee.on('*', fn);
    return () => this.ee.off('*', fn);
  }
}
