import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/services/ratelimit.js';

describe('RateLimiter', () => {
  it('allows up to the limit per window and resets after it', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    expect(rl.hit('ip:1', 2, 1000).ok).toBe(true);
    expect(rl.hit('ip:1', 2, 1000)).toMatchObject({ ok: true, remaining: 0 });
    expect(rl.hit('ip:1', 2, 1000).ok).toBe(false);
    expect(rl.hit('ip:2', 2, 1000).ok).toBe(true);
    t = 1000;
    expect(rl.hit('ip:1', 2, 1000).ok).toBe(true);
  });

  it('keys are independent (per owner vs per IP)', () => {
    const rl = new RateLimiter(() => 0);
    for (let i = 0; i < 3; i++) rl.hit('owner:a', 3, 1000);
    expect(rl.hit('owner:a', 3, 1000).ok).toBe(false);
    expect(rl.peek('owner:b', 3)).toBe(true);
  });
});
