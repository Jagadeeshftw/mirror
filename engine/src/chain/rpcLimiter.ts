// One request budget for every JSON-RPC call the engine makes. Public Monad endpoints cap requests per second (the
// testnet RPC answers "requests limited to 15/sec"), and the stop executor, registry and balance polling would
// otherwise starve a copy's simulation and send. RPC_MAX_RPS (0 = no limit) sets the budget; calls made inside
// rpcPriority.run('high', ...) (the copy path) and transaction sends / gas estimates go ahead of background reads.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Priority = 'high' | 'normal';
export const rpcPriority = new AsyncLocalStorage<Priority>();

/** Methods that are part of sending a transaction: always high priority. */
const HIGH_METHODS = /"method"\s*:\s*"(eth_sendRawTransaction(Sync)?|eth_estimateGas|eth_getTransactionReceipt|eth_simulateV1|eth_getTransactionCount)"/;

export class RpcLimiter {
  private readonly gapMs: number;
  private next = 0;
  private readonly queues: Record<Priority, Array<() => void>> = { high: [], normal: [] };
  private timer: NodeJS.Timeout | undefined;
  waited = 0;

  constructor(readonly maxRps: number) {
    this.gapMs = maxRps > 0 ? Math.ceil(1000 / maxRps) : 0;
  }

  /** Resolves when this call may go out. */
  acquire(priority: Priority): Promise<void> {
    if (this.gapMs === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.queues[priority].push(resolve);
      this.pump();
    });
  }

  private pump() {
    if (this.timer) return;
    const run = () => {
      this.timer = undefined;
      if (!this.queues.high.length && !this.queues.normal.length) return;
      const wait = this.next - Date.now();
      if (wait > 0) {
        this.waited++;
        this.timer = setTimeout(run, wait);
        return;
      }
      const job = (this.queues.high.shift() ?? this.queues.normal.shift())!;
      this.next = Date.now() + this.gapMs;
      job();
      if (this.queues.high.length || this.queues.normal.length) this.timer = setTimeout(run, this.gapMs);
    };
    run();
  }

  /** A fetch for viem's http transport that takes a slot first. */
  fetchFn(): typeof fetch {
    return async (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      const priority: Priority = rpcPriority.getStore() === 'high' || HIGH_METHODS.test(body) ? 'high' : 'normal';
      await this.acquire(priority);
      return fetch(input, init);
    };
  }
}
