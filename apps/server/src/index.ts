import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createGameServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const server = createGameServer(config, log);

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info('shutdown requested', { signal });
    // Hard exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
    server.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        log.error('shutdown failed', { error: String(err) });
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { reason: String(reason) });
  });

  await server.start();
}

main().catch((err: unknown) => {
  // Logger may not exist yet (config error); write plain JSON to stderr.
  console.error(JSON.stringify({ level: 'error', msg: 'fatal', error: String(err) }));
  process.exit(1);
});
