import Fastify, { LogController, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { getAddress, isAddress } from 'viem';
import { z, ZodError } from 'zod';
import type { Engine } from '../app.js';
import type { Logger } from '../log.js';
import { metrics, renderMetrics } from '../metrics.js';
import { CreateBody, DepositBody, ExecuteBody, RelayError, TransferBody } from '../services/relayer.js';
import { QuoteBody } from '../services/quote.js';
import { DemoError } from '../services/demo.js';
import { RateLimitError } from '../services/ratelimit.js';
import { CircuitOpenError, SimulationError, SendError } from '../chain/sender.js';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

const addrParam = (v: string) => {
  if (!isAddress(v)) throw Object.assign(new Error('invalid address'), { statusCode: 400 });
  return getAddress(v);
};

export function buildServer(e: Engine, log: Logger) {
  const app = Fastify({ loggerInstance: log.child({ mod: 'http' }), trustProxy: true, bodyLimit: 256 * 1024, logController: new LogController({ disableRequestLogging: true }) });
  app.setReplySerializer((p) => json(p));
  void app.register(cors, { origin: e.cfg.env.CORS_ORIGINS === '*' ? true : e.cfg.env.CORS_ORIGINS.split(',') });

  app.addHook('onResponse', async (req, reply) => {
    metrics.httpRequests.inc({ route: req.routeOptions.url ?? 'unknown', status: reply.statusCode });
    if (reply.statusCode >= 400 || req.method === 'POST') log.info({ method: req.method, url: req.url, status: reply.statusCode, ip: req.ip, ms: Math.round(reply.elapsedTime) }, 'http');
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof RateLimitError) return reply.status(429).header('retry-after', Math.ceil((err.resetAt - Date.now()) / 1000)).send({ error: err.message, resetAt: err.resetAt });
    if (err instanceof RelayError || err instanceof DemoError) return reply.status(err.status).send({ error: err.message, ...(err instanceof RelayError && err.details ? { details: err.details } : {}) });
    if (err instanceof SimulationError) return reply.status(400).send({ error: err.message, revert: err.revert.name });
    if (err instanceof CircuitOpenError) return reply.status(503).send({ error: 'relayer temporarily unavailable' });
    if (err instanceof SendError) return reply.status(502).send({ error: 'transaction submission failed', kind: err.kind });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) log.error({ err: err.message, stack: err.stack }, 'unhandled error');
    return reply.status(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });

  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined) throw new RelayError(503, `${what} not configured`);
    return v;
  };

  const limit = (key: string, max: number, windowMs: number, scope: string) => {
    const r = e.limiter.hit(key, max, windowMs);
    if (!r.ok) throw new RateLimitError(scope, r.resetAt);
  };

  // ---------------------------------------------------------------- read

  app.get('/v1/health', async () => {
    const keeperAddrs = e.keepers?.addresses ?? [];
    const keeper = keeperAddrs[0];
    const relayer = e.relayerSender?.address;
    return {
      ok: e.streams.head > 0,
      chainId: e.cfg.chainId,
      block: e.streams.head,
      uptimeSec: Math.round((Date.now() - e.startedMs) / 1000),
      streams: { mode: e.streams.mode, wsConnected: e.streams.wsConnected },
      keeper: keeper ? { address: keeper, balanceWei: (e.balances.get(keeper) ?? 0n).toString(), all: keeperAddrs.map((a) => ({ address: a, balanceWei: (e.balances.get(a) ?? 0n).toString() })) } : null,
      relayer: relayer ? { address: relayer, balanceWei: (e.balances.get(relayer) ?? 0n).toString() } : null,
      perpl: { wsConnected: e.market.wsConnected, lastMarkAt: e.market.lastMarkAt, contextAgeMs: e.market.contextAgeMs() },
      indexer: { lagBlocks: e.registry?.lagBlocks() ?? null, cursor: e.registry?.cursor ?? null, accounts: e.registry?.all().length ?? 0, envio: await e.leaders.indexerStatus().catch(() => null) },
      copier: { busy: e.copier?.busy ?? 0 },
      stopExecutor: { enabled: Boolean(e.stops) },
      nansen: e.nansen.mode,
    };
  });

  app.get('/v1/config', async () => {
    const views = await e.market.views();
    return {
      chainId: e.cfg.chainId,
      explorerTx: e.cfg.explorerTx,
      explorerAddress: e.cfg.explorerAddress,
      contracts: { factory: e.cfg.factory ?? null, keeperRegistry: e.cfg.keeperRegistry ?? null, perplExchange: e.cfg.exchange, collateral: e.cfg.collateral, deployBlock: e.cfg.deployBlock ?? null },
      collateralDecimals: e.cfg.collateralDecimals,
      depositCapCNS: e.depositCap?.toString() ?? null,
      perplMinAccountOpenCNS: e.market.minAccountOpenCNS ?? e.cfg.minAccountOpenCNS.toString(),
      keepers: e.keepers?.addresses ?? [],
      relayer: e.relayerSender?.address ?? null,
      teamRun: { addresses: [...e.cfg.teamRun], demoLeaderAccountId: e.demo?.leaderAccountId || null, demoFollowerAccount: e.cfg.demoFollowerAccount ?? null },
      markets: views.map((m) => ({ perpId: m.perpId, symbol: m.symbol, lotDecimals: m.lotDecimals, priceDecimals: m.priceDecimals, markPNS: m.markPNS, minOrderLots: m.minOrderLots, minOrderSize: m.minOrderSize, minPostingCNS: m.minPostingCNS, isOpen: m.isOpen })),
    };
  });

  app.get('/v1/markets', async () => ({ source: { config: 'perpl REST /v1/pub/context', live: e.market.wsConnected ? 'perpl WS market-data' : 'perpl REST ticker' }, markets: await e.market.views() }));

  app.get('/v1/leaders', async (req) => {
    const q = z.object({ window: z.enum(['7d', '30d', '90d']).default('30d'), sort: z.enum(['score', 'pnl', 'drawdown']).default('score'), market: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return e.leaders.list(q.window, q.sort, q.market, q.limit);
  });

  app.get('/v1/leaders/:accountId', async (req) => {
    const p = z.object({ accountId: z.coerce.number().int().positive() }).parse(req.params);
    const q = z.object({ window: z.enum(['7d', '30d', '90d']).default('30d') }).parse(req.query);
    return e.leaders.profile(p.accountId, q.window);
  });

  app.get('/v1/owners/:owner/accounts', async (req) => e.views.ownerAccounts(addrParam((req.params as { owner: string }).owner)));

  app.get('/v1/accounts/:account', async (req, reply) => {
    const a = await e.views.account(addrParam((req.params as { account: string }).account));
    return a ?? reply.status(404).send({ error: 'unknown account' });
  });

  app.get('/v1/accounts/:account/feed', async (req) => {
    const account = addrParam((req.params as { account: string }).account);
    const q = z.object({ cursor: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return e.views.feed(account, q.cursor, q.limit);
  });

  app.get('/v1/accounts/:account/stops', async (req) => {
    const account = addrParam((req.params as { account: string }).account);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const rows = e.db.all<Record<string, unknown>>('SELECT * FROM stop_triggers WHERE account = ? ORDER BY id DESC LIMIT ?', account.toLowerCase(), q.limit);
    return { items: rows.map((r) => ({ kind: r.kind, scope: r.scope, status: r.status, txHash: r.tx_hash, sender: r.sender, error: r.error, gasUsed: r.gas_used, gasLimit: r.gas_limit, at: r.created_ms })) };
  });

  app.get('/v1/stats', async (req) => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return e.views.stats(q.page, q.limit, e.keepers?.addresses ?? []);
  });

  app.get('/v1/demo', async () => (e.demo ? e.demo.state() : { enabled: false }));

  app.get('/v1/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = z.object({ account: z.string() }).parse(req.query);
    const channel = q.account === 'demo' ? 'demo' : addrParam(q.account).toLowerCase();
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'access-control-allow-origin': '*' });
    res.write(`event: hello\ndata: ${json({ channel, block: e.streams.head })}\n\n`);
    const off = e.bus.subscribe(channel, (ev) => res.write(`event: ${ev.type}\ndata: ${json(ev)}\n\n`));
    const hb = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 15_000);
    req.raw.on('close', () => {
      clearInterval(hb);
      off();
    });
  });

  // ---------------------------------------------------------------- quote

  app.post('/v1/quote/follow', async (req) => {
    limit(`quote:${req.ip}`, e.cfg.env.QUOTE_IP_MINUTE, 60_000, 'quote per-IP');
    return need(e.quote, 'quotes').quote(QuoteBody.parse(req.body));
  });

  // ---------------------------------------------------------------- relay

  const relayLimits = (req: FastifyRequest, owner: string | undefined, kind: string) => {
    limit(`relay-ip:${req.ip}`, e.cfg.env.RELAY_IP_HOURLY, 3600_000, 'relay per-IP hourly');
    if (owner) limit(`relay-owner:${owner.toLowerCase()}`, e.cfg.env.RELAY_OWNER_HOURLY, 3600_000, `relay per-owner hourly (${kind})`);
  };
  const ownerOfAccount = async (account: `0x${string}`) => e.registry?.get(account)?.owner ?? (await e.relayer?.ownerOf(account));

  app.post('/v1/relay/create', async (req) => {
    const b = CreateBody.parse(req.body);
    relayLimits(req, b.owner, 'create');
    return need(e.relayer, 'relayer').create(b);
  });

  app.post('/v1/relay/deposit', async (req) => {
    const b = DepositBody.parse(req.body);
    relayLimits(req, await ownerOfAccount(b.account), 'deposit');
    return need(e.relayer, 'relayer').deposit(b);
  });

  app.post('/v1/relay/execute', async (req) => {
    const b = ExecuteBody.parse(req.body);
    relayLimits(req, await ownerOfAccount(b.account), 'execute');
    return need(e.relayer, 'relayer').execute(b);
  });

  app.post('/v1/relay/transfer', async (req) => {
    const b = TransferBody.parse(req.body);
    relayLimits(req, b.from, 'transfer');
    return need(e.relayer, 'relayer').transfer(b);
  });

  // ---------------------------------------------------------------- demo

  app.post('/v1/demo/trade', async (req) => need(e.demo, 'demo').start('trade', req.ip));
  app.post('/v1/demo/blocked', async (req) => need(e.demo, 'demo').start('blocked', req.ip));

  // ---------------------------------------------------------------- push

  app.post('/v1/push/register', async (req) => {
    const b = z.object({ owner: z.string(), expoPushToken: z.string(), notifyPublicKey: z.string() }).parse(req.body);
    limit(`push:${req.ip}`, 30, 3600_000, 'push register per-IP');
    return e.push.register(b.owner, b.expoPushToken, b.notifyPublicKey);
  });

  // ---------------------------------------------------------------- ops

  app.get('/metrics', async (_req, reply) => reply.type('text/plain; version=0.0.4').send(renderMetrics()));
  app.get('/', async () => ({ service: 'mirror-engine', docs: 'docs/api.md', health: '/v1/health' }));

  return app;
}
