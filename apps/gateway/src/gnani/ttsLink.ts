import { WebSocket } from 'ws';
import { z } from 'zod';
import { TTS_HEADER_BYTES, prepareSpeechText, writeTtsHeader } from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import type { CreditGuard } from '../guard/creditGuard';
import { TypedEmitter } from '../util/events';
import type { Logger } from '../util/logger';
import { phraseCacheKey, type PhraseCache } from './phraseCache';

type TtsConfig = GatewayConfig['gnani']['tts'];

/**
 * Text is untrusted (a client `speak`, or a template filled with a customer name). It goes through
 * the shared `prepareSpeechText` (the one place that decides what Timbre is sent: sanitising plus
 * listened-to pronunciation overrides). Amounts must already be spoken words.
 */
/** Body of one synthesis request: raw PCM so chunks can be forwarded as they arrive. */
export function buildTtsRequest(tts: TtsConfig, text: string): Record<string, unknown> {
  return {
    text,
    model: tts.model,
    voice: tts.voice,
    language: tts.language,
    speed: 1.0,
    audio_config: {
      sample_rate: tts.sampleRate,
      num_channels: 1,
      sample_width: 2,
      encoding: 'linear_pcm',
      container: 'raw',
    },
  };
}

const upstreamSchema = z.looseObject({
  type: z.string(),
  data: z.looseObject({ audio: z.string().optional() }).optional(),
});

export interface TtsFailure {
  turnId: number;
  code: 'TTS_UNAVAILABLE';
  message: string;
  retryable: boolean;
}

export type TtsEvents = {
  /** Before the first audio chunk of a turn. */
  start: [turnId: number, info: { sampleRate: number; cached: boolean }];
  /** One binary frame, 5-byte header included, ready to send to the browser. */
  chunk: [turnId: number, frame: Uint8Array];
  end: [turnId: number, interrupted: boolean];
  /** A synthesis request is about to be sent (or the cache is being read). */
  request: [turnId: number];
  firstChunk: [turnId: number];
  failure: [failure: TtsFailure];
  /** The credit guard refused this text. */
  budget: [turnId: number];
};

export interface TtsLinkOptions {
  gnani: GatewayConfig['gnani'];
  guard: CreditGuard;
  log: Logger;
  cache?: PhraseCache | null;
  connectTimeoutMs?: number;
  /** Time allowed until the first audio chunk of a request. */
  firstChunkTimeoutMs?: number;
  /** Time allowed for a whole request. */
  requestTimeoutMs?: number;
  backoff?: { baseMs: number; maxMs: number };
}

export interface SpeakOptions {
  /** Cache this text's audio. Only for fixed phrases without names or amounts. */
  cache?: boolean;
}

interface Job {
  turnId: number;
  text: string;
  cache: boolean;
  key: string;
  first: boolean;
  last: boolean;
  cancelled: boolean;
  ws: WebSocket | null;
  reserved: number;
  sawAudio: boolean;
  /** A trailing odd byte from the previous chunk, joined to the next (samples are 2 bytes). */
  carry: number;
  parts: Uint8Array[];
  bytes: number;
  timers: NodeJS.Timeout[];
}

const CACHED_CHUNK_BYTES = 4800;
const MAX_JOB_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BASE64 = 1_000_000;

/**
 * One session's connection to Gnani TTS.
 *
 * - Exactly one synthesis request is in flight per connection; further sentences wait in a queue
 *   and are never sent in parallel (the docs ask for this).
 * - Audio chunks are decoded from base64 once, straight into a frame that already carries the
 *   browser header, and emitted immediately. (A reused scratch buffer would be cheaper but is
 *   unsafe: `ws` keeps a reference to a frame until it is flushed to the socket.)
 * - The docs describe no cancel message, so `interrupt` closes the socket and opens a fresh one.
 * - Connection choice: one persistent socket per session. A shared pool would save sockets but
 *   Gnani asks for one active request at a time, so a pool would only help across sessions; that
 *   is unmeasured, so it is not built.
 * - UNVERIFIED: that raw-container chunks carry no per-chunk header, and how long Gnani keeps an
 *   idle TTS socket open. The spike should confirm both.
 */
export class TtsLink extends TypedEmitter<TtsEvents> {
  private readonly cfg: GatewayConfig['gnani'];
  private readonly guard: CreditGuard;
  private readonly log: Logger;
  private readonly cache: PhraseCache | null;
  private readonly connectTimeoutMs: number;
  private readonly firstChunkTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly backoff: { baseMs: number; maxMs: number };

  private queue: Job[] = [];
  private current: Job | null = null;
  private conn: WebSocket | null = null;
  private connecting: Promise<WebSocket | null> | null = null;
  private failures = 0;
  private blockedUntil = 0;
  private closed = false;
  /** Turns for which `start` was emitted and `end` is still owed. */
  private readonly started = new Set<number>();
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(options: TtsLinkOptions) {
    super();
    this.cfg = options.gnani;
    this.guard = options.guard;
    this.log = options.log;
    this.cache = options.cache ?? null;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000;
    this.firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? 8000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.backoff = options.backoff ?? { baseMs: 500, maxMs: 8000 };
  }

  /** Opens the socket ahead of the first reply. */
  prewarm(): void {
    if (this.closed) return;
    void this.ensureConn();
  }

  get isConnected(): boolean {
    return this.conn?.readyState === WebSocket.OPEN;
  }

  /**
   * Queues sentences to be spoken, in order. False when there is nothing speakable.
   * Each sentence becomes its own request so the first can play while the second is made.
   */
  speak(turnId: number, sentences: readonly string[], options: SpeakOptions = {}): boolean {
    if (this.closed) return false;
    const texts: string[] = [];
    for (const sentence of sentences) {
      const text = prepareSpeechText(sentence);
      if (text !== null) texts.push(text);
    }
    if (texts.length === 0) return false;
    texts.forEach((text, index) => {
      this.queue.push({
        turnId,
        text,
        cache: options.cache === true,
        key: phraseCacheKey({
          text,
          voice: this.cfg.tts.voice,
          model: this.cfg.tts.model,
          language: this.cfg.tts.language,
          sampleRate: this.cfg.tts.sampleRate,
        }),
        first: index === 0,
        last: index === texts.length - 1,
        cancelled: false,
        ws: null,
        reserved: 0,
        sawAudio: false,
        carry: -1,
        parts: [],
        bytes: 0,
        timers: [],
      });
    });
    this.pump();
    return true;
  }

  /** Resolves when background cache writes have landed (scripts must await this before exiting). */
  async flush(): Promise<void> {
    await Promise.all([...this.pendingWrites]);
  }

  /** Stops this turn's speech now: drops queued sentences and aborts the one in flight. */
  interrupt(turnId: number): void {
    this.queue = this.queue.filter((job) => job.turnId !== turnId);
    const job = this.current;
    if (job?.turnId === turnId) {
      job.cancelled = true;
      this.clearTimers(job);
      this.current = null;
      if (job.ws !== null) this.abortConnection();
    }
    this.finishTurn(turnId, true);
    this.pump();
  }

  /** Barge-in: the user pressed the button, so whatever is being said is no longer wanted. */
  interruptAll(): void {
    const turns = new Set<number>([...this.queue.map((j) => j.turnId), ...this.started]);
    if (this.current) turns.add(this.current.turnId);
    for (const turnId of turns) this.interrupt(turnId);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    if (this.current) {
      this.current.cancelled = true;
      this.clearTimers(this.current);
      this.current = null;
    }
    this.started.clear();
    this.conn?.terminate();
    this.conn = null;
    this.removeAllListeners();
  }

  // ---- queue ------------------------------------------------------------------------------

  private pump(): void {
    if (this.closed || this.current !== null) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.run(job).catch((error: unknown) => {
      this.log.error({ err: error }, 'tts job crashed');
      this.failJob(job, 'Voice reply is not available right now.', false);
    });
  }

  private async run(job: Job): Promise<void> {
    if (job.first) this.emit('request', job.turnId);

    if (job.cache && this.cache) {
      const pcm = await this.cache.get(job.key);
      if (job.cancelled || this.current !== job) return;
      if (pcm) {
        await this.playCached(job, pcm);
        return;
      }
    }

    if (!this.guard.checkAndReserve('tts_chars', job.text.length)) {
      this.dropTurn(job.turnId);
      this.endJob(job);
      this.emit('budget', job.turnId);
      this.finishTurn(job.turnId, false);
      this.pump();
      return;
    }
    job.reserved = job.text.length;

    const ws = await this.ensureConn();
    if (job.cancelled || this.current !== job) {
      this.guard.record('tts_chars', 0, job.reserved); // never sent: give the reservation back
      return;
    }
    if (ws === null) {
      this.guard.record('tts_chars', 0, job.reserved);
      this.failJob(job, 'Voice reply is not available right now.', true);
      return;
    }
    job.ws = ws;
    job.timers.push(
      setTimeout(() => this.timeoutJob(job), this.firstChunkTimeoutMs),
      setTimeout(() => this.timeoutJob(job), this.requestTimeoutMs),
    );
    ws.send(JSON.stringify(buildTtsRequest(this.cfg.tts, job.text)));
  }

  private async playCached(job: Job, pcm: Uint8Array): Promise<void> {
    this.beginTurn(job.turnId, true);
    this.emit('firstChunk', job.turnId);
    for (let offset = 0; offset < pcm.byteLength; offset += CACHED_CHUNK_BYTES) {
      if (job.cancelled || this.current !== job) return;
      const slice = pcm.subarray(offset, Math.min(offset + CACHED_CHUNK_BYTES, pcm.byteLength));
      const frame = new Uint8Array(TTS_HEADER_BYTES + slice.byteLength);
      writeTtsHeader(frame, job.turnId);
      frame.set(slice, TTS_HEADER_BYTES);
      this.emit('chunk', job.turnId, frame);
      // Yield between chunks so an interrupt or a slow client can take effect mid-phrase.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (job.cancelled || this.current !== job) return;
    this.completeJob(job);
  }

  // ---- connection -------------------------------------------------------------------------

  private ensureConn(): Promise<WebSocket | null> {
    if (this.conn?.readyState === WebSocket.OPEN) return Promise.resolve(this.conn);
    if (this.connecting) return this.connecting;
    if (Date.now() < this.blockedUntil) return Promise.resolve(null); // backing off: text-only
    this.connecting = new Promise<WebSocket | null>((resolve) => {
      const ws = new WebSocket(this.cfg.tts.url, {
        headers: { 'X-API-Key-ID': this.cfg.apiKey, 'Content-Type': 'application/json' },
        perMessageDeflate: false,
        handshakeTimeout: this.connectTimeoutMs,
      });
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        this.registerConnectFailure(reason);
        resolve(null);
      };
      ws.on('upgrade', (response) => response.socket.setNoDelay(true));
      ws.once('open', () => {
        settled = true;
        this.failures = 0;
        this.blockedUntil = 0;
        this.conn = ws;
        resolve(ws);
      });
      ws.on('unexpected-response', (_request, response) => {
        this.log.warn({ status: response.statusCode ?? 0 }, 'tts handshake rejected');
        fail('rejected');
        ws.terminate();
      });
      ws.on('message', (data, isBinary) => {
        if (!isBinary) this.onMessage(ws, data.toString());
      });
      ws.on('error', (error) => {
        this.log.debug({ code: (error as { code?: string }).code ?? 'unknown' }, 'tts socket error');
      });
      ws.on('close', () => {
        fail('closed');
        this.onConnClosed(ws);
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private registerConnectFailure(reason: string): void {
    this.failures++;
    const delay = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** (this.failures - 1));
    this.blockedUntil = Date.now() + delay;
    this.log.warn({ reason, failures: this.failures, retryInMs: delay }, 'tts connect failed');
  }

  private onConnClosed(ws: WebSocket): void {
    if (this.conn !== ws) return; // one we aborted on purpose
    this.conn = null;
    const job = this.current;
    if (job?.ws === ws && !job.cancelled) {
      this.failJob(job, 'Voice reply was interrupted. Please try again.', true);
    }
  }

  /** The docs have no cancel message: drop the socket and warm a replacement. */
  private abortConnection(): void {
    const old = this.conn;
    this.conn = null;
    old?.terminate();
    if (!this.closed) void this.ensureConn();
  }

  // ---- upstream messages ------------------------------------------------------------------

  private onMessage(ws: WebSocket, text: string): void {
    const job = this.current;
    if (!job || job.ws !== ws || job.cancelled) return; // stale: from an aborted or finished request
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = upstreamSchema.safeParse(json);
    if (!parsed.success) return;
    const { type, data } = parsed.data;
    if (type === 'audio' && data?.audio !== undefined) {
      this.onAudio(job, data.audio);
    } else if (type === 'complete') {
      this.completeJob(job);
    } else if (type === 'error') {
      // The message text is not logged. Per the docs the connection stays usable.
      this.log.warn({}, 'tts upstream error');
      this.failJob(job, 'Voice reply is not available right now.', true);
    }
  }

  private onAudio(job: Job, base64: string): void {
    if (base64.length === 0 || base64.length > MAX_CHUNK_BASE64) return;
    if (!job.sawAudio) {
      job.sawAudio = true;
      // First audio arrived: replace the first-chunk deadline (the whole-request one stays).
      const [firstChunkTimer] = job.timers;
      if (firstChunkTimer) clearTimeout(firstChunkTimer);
      this.beginTurn(job.turnId, false);
      this.emit('firstChunk', job.turnId);
    }
    const decoded = Buffer.byteLength(base64, 'base64');
    const carryBytes = job.carry >= 0 ? 1 : 0;
    const frame = Buffer.allocUnsafe(TTS_HEADER_BYTES + carryBytes + decoded);
    if (carryBytes === 1) frame[TTS_HEADER_BYTES] = job.carry;
    const written = frame.write(base64, TTS_HEADER_BYTES + carryBytes, 'base64');
    let pcmBytes = carryBytes + written;
    job.carry = -1;
    if (pcmBytes % 2 === 1) {
      job.carry = frame[TTS_HEADER_BYTES + pcmBytes - 1] ?? -1;
      pcmBytes -= 1;
    }
    if (pcmBytes === 0) return;
    job.bytes += pcmBytes;
    if (job.bytes > MAX_JOB_BYTES) {
      this.failJob(job, 'Voice reply was too long.', false);
      return;
    }
    writeTtsHeader(frame, job.turnId);
    const out = frame.subarray(0, TTS_HEADER_BYTES + pcmBytes);
    if (job.cache) job.parts.push(out.subarray(TTS_HEADER_BYTES)); // frames are not reused, so this is safe
    this.emit('chunk', job.turnId, out);
  }

  // ---- job lifecycle ----------------------------------------------------------------------

  private completeJob(job: Job): void {
    if (this.current !== job || job.cancelled) return;
    if (job.cache && this.cache && job.parts.length > 0) {
      const write = this.cache.set(job.key, Buffer.concat(job.parts)).finally(() => {
        this.pendingWrites.delete(write);
      });
      this.pendingWrites.add(write);
    }
    this.endJob(job);
    if (job.last) this.finishTurn(job.turnId, false);
    this.pump();
  }

  private failJob(job: Job, message: string, retryable: boolean): void {
    if (this.current !== job || job.cancelled) return;
    job.cancelled = true;
    this.dropTurn(job.turnId);
    this.endJob(job);
    this.emit('failure', { turnId: job.turnId, code: 'TTS_UNAVAILABLE', message, retryable });
    this.finishTurn(job.turnId, false);
    // Text-only from here: the reply text still reaches the client in the draft.
    if (job.ws !== null && this.conn === job.ws) this.abortConnection();
    this.pump();
  }

  private timeoutJob(job: Job): void {
    this.log.warn({}, 'tts request timed out');
    this.failJob(job, 'Voice reply took too long.', true);
  }

  private endJob(job: Job): void {
    this.clearTimers(job);
    if (this.current === job) this.current = null;
  }

  private clearTimers(job: Job): void {
    for (const timer of job.timers) clearTimeout(timer);
    job.timers = [];
  }

  private dropTurn(turnId: number): void {
    this.queue = this.queue.filter((job) => job.turnId !== turnId);
  }

  private beginTurn(turnId: number, cached: boolean): void {
    if (this.started.has(turnId)) return;
    this.started.add(turnId);
    this.emit('start', turnId, { sampleRate: this.cfg.tts.sampleRate, cached });
  }

  private finishTurn(turnId: number, interrupted: boolean): void {
    if (!this.started.delete(turnId)) return;
    this.emit('end', turnId, interrupted);
  }
}
