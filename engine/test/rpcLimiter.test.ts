import { describe, expect, it } from 'vitest';
import { RpcLimiter, rpcPriority } from '../src/chain/rpcLimiter.js';

describe('RpcLimiter', () => {
  it('spaces calls to the configured rate', async () => {
    const l = new RpcLimiter(20); // one slot per 50 ms
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => l.acquire('normal')));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);
  });

  it('serves high priority before queued background calls', async () => {
    const l = new RpcLimiter(20);
    const order: string[] = [];
    const bg = Array.from({ length: 4 }, (_, i) => l.acquire('normal').then(() => order.push(`bg${i}`)));
    const hi = l.acquire('high').then(() => order.push('copy'));
    await Promise.all([...bg, hi]);
    expect(order.indexOf('copy')).toBeLessThanOrEqual(1);
  });

  it('is a no-op at 0', async () => {
    const l = new RpcLimiter(0);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 50 }, () => l.acquire('normal')));
    expect(Date.now() - t0).toBeLessThan(20);
  });

  it('marks calls made inside rpcPriority.run("high") and send methods as high', async () => {
    const l = new RpcLimiter(1000);
    const seen: string[] = [];
    (l as any).acquire = async (p: string) => void seen.push(p);
    const f = l.fetchFn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}')) as typeof fetch;
    try {
      await f('http://rpc', { method: 'POST', body: '{"method":"eth_call"}' });
      await rpcPriority.run('high', () => f('http://rpc', { method: 'POST', body: '{"method":"eth_call"}' }));
      await f('http://rpc', { method: 'POST', body: '{"method":"eth_sendRawTransaction"}' });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen).toEqual(['normal', 'high', 'high']);
  });
});
