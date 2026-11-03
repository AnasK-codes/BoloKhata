import type { FastifyBaseLogger } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import {
  AUDIO_FRAME_BYTES,
  AUDIO_SAMPLE_RATE,
  PROTOCOL_VERSION,
  extractKeyterms,
  isValidAudioFrame,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import type { CreditGuard } from '../guard/creditGuard';
import type { Metrics } from '../metrics';
import type { PhraseCache } from '../gnani/phraseCache';
import { SttLink } from '../gnani/sttLink';
import { TtsLink } from '../gnani/ttsLink';
import type { Orchestrator } from '../parse/orchestrator';
import { TurnTimer } from '../timing';
import { CLOSE } from './closeCodes';
import { SendQueue } from './sendQueue';
import { TurnEngine, type Catalog } from './turnEngine';

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
/** A client that keeps sending garbage is cut off rather than parsed forever. */
const MAX_BAD_MESSAGES = 25;

export type { Catalog };

export interface SessionDeps {
  id: string;
  socket: WebSocket;
  config: GatewayConfig;
  log: FastifyBaseLogger;
  guard: CreditGuard;
  metrics: Metrics;
  /** Shared across sessions: fixed phrases are synthesised once. */
  cache?: PhraseCache | null;
  /** Shared across sessions: stateless, so one instance serves them all. */
  orchestrator: Orchestrator;
  onClosed: (session: Session) => void;
}

/**
 * One browser connection. Owns the socket, the catalog snapshot from `hello`, the send queue,
 * the upstream Gnani links and the heartbeat. It routes validated client messages; the turn
 * lifecycle itself lives in TurnEngine.
 */
export class Session {
  readonly id: string;
  readonly out: SendQueue;
  readonly timer = new TurnTimer();
  catalog: Catalog | null = null;

  private readonly log: FastifyBaseLogger;
  private readonly config: GatewayConfig;
  private readonly guard: CreditGuard;
  private readonly metrics: Metrics;
  private readonly cache: PhraseCache | null;
  private readonly orchestrator: Orchestrator;
  private stt: SttLink | null = null;
  private tts: TtsLink | null = null;
  private engine: TurnEngine | null = null;

  private readonly socket: WebSocket;
  private readonly onClosed: (session: Session) => void;
  private readonly timers: NodeJS.Timeout[] = [];
  private alive = true;
  private badMessages = 0;
  private closed = false;

  constructor(deps: SessionDeps) {
    this.id = deps.id;
    this.socket = deps.socket;
    this.config = deps.config;
    this.log = deps.log;
    this.guard = deps.guard;
    this.metrics = deps.metrics;
    this.cache = deps.cache ?? null;
    this.orchestrator = deps.orchestrator;
    this.onClosed = deps.onClosed;
    this.out = new SendQueue(deps.socket, {}, (type) =>
      this.log.error({ type }, 'dropped an invalid outbound message'),
    );

    deps.socket.on('message', (data, isBinary) => this.onSocketMessage(data, isBinary));
    deps.socket.on('pong', () => {
      this.alive = true;
    });
    deps.socket.on('close', () => this.teardown());
    deps.socket.on('error', (error) => this.log.warn({ code: errorCode(error) }, 'socket error'));

    this.timers.push(
      setTimeout(() => this.onHelloTimeout(), HELLO_TIMEOUT_MS),
      setTimeout(
        () => this.expire(),
        this.config.guard.maxSessionMinutes * 60_000,
      ),
      setInterval(() => this.heartbeat(), HEARTBEAT_MS),
    );
  }

  get isReady(): boolean {
    return this.catalog !== null;
  }

  sendError(code: ErrorCode, message: string, retryable: boolean, turnId?: number): void {
    this.out.json({
      type: 'error',
      code,
      message,
      retryable,
      ...(turnId !== undefined ? { turnId } : {}),
    });
  }

  /** Tell the client we are going away soon (graceful drain). */
  notifyRestarting(retryAfterSec: number): void {
    this.out.json({
      type: 'limit',
      reason: 'busy',
      message: 'Server restarting. Please retry in a moment.',
      retryAfterSec,
    });
  }

  /** Public so the manager can close sessions on shutdown. */
  close(code: number, reason: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.close(code, reason);
    this.teardown();
  }

  /** Sends a final `limit` message, then closes. Used for budget and expiry. */
  closeWithLimit(
    reason: 'busy' | 'budget' | 'session_expired',
    message: string,
    code: number,
    extra: { retryAfterSec?: number; resetAt?: string } = {},
  ): void {
    this.out.json({ type: 'limit', reason, message, ...extra });
    this.close(code, reason);
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    this.engine?.dispose();
    this.stt?.close();
    this.tts?.close();
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.length = 0;
    this.onClosed(this);
  }

  private onSocketMessage(data: RawData, isBinary: boolean): void {
    const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (isBinary) {
      this.onBinary(buffer);
      return;
    }
    this.onText(buffer.toString('utf8'));
  }

  /** Hot path: no allocation, no logging. */
  private onBinary(frame: Buffer): void {
    if (!this.isReady) return;
    if (!isValidAudioFrame(frame)) {
      this.metrics.badAudioFrames++;
      return;
    }
    this.onAudioFrame(frame);
  }

  private onAudioFrame(frame: Buffer): void {
    this.engine?.onAudioFrame(frame);
  }

  private onText(raw: string): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.metrics.badMessages++;
      this.log.debug({ reason: parsed.reason, messageType: parsed.messageType }, 'rejected client message');
      this.sendError('BAD_MESSAGE', 'Message was not understood.', false);
      if (++this.badMessages > MAX_BAD_MESSAGES) this.close(CLOSE.policy, 'too many bad messages');
      return;
    }
    this.dispatch(parsed.value);
  }

  private dispatch(message: ClientMessage): void {
    if (message.type === 'hello') return this.onHello(message);
    if (!this.isReady) {
      this.sendError('BAD_MESSAGE', 'Send hello first.', false);
      return;
    }
    switch (message.type) {
      case 'ping':
        this.out.json({ type: 'pong', t: message.t });
        return;
      case 'context_update':
        this.onContextUpdate(message);
        return;
      case 'ptt_start':
        this.engine?.onPttStart(message.turnId);
        return;
      case 'ptt_end':
        this.engine?.onPttEnd(message.turnId);
        return;
      case 'interrupt':
        this.engine?.onInterrupt(message.turnId);
        return;
      case 'speak':
        this.engine?.onSpeak(message.turnId, message.text);
        return;
    }
  }

  private onHello(message: Extract<ClientMessage, { type: 'hello' }>): void {
    if (this.isReady) {
      this.sendError('BAD_MESSAGE', 'hello was already received.', false);
      return;
    }
    this.catalog = {
      version: message.catalog.version,
      products: message.catalog.products,
      customers: message.catalog.customers,
    };
    this.onCatalogReady();
    const ready: ServerMessage = {
      type: 'ready',
      v: PROTOCOL_VERSION,
      sessionId: this.id,
      limits: {
        maxSessionMinutes: this.config.guard.maxSessionMinutes,
        maxUtteranceSeconds: this.config.gnani.stt.maxUtteranceSeconds,
      },
      audio: { inputSampleRate: AUDIO_SAMPLE_RATE, inputFrameBytes: AUDIO_FRAME_BYTES },
    };
    this.out.json(ready);
  }

  /** Called once after `hello`: pre-warm upstream links so the first press pays no handshake. */
  private onCatalogReady(): void {
    const catalog = this.catalog;
    if (!catalog) return;
    this.stt = new SttLink({
      gnani: this.config.gnani,
      keyterms: extractKeyterms(catalog.products, catalog.customers),
      log: this.log,
    });
    this.tts = new TtsLink({
      gnani: this.config.gnani,
      guard: this.guard,
      log: this.log,
      cache: this.cache,
    });
    this.engine = new TurnEngine({
      config: this.config,
      log: this.log,
      guard: this.guard,
      metrics: this.metrics,
      out: this.out,
      timer: this.timer,
      stt: this.stt,
      tts: this.tts,
      orchestrator: this.orchestrator,
    });
    this.engine.setCatalog(catalog);
    this.stt.prewarm();
    this.tts.prewarm();
  }

  private onContextUpdate(message: Extract<ClientMessage, { type: 'context_update' }>): void {
    const current = this.catalog;
    if (!current) return;
    if (message.catalog.version < current.version) return; // out-of-order update: keep the newer one
    this.catalog = {
      version: message.catalog.version,
      products: message.catalog.products ?? current.products,
      customers: message.catalog.customers ?? current.customers,
    };
    this.engine?.setCatalog(this.catalog);
    this.stt?.setKeyterms(extractKeyterms(this.catalog.products, this.catalog.customers));
  }

  private onHelloTimeout(): void {
    if (this.isReady) return;
    this.close(CLOSE.helloTimeout, 'hello timeout');
  }

  private expire(): void {
    this.closeWithLimit(
      'session_expired',
      'Session time is up. Start a new session.',
      CLOSE.sessionExpired,
    );
  }

  private heartbeat(): void {
    if (!this.alive) {
      this.socket.terminate();
      this.teardown();
      return;
    }
    this.alive = false;
    this.socket.ping();
  }
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}
