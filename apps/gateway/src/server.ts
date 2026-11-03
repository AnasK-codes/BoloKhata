import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { DestinationStream } from 'pino';
import type { WebSocket } from 'ws';
import { MAX_ANY_MESSAGE_BYTES } from '@bolbill/shared';
import type { GatewayConfig } from './config';
import { PhraseCache } from './gnani/phraseCache';
import { DailyCreditGuard, type CreditGuard } from './guard/creditGuard';
import { RateLimiter } from './guard/rateLimit';
import { createTokenService, type TokenService } from './guard/token';
import { Metrics } from './metrics';
import { CLOSE } from './session/closeCodes';
import { Session } from './session/session';
import { Orchestrator } from './parse/orchestrator';
import { createLlmAdapter, type LlmAdapter } from './parse/llm';
import { SessionManager } from './session/sessionManager';
import { GATEWAY_VERSION } from './version';

export interface BuildServerOptions {
  /** Test hook: capture log output. */
  logStream?: DestinationStream;
  /** Test hook: replace the credit guard. */
  guard?: CreditGuard;
  /** Test hook: replace the language model adapter (tests never call a real model). */
  llm?: LlmAdapter;
}

export interface GatewayContext {
  config: GatewayConfig;
  tokens: TokenService;
  guard: CreditGuard;
  metrics: Metrics;
  sessions: SessionManager;
  draining: boolean;
  /** Stop accepting sessions, tell clients, wait for them to finish, then close what is left. */
  drain(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    gateway: GatewayContext;
  }
}

const BUSY_RETRY_SEC = 5;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
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
    trustProxy: config.server.trustProxy,
  });

  const guard =
    options.guard ??
    new DailyCreditGuard({
      stt_seconds: config.guard.dailySttSecondsCap,
      tts_chars: config.guard.dailyTtsCharsCap,
    });
  const ctx: GatewayContext = {
    config,
    tokens: createTokenService(config.guard.sessionTokenSecret),
    guard,
    metrics: new Metrics(),
    sessions: new SessionManager(config.guard.maxSessions),
    draining: false,
    async drain() {
      ctx.draining = true;
      ctx.sessions.forEach((s) => s.notifyRestarting(BUSY_RETRY_SEC));
      await ctx.sessions.whenEmpty(config.server.drainTimeoutMs);
      ctx.sessions.closeAll(CLOSE.goingAway, 'server restarting');
    },
  };
  app.decorate('gateway', ctx);
  const phraseCache = new PhraseCache(config.gnani.tts.cacheDir, config.gnani.tts.cacheMemoryBytes);
  const orchestrator = new Orchestrator({
    llm: options.llm ?? createLlmAdapter(config.llm),
    timeoutMs: config.llm.timeoutMs,
  });

  const perIp = new RateLimiter(config.guard.sessionRatePerIpPerMin, 60_000);
  const global = new RateLimiter(config.guard.sessionRateGlobalPerMin, 60_000);
  const origins = new Set(config.guard.allowedOrigins.map((o) => new URL(o).origin));
  const originAllowed = (origin: string | undefined): boolean =>
    origin !== undefined && origins.has(origin);

  // CORS: the web app and the gateway are different origins in development.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!originAllowed(origin)) return;
    void reply.header('Access-Control-Allow-Origin', origin);
    void reply.header('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      void reply
        .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        .header('Access-Control-Allow-Headers', 'content-type, authorization')
        .header('Access-Control-Max-Age', '600');
      return reply.code(204).send();
    }
  });

  app.get('/healthz', () => ({ ok: true, version: GATEWAY_VERSION }));

  app.get('/metrics', (request, reply) => {
    const expected = config.guard.metricsToken;
    if (expected === undefined) return reply.code(404).send();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), expected)) {
      return reply.code(401).send();
    }
    return ctx.metrics.snapshot({
      activeSessions: ctx.sessions.size,
      maxSessions: ctx.sessions.maxSessions,
      credits: ctx.guard.usage(),
      draining: ctx.draining,
    });
  });

  const limitReply = (
    reply: FastifyReply,
    status: number,
    reason: 'busy' | 'budget' | 'rate_limited',
    message: string,
    extra: { retryAfterSec?: number; resetAt?: string } = {},
  ) => {
    if (extra.retryAfterSec !== undefined) void reply.header('Retry-After', String(extra.retryAfterSec));
    return reply.code(status).send({ type: 'limit', reason, message, ...extra });
  };

  app.post('/session', async (request: FastifyRequest, reply) => {
    if (!originAllowed(request.headers.origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
    const code = config.guard.demoAccessCode;
    if (code !== undefined) {
      const given = (request.body as { accessCode?: unknown } | null | undefined)?.accessCode;
      if (typeof given !== 'string' || !safeEqual(given, code)) {
        return reply.code(403).send({ error: 'access_code_required' });
      }
    }
    const ip = perIp.take(request.ip);
    const all = global.take('*');
    if (!ip.ok || !all.ok) {
      ctx.metrics.sessionsRejected++;
      return limitReply(reply, 429, 'rate_limited', 'Too many requests. Please wait a moment.', {
        retryAfterSec: Math.max(ip.retryAfterSec, all.retryAfterSec),
      });
    }
    if (ctx.draining || ctx.sessions.isFull) {
      ctx.metrics.sessionsRejected++;
      return limitReply(reply, 503, 'busy', 'The demo is busy right now. Please try again shortly.', {
        retryAfterSec: BUSY_RETRY_SEC,
      });
    }
    if (ctx.guard.isExhausted()) {
      ctx.metrics.sessionsRejected++;
      return limitReply(reply, 503, 'budget', 'Today\'s demo budget is used up.', {
        resetAt: ctx.guard.resetAt(),
      });
    }
    return ctx.tokens.issue();
  });

  // The websocket plugin is registered inside a child scope so buildServer can stay synchronous.
  app.register(async (instance) => {
    await instance.register(websocket, {
      // Audio is already compressed PCM-sized frames; deflate would only add latency.
      options: { perMessageDeflate: false, maxPayload: MAX_ANY_MESSAGE_BYTES + 1024 },
    });

    instance.get(
      '/ws',
      {
        websocket: true,
        preValidation: async (request, reply) => {
          const origin = request.headers.origin;
          if (origin !== undefined && !originAllowed(origin)) return reply.code(403).send();
          if (ctx.draining) return reply.code(503).send();
          const token = (request.query as { token?: unknown }).token;
          if (typeof token !== 'string' || !ctx.tokens.consume(token)) {
            return reply.code(401).send();
          }
        },
      },
      (socket: WebSocket, request) => {
        request.raw.socket.setNoDelay(true);
        attach(socket, request);
      },
    );
  });

  function attach(socket: WebSocket, request: FastifyRequest): void {
    if (ctx.sessions.isFull || ctx.draining) {
      ctx.metrics.sessionsRejected++;
      socket.send(
        JSON.stringify({
          type: 'limit',
          reason: 'busy',
          message: 'The demo is busy right now. Please try again shortly.',
          retryAfterSec: BUSY_RETRY_SEC,
        }),
      );
      socket.close(CLOSE.busy, 'busy');
      return;
    }
    const id = randomUUID();
    ctx.metrics.sessionsTotal++;
    const session = new Session({
      id,
      socket,
      config,
      log: request.log.child({ sessionId: id }),
      guard: ctx.guard,
      metrics: ctx.metrics,
      cache: phraseCache,
      orchestrator,
      onClosed: (s) => ctx.sessions.remove(s),
    });
    ctx.sessions.add(session);
  }

  app.addHook('onClose', async () => {
    ctx.sessions.closeAll(CLOSE.goingAway, 'server closing');
  });

  return app;
}
