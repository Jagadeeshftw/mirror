import { loadConfig } from './config.js';
import { log } from './log.js';
import { buildEngine } from './app.js';
import { buildServer } from './api/server.js';

async function main() {
  const cfg = loadConfig();
  const engine = buildEngine(cfg, log);
  const server = buildServer(engine, log);
  await engine.start();
  await server.listen({ host: cfg.env.HOST, port: cfg.env.PORT });
  log.info({ port: cfg.env.PORT }, 'http listening');

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
