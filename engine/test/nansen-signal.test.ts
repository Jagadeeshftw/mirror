import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import { Db } from '../src/db.js';
import { createNansenSignal, nansenAdjust, noNansen, type NansenSignalConfig } from '../src/nansen/client.js';

const log = pino({ level: 'silent' });
// anvil default key (test fixture only; the fake fetch below never pays anything)
const payer = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

const base = (over: Partial<NansenSignalConfig> = {}): NansenSignalConfig => ({
  enabled: 'auto', apiUrl: 'http://nansen.invalid', network: 'eip155:143', maxPerCall: 50_000n, dailyBudget: 1_000_000n, cacheHours: 24, ...over,
});

/** Records every request; answers with the given status. Never reaches the network. */
function fakeFetch(status: number) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(status === 200 ? JSON.stringify({ realized_pnl_usd: 10, realized_pnl_percent: 1, win_rate: 0.6, traded_times: 30, data: [{ label: 'Smart Trader' }] }) : '{}', { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe('Nansen signal behind one interface', () => {
  it('no key and no payer: no Nansen signal, ranking adjustment is zero', () => {
    const s = createNansenSignal(new Db(':memory:'), base(), log);
    expect(s).toBe(noNansen);
    expect(s.mode).toBe('off');
    expect(s.get('0xabc')).toBeNull();
    expect(nansenAdjust(s.get('0xabc'))).toEqual({ bonus: 0, flags: [] });
  });

  it('NANSEN_ENABLED=0 forces it off even with a key', () => {
    expect(createNansenSignal(new Db(':memory:'), base({ enabled: '0', apiKey: 'k' }), log).mode).toBe('off');
  });

  it('an API key alone turns it on and every call carries the key (labels included)', async () => {
    const { f, seen } = fakeFetch(200);
    const s = createNansenSignal(new Db(':memory:'), base({ apiKey: 'test-key', fetchImpl: f }), log);
    expect(s.mode).toBe('api_key');
    expect(s.get('0xabc')).toBeNull(); // first call never waits
    for (let i = 0; i < 50 && s.get('0xabc') === null; i++) await new Promise((r) => setTimeout(r, 5));
    const p = s.get('0xabc')!;
    expect(p.labels).toEqual(['Smart Trader']);
    expect(seen.length).toBe(3);
    expect(seen.every((x) => x.headers.apikey === 'test-key')).toBe(true);
    expect(seen.some((x) => x.url.endsWith('/profiler/address/labels'))).toBe(true);
  });

  it('a payer alone selects x402; a refused key falls back to x402 only when a payer is configured', () => {
    expect(createNansenSignal(new Db(':memory:'), base({ payer }), log).mode).toBe('x402');
    expect(createNansenSignal(new Db(':memory:'), base({ apiKey: 'k', payer }), log).mode).toBe('api_key');
  });

  it('a refused key without a payer degrades to no profile data instead of failing', async () => {
    const { f } = fakeFetch(401);
    const s = createNansenSignal(new Db(':memory:'), base({ apiKey: 'expired', fetchImpl: f }), log);
    s.get('0xdef');
    for (let i = 0; i < 50 && s.get('0xdef') === null; i++) await new Promise((r) => setTimeout(r, 5));
    const p = s.get('0xdef')!;
    expect(p).toMatchObject({ labels: [], monad: null, crossVenue: null });
    expect(nansenAdjust(p).bonus).toBe(0);
  });
});
