import { ConfigError, loadConfig, type GatewayConfig } from './config';
import { buildServer } from './server';

function readConfig(): GatewayConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function main() {
  const config = readConfig();
  const app = buildServer(config);

  // Graceful drain: stop accepting, tell clients, let sessions finish (bounded), then exit.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'draining');
    app.gateway
      .drain()
      .then(() => app.close())
      .then(
        () => process.exit(0),
        () => process.exit(1),
      );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  app.listen({ port: config.server.port, host: '0.0.0.0' }).catch((error: unknown) => {
    app.log.error({ err: error }, 'failed to start');
    process.exit(1);
  });
}

main();
