import type { FastifyBaseLogger } from 'fastify';
import { WebSocket } from 'ws';
import { z } from 'zod';
import {
  AUDIO_FRAME_MS,
  LIMITS,
  keytermsHeaderValue,
  type ErrorCode,
} from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import { TypedEmitter } from '../util/events';
import { Pacer, systemClock, type Clock } from './pacer';

type SttConfig = GatewayConfig['gnani'];

/** Context sent once per connection (Prisma v3.0 `topic`). ASCII only: it travels in a header. */
export const STT_TOPIC = 'Hinglish kirana shop billing: grocery items, quantities, udhaar';

/**
 * Upgrade headers for the Gnani STT socket (docs.gnani.ai, STT WebSocket page).
 * UNVERIFIED: how `keyterms` must be encoded. The docs list the header (up to 200 terms) but this
 * encoding (a JSON array, non-ASCII escaped) has not been checked against the real API; the spike
 * (`pnpm spike`, experiment B) is what should confirm it.
 */
export function buildSttHeaders(gnani: SttConfig, keyterms: readonly string[]): Record<string, string> {
  const { stt } = gnani;
  const headers: Record<string, string> = {
    'x-api-key-id': gnani.apiKey,
    model: stt.model,
    language_code: stt.language,
    format: stt.format,
    'x-sample-rate': '16000',
    'x-idle-timeout-sec': String(stt.idleTimeoutSec),
    'x-vad-threshold': String(stt.vadThreshold),
    'x-min-silence-ms': String(stt.minSilenceMs),
    'x-min-speech-ms': String(stt.minSpeechMs),
    'x-min-segment-ms': String(stt.minSegmentMs),
  };
  // keyterms and topic are Prisma v3.0 only.
  if (stt.model === 'prisma-v3.0') {
    headers['topic'] = STT_TOPIC;
    if (keyterms.length > 0) headers['keyterms'] = keytermsHeaderValue(keyterms);
  }
  return headers;
}

// Upstream messages are untrusted: validate the fields we rely on, keep the rest opaque.
const upstreamSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  latency: z.number().optional(),
  detected_language_code: z.string().optional(),
});

type FailureCode = Extract<ErrorCode, 'STT_UNAVAILABLE' | 'STT_ERROR' | 'NO_TRANSCRIPT' | 'UTTERANCE_TOO_LONG'>;

export interface SttFailure {
  turnId?: number;
  code: FailureCode;
  message: string;
  retryable: boolean;
}

export interface SttTranscript {
  turnId: number;
  text: string;
  language?: string;
  sttMs?: number;
}

export type SttEvents = {
  speechStart: [turnId: number];
  processing: [turnId: number];
  commitSent: [turnId: number];
  transcript: [transcript: SttTranscript];
  /** Audio seconds streamed in a finished turn (for the credit guard). Fires once per turn. */
  usage: [turnId: number, seconds: number];
  failure: [failure: SttFailure];
};

export interface SttLinkOptions {
  gnani: SttConfig;
  keyterms: readonly string[];
  log: FastifyBaseLogger;
  clock?: Clock;
  /** How long to wait for a transcript after release. */
  transcriptTimeoutMs?: number;
  connectTimeoutMs?: number;
  backoff?: { baseMs: number; maxMs: number; maxAttempts: number };
}

interface Conn {
  ws: WebSocket;
  ready: boolean;
  closing: boolean;
}

type TurnState = 'idle' | 'listening' | 'draining' | 'committed';

const FRAME_SECONDS = AUDIO_FRAME_MS / 1000;
const DEFAULT_BACKOFF = { baseMs: 250, maxMs: 5000, maxAttempts: 5 };

/**
 * One session's connection to Gnani STT.
 *
 * Strategy `persistent`: one socket stays open across presses (high x-idle-timeout-sec) and is
 * rotated before Gnani's 15-minute cap: a replacement opens in the background and takes over at
 * the next idle moment. Strategy `spare`: the same machinery, but a fresh replacement is opened
 * after every turn, so each press meets a recently-opened socket. Neither is measured yet
 * (docs/LATENCY.md); `persistent` is the default.
 *
 * Gnani's VAD may close a segment while the button is still held, so one press can yield several
 * transcripts: they are joined, and the turn finishes after release.
 */
export class SttLink extends TypedEmitter<SttEvents> {
  private readonly pacer: Pacer;
  private readonly clock: Clock;
  private readonly cfg: SttConfig;
  private readonly log: FastifyBaseLogger;
  private readonly transcriptTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly backoff: { baseMs: number; maxMs: number; maxAttempts: number };
  private keyterms: readonly string[];

  private active: Conn | null = null;
  private opening: Conn | null = null;
  private next: Conn | null = null;
  private attempts = 0;
  private degraded = false;
  private fatal = false;
  private closed = false;
  private reconnectTimer: unknown = null;
  private rotationTimer: unknown = null;

  private turnId: number | null = null;
  private state: TurnState = 'idle';
  private segments: { text: string; language?: string; latency?: number }[] = [];
  private speaking = false;
  private framesAtStart = 0;
  private framesPushed = 0;
  private readonly maxFrames: number;
  private turnTimer: unknown = null;

  constructor(options: SttLinkOptions) {
    super();
    this.cfg = options.gnani;
    this.keyterms = options.keyterms;
    this.log = options.log;
    this.clock = options.clock ?? systemClock;
    this.transcriptTimeoutMs = options.transcriptTimeoutMs ?? 6000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.pacer = new Pacer({ clock: this.clock, drain: this.cfg.stt.drain });
    this.maxFrames = Math.floor(this.cfg.stt.maxUtteranceSeconds / FRAME_SECONDS);
  }

  /** Opens the socket ahead of the first press so it pays no handshake. */
  prewarm(): void {
    if (this.closed || this.fatal || this.active || this.opening) return;
    this.attempts = 0;
    this.degraded = false;
    this.openActive();
  }

  /** Takes effect on the next connection (keyterms are fixed per connection by Gnani). */
  setKeyterms(keyterms: readonly string[]): void {
    this.keyterms = keyterms;
  }

  get isConnected(): boolean {
    return this.active?.ready === true;
  }

  get turnActive(): boolean {
    return this.turnId !== null;
  }

  beginTurn(turnId: number): void {
    if (this.closed) return;
    if (this.turnId !== null) this.abortTurn();
    if (this.fatal) {
      this.emit('failure', {
        turnId,
        code: 'STT_UNAVAILABLE',
        message: 'Speech recognition is not available. Check the server configuration.',
        retryable: false,
      });
      return;
    }
    this.turnId = turnId;
    this.state = 'listening';
    this.segments = [];
    this.speaking = false;
    this.framesAtStart = this.pacer.framesSent;
    this.framesPushed = 0;
    if (!this.active && !this.opening) {
      this.attempts = 0;
      this.degraded = false;
      this.openActive();
    }
  }

  /** Hot path: one call per microphone frame. */
  pushFrame(frame: Uint8Array): void {
    if (this.state !== 'listening') return; // no audio leaves unless the button is held
    if (this.framesPushed >= this.maxFrames) {
      // The turn ends here; the state becomes idle so later frames of this press are ignored.
      this.failTurn('UTTERANCE_TOO_LONG', 'That was too long. Try a shorter sentence.', true);
      return;
    }
    this.framesPushed++;
    this.pacer.push(frame);
  }

  /** Release: drain what is queued, then tell Gnani to close the utterance now. */
  endTurn(): void {
    if (this.state !== 'listening' || this.turnId === null) return;
    const turnId = this.turnId;
    this.state = 'draining';
    // A paced drain of the backlog legitimately takes backlog x 32 ms before commit can be sent.
    const drainMs = this.cfg.stt.drain === 'paced' ? this.pacer.backlog * AUDIO_FRAME_MS : 0;
    this.armTurnTimer(turnId, drainMs);
    this.pacer.endUtterance(() => this.afterDrain(turnId));
  }

  /** Interrupt or disconnect mid-turn. Whatever Gnani is still processing is discarded. */
  abortTurn(): void {
    if (this.turnId === null) return;
    const sentAudio = this.pacer.framesSent > this.framesAtStart;
    this.endTurnCommon();
    // A transcript for audio we already sent would otherwise be attributed to the next turn.
    if (sentAudio) this.recycleActive();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.endTurnCommon();
    this.clearTimer('reconnectTimer');
    this.clearTimer('rotationTimer');
    for (const conn of [this.active, this.opening, this.next]) this.closeConn(conn);
    this.active = this.opening = this.next = null;
    this.removeAllListeners();
  }

  // ---- connection management -------------------------------------------------------------

  private createConn(): Conn {
    const ws = new WebSocket(this.cfg.stt.url, {
      headers: buildSttHeaders(this.cfg, this.keyterms),
      perMessageDeflate: false,
      handshakeTimeout: this.connectTimeoutMs,
    });
    const conn: Conn = { ws, ready: false, closing: false };
    const connectTimer = this.clock.setTimer(() => {
      if (!conn.ready) ws.terminate();
    }, this.connectTimeoutMs);

    ws.on('upgrade', (response) => response.socket.setNoDelay(true));
    ws.on('unexpected-response', (_request, response) => {
      this.onHandshakeRejected(conn, response.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onUpstreamText(conn, data.toString(), connectTimer);
    });
    ws.on('close', (code) => {
      this.clock.clearTimer(connectTimer);
      this.onConnClosed(conn, code);
    });
    ws.on('error', (error) => {
      this.log.debug({ code: (error as { code?: string }).code ?? 'unknown' }, 'stt socket error');
    });
    return conn;
  }

  private openActive(): void {
    const conn = this.createConn();
    this.opening = conn;
  }

  private onHandshakeRejected(conn: Conn, status: number): void {
    this.log.warn({ status }, 'stt handshake rejected');
    // A bad key cannot heal by retrying. The close handler reports it and stops.
    if (status === 401 || status === 403) this.fatal = true;
    conn.closing = true;
  }

  /** Reports "STT is down": to the turn in flight if there is one, otherwise to the session. */
  private failUnavailable(message: string, retryable: boolean): void {
    const hadTurn = this.turnId !== null;
    this.failTurn('STT_UNAVAILABLE', message, retryable);
    if (!hadTurn) this.emit('failure', { code: 'STT_UNAVAILABLE', message, retryable });
  }

  private onUpstreamText(conn: Conn, text: string, connectTimer: unknown): void {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = upstreamSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;

    if (message.type === 'connected') {
      this.clock.clearTimer(connectTimer);
      conn.ready = true;
      this.onConnReady(conn);
      return;
    }
    if (conn !== this.active) return; // late chatter from a connection being retired
    switch (message.type) {
      case 'speech_start':
        this.speaking = true;
        if (this.turnId !== null) this.emit('speechStart', this.turnId);
        return;
      case 'processing':
        if (this.turnId !== null) this.emit('processing', this.turnId);
        return;
      case 'transcript':
        this.onTranscript(message.text ?? '', message.detected_language_code, message.latency);
        return;
      case 'error':
        // Gnani's message text is not logged: it may echo input.
        this.log.warn('stt upstream error message');
        this.failTurn('STT_ERROR', 'Speech recognition had a problem. Please try again.', true);
        return;
      default:
        return;
    }
  }

  private onConnReady(conn: Conn): void {
    if (conn === this.opening) {
      this.opening = null;
      this.active = conn;
      this.attempts = 0;
      this.degraded = false;
      this.pacer.setSink(this.sendFrame);
      this.armRotation();
      return;
    }
    if (conn === this.next) this.trySwap();
  }

  private readonly sendFrame = (frame: Uint8Array): void => {
    const ws = this.active?.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
  };

  private onConnClosed(conn: Conn, code: number): void {
    if (conn === this.next) {
      this.next = null;
      return;
    }
    const wasActive = conn === this.active;
    const wasOpening = conn === this.opening;
    if (!wasActive && !wasOpening) return; // one we retired on purpose
    if (wasActive) {
      this.active = null;
      this.pacer.setSink(null);
      this.clearTimer('rotationTimer');
    }
    if (wasOpening) this.opening = null;
    if (this.closed) return;

    this.log.info({ code, wasActive }, 'stt connection closed');
    if (code === 1008) this.fatal = true; // rejected configuration: retrying cannot help
    if (this.fatal) {
      this.failUnavailable('Speech recognition is not available. Check the server configuration.', false);
      return;
    }
    if (wasActive && this.turnId !== null) {
      this.failTurn('STT_ERROR', 'Speech recognition connection dropped. Please try again.', true);
    }
    // 1000 after a long idle is Gnani's idle timeout: reconnect lazily on the next press.
    if (wasActive && code === 1000 && this.turnId === null) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    this.attempts++;
    if (this.attempts > this.backoff.maxAttempts) {
      if (!this.degraded) {
        this.degraded = true;
        this.log.error({ attempts: this.attempts - 1 }, 'stt unreachable, degraded mode');
        this.failUnavailable('Cannot reach speech recognition right now.', true);
      }
      return;
    }
    const exponential = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** (this.attempts - 1));
    const delay = Math.round(exponential * (0.5 + Math.random() * 0.5)); // jitter
    this.reconnectTimer = this.clock.setTimer(() => {
      this.reconnectTimer = null;
      if (!this.closed && !this.active && !this.opening) this.openActive();
    }, delay);
  }

  // ---- rotation ---------------------------------------------------------------------------

  private armRotation(): void {
    this.clearTimer('rotationTimer');
    this.rotationTimer = this.clock.setTimer(() => this.openReplacement(), this.cfg.stt.rotateAfterMs);
  }

  /** Opens a replacement in the background; it takes over at the next idle moment. */
  private openReplacement(): void {
    if (this.closed || this.next) return;
    this.next = this.createConn();
  }

  private trySwap(): void {
    const replacement = this.next;
    if (!replacement?.ready || this.turnId !== null) return; // swap only when idle
    const old = this.active;
    this.next = null;
    this.active = replacement;
    this.armRotation();
    this.closeConn(old);
  }

  /** Drops the current socket and opens a fresh one (used when its state cannot be trusted). */
  private recycleActive(): void {
    const old = this.active;
    this.active = null;
    this.pacer.setSink(null);
    this.clearTimer('rotationTimer');
    this.closeConn(old);
    if (!this.closed && !this.opening) this.openActive();
  }

  private closeConn(conn: Conn | null): void {
    if (!conn || conn.closing) return;
    conn.closing = true;
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.close(1000);
    else if (conn.ws.readyState === WebSocket.CONNECTING) conn.ws.terminate();
  }

  // ---- turn handling ----------------------------------------------------------------------

  private afterDrain(turnId: number): void {
    if (this.turnId !== turnId || this.state !== 'draining') return;
    this.state = 'committed';
    this.emit('commitSent', turnId);
    const ws = this.active?.ws;
    // If Gnani's VAD already closed the last segment, there is nothing left to commit.
    if (!this.speaking && this.segments.length > 0) {
      this.finishTurn();
      return;
    }
    if (ws?.readyState !== WebSocket.OPEN) {
      this.failTurn('STT_ERROR', 'Speech recognition connection dropped. Please try again.', true);
      return;
    }
    ws.send(JSON.stringify({ type: 'commit' }));
  }

  private onTranscript(text: string, language: string | undefined, latency: number | undefined): void {
    this.speaking = false;
    if (this.turnId === null) return; // stale: the turn was aborted or already finished
    const trimmed = text.trim();
    if (trimmed !== '') {
      this.segments.push({
        text: trimmed,
        ...(language !== undefined ? { language } : {}),
        ...(latency !== undefined ? { latency } : {}),
      });
    }
    if (this.state === 'committed') this.finishTurn();
  }

  private finishTurn(): void {
    const turnId = this.turnId;
    if (turnId === null) return;
    const segments = this.segments;
    if (segments.length === 0) {
      this.failTurn('NO_TRANSCRIPT', 'Could not hear anything. Please try again.', true);
      return;
    }
    const last = segments[segments.length - 1]!;
    const joined = segments.map((s) => s.text).join(' ').slice(0, LIMITS.maxTranscriptLength);
    this.endTurnCommon();
    this.emit('transcript', {
      turnId,
      text: joined,
      ...(last.language !== undefined ? { language: last.language } : {}),
      ...(last.latency !== undefined ? { sttMs: last.latency } : {}),
    });
    this.housekeeping();
  }

  private failTurn(code: FailureCode, message: string, retryable: boolean): void {
    const turnId = this.turnId;
    if (turnId === null) return;
    const sentAudio = this.pacer.framesSent > this.framesAtStart;
    this.endTurnCommon();
    this.emit('failure', { turnId, code, message, retryable });
    // Gnani may still answer for this audio later; a fresh socket keeps it out of the next turn.
    if (sentAudio && this.active) this.recycleActive();
    else this.housekeeping();
  }

  /** Clears per-turn state and reports usage exactly once. */
  private endTurnCommon(): void {
    const turnId = this.turnId;
    this.clearTimer('turnTimer');
    this.pacer.reset();
    this.state = 'idle';
    this.turnId = null;
    this.segments = [];
    this.speaking = false;
    if (turnId !== null) {
      const seconds = (this.pacer.framesSent - this.framesAtStart) * FRAME_SECONDS;
      this.emit('usage', turnId, Math.round(seconds * 1000) / 1000);
    }
  }

  private armTurnTimer(turnId: number, extraMs: number): void {
    this.clearTimer('turnTimer');
    this.turnTimer = this.clock.setTimer(() => {
      this.turnTimer = null;
      if (this.turnId !== turnId) return;
      if (this.segments.length > 0) this.finishTurn();
      else if (!this.active) this.failUnavailable('Cannot reach speech recognition right now.', true);
      else this.failTurn('NO_TRANSCRIPT', 'Could not hear anything. Please try again.', true);
    }, this.transcriptTimeoutMs + extraMs);
  }

  /** After a turn ends cleanly: apply a pending rotation, or open the next spare. */
  private housekeeping(): void {
    if (this.closed) return;
    if (this.cfg.stt.strategy === 'spare') this.openReplacement();
    this.trySwap();
  }

  private clearTimer(name: 'reconnectTimer' | 'rotationTimer' | 'turnTimer'): void {
    const handle = this[name];
    if (handle === null) return;
    this.clock.clearTimer(handle);
    this[name] = null;
  }
}
