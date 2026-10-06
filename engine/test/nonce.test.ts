import { describe, expect, it } from 'vitest';
import { NonceManager } from '../src/chain/nonce.js';
import { withHeadroom } from '../src/chain/sender.js';

describe('NonceManager', () => {
  it('pipelines nonces from the chain pending count', async () => {
    let calls = 0;
    const nm = new NonceManager(async () => (calls++, 5));
    const ns = await Promise.all([nm.allocate(), nm.allocate(), nm.allocate()]);
    expect(ns.sort()).toEqual([5, 6, 7]);
    expect(calls).toBe(1);
    expect(nm.inflight).toBe(3);
  });

  it('reuses a released nonce before allocating new ones', async () => {
    const nm = new NonceManager(async () => 0);
    const a = await nm.allocate();
    const b = await nm.allocate();
    const c = await nm.allocate();
    nm.confirm(a);
    nm.release(b);
    expect(await nm.allocate()).toBe(b);
    expect(await nm.allocate()).toBe(3);
    nm.confirm(c);
  });

  it('rewinds when the most recent nonce is released', async () => {
    const nm = new NonceManager(async () => 10);
    const a = await nm.allocate();
    nm.release(a);
    expect(nm.peek().next).toBe(10);
    expect(await nm.allocate()).toBe(10);
  });

  it('resync moves forward when the chain is ahead (nonce too low)', async () => {
    let chain = 3;
    const nm = new NonceManager(async () => chain);
    await nm.allocate(); // 3, in flight
    chain = 9;
    await nm.resync();
    expect(await nm.allocate()).toBe(9);
  });

  it('resync with nothing in flight trusts the chain', async () => {
    let chain = 3;
    const nm = new NonceManager(async () => chain);
    const n = await nm.allocate();
    nm.confirm(n);
    chain = 2; // e.g. a dropped tx
    await nm.resync();
    expect(await nm.allocate()).toBe(2);
  });
});

describe('gas headroom', () => {
  it('applies the multiplier and rounds up', () => {
    expect(withHeadroom(100_000n, 1.2)).toBe(120_000n);
    expect(withHeadroom(100_001n, 1.2)).toBe(120_002n);
    expect(withHeadroom(21_000n, 1.2)).toBe(25_200n);
  });
});
