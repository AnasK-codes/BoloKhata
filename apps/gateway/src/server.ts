import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import type { GatewayConfig } from './config';
import { GATEWAY_VERSION } from './version';

export interface BuildServerOptions {
  /** Test hook: capture log output. */
  logStream?: DestinationStream;
}

export function buildServer(
  config: GatewayConfig,
  options: BuildServerOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.server.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key-id"]'],
      serializers: {
        // Deliberately no body or headers. The query string is dropped too because the
        // websocket session token travels there (/ws?token=...).
        req: (req) => ({ method: req.method ?? '', path: req.url?.split('?')[0] ?? '' }),
        res: (res) => ({ statusCode: res.statusCode ?? 0 }),
      },
    },
    bodyLimit: 16 * 1024,
  });

  app.get('/healthz', () => ({ ok: true, version: GATEWAY_VERSION }));

  return app;
}
