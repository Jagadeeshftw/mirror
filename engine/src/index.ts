import { loadConfig } from './config.js';
import { log } from './log.js';
import { buildEngine } from './app.js';
import { buildServer } from './api/server.js';

async function main() {
  const cfg = loadConfig();
  const engine = buildEngine(cfg, log);
  const server = buildServer(engine, log);
  // Listen first: the first sync can take minutes (registry backfill in 100-block getLogs chunks), and a host's
  // health check must see /v1/health answer meanwhile (it reports ready: false; other routes answer 503).
  await server.listen({ host: cfg.env.HOST, port: cfg.env.PORT });
  log.info({ port: cfg.env.PORT }, 'http listening');
  await engine.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 20_000);
    force.unref();
    try {
      await server.close();
      await engine.stop();
    } catch (err) {
      log.error({ err: (err as Error).message }, 'shutdown error');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error({ err: String((err as Error)?.stack ?? err) }, 'unhandled rejection'));
}

main().catch((err) => {
  log.fatal({ err: (err as Error).message, stack: (err as Error).stack }, 'engine failed to start');
  process.exit(1);
});
