import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { log } from '../src/log.js';

// A minimal engine for the routes under test: health while the first sync is still running.
function fakeEngine(ready: boolean): any {
  return {
    ready,
    cfg: { chainId: 10143, env: { CORS_ORIGINS: '*' } },
    streams: { head: 69_000_000, mode: 'monad', wsConnected: true },
    startedMs: Date.now(),
    keepers: { addresses: [] },
    relayerSender: undefined,
    balances: new Map(),
    market: { wsConnected: true, lastMarkAt: Date.now(), contextAgeMs: () => 0 },
    registry: { lagBlocks: () => 1000, cursor: 69_000_000, all: () => [] },
    leaders: { indexerStatus: async () => null },
    copier: { busy: 0 },
    stops: undefined,
    nansen: { mode: 'off' },
  };
}

describe('engine starting up', () => {
  it('answers /v1/health with ready: false and 503 elsewhere until start() finishes', async () => {
    const app = buildServer(fakeEngine(false), log);
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().ready).toBe(false);
    const leaders = await app.inject({ method: 'GET', url: '/v1/leaders' });
    expect(leaders.statusCode).toBe(503);
    expect(leaders.json().error).toBe('starting');
    expect(leaders.headers['retry-after']).toBe('10');
    await app.close();
  });

  it('reports ready: true once started', async () => {
    const app = buildServer(fakeEngine(true), log);
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(health.json().ready).toBe(true);
    await app.close();
  });
});
