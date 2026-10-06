/** Fixed-window counters keyed by an arbitrary string (IP, owner, 'global'). In memory; one engine instance. */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Counts a hit and reports whether it is within `limit` per `windowMs`. */
  hit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; resetAt: number } {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
    }
    if (w.count >= limit) return { ok: false, remaining: 0, resetAt: w.resetAt };
    w.count += 1;
    if (this.windows.size > 50_000) this.sweep(t);
    return { ok: true, remaining: limit - w.count, resetAt: w.resetAt };
  }

  /** Checks without counting. */
  peek(key: string, limit: number): boolean {
    const w = this.windows.get(key);
    return !w || this.now() >= w.resetAt || w.count < limit;
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (t >= w.resetAt) this.windows.delete(k);
  }
}

export class RateLimitError extends Error {
  constructor(readonly scope: string, readonly resetAt: number) {
    super(`rate limited (${scope})`);
  }
}
