/**
 * Pipelined nonce allocation for one signer. Nonces are handed out without waiting for earlier transactions
 * to be mined. A nonce whose transaction was never broadcast is released and reused first, so a failed
 * submission does not leave a gap that would stall every later transaction.
 */
export class NonceManager {
  private next: number | undefined;
  private free: number[] = [];
  private loading?: Promise<number>;
  inflight = 0;

  constructor(private readonly fetchPending: () => Promise<number>) {}

  async allocate(): Promise<number> {
    if (this.next === undefined) {
      this.loading ??= this.fetchPending();
      const n = await this.loading;
      this.loading = undefined;
      if (this.next === undefined) this.next = n;
    }
    this.inflight += 1;
    if (this.free.length) return this.free.shift()!;
    return this.next++;
  }

  /** The nonce was used by a mined (or definitely broadcast) transaction. */
  confirm(_nonce: number) {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  /** The transaction with this nonce was never broadcast; hand the nonce out again. */
  release(nonce: number) {
    this.inflight = Math.max(0, this.inflight - 1);
    if (this.next !== undefined && nonce === this.next - 1 && !this.free.length) {
      this.next -= 1;
      return;
    }
    if (!this.free.includes(nonce)) {
      this.free.push(nonce);
      this.free.sort((a, b) => a - b);
    }
  }

  /**
   * Re-reads the chain's pending nonce. With nothing in flight the chain is authoritative; otherwise only move
   * forward (someone else used the key, or a "nonce too low" was reported).
   */
  async resync(): Promise<void> {
    const chain = await this.fetchPending();
    if (this.next === undefined || this.inflight === 0) {
      this.next = chain;
      this.free = [];
    } else if (chain > this.next) {
      this.next = chain;
      this.free = this.free.filter((n) => n >= chain);
    } else {
      this.free = this.free.filter((n) => n >= chain);
    }
  }

  peek() {
    return { next: this.next, free: [...this.free], inflight: this.inflight };
  }
}
