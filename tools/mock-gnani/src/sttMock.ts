import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { STT_FRAME_BYTES, rmsOfPcm16 } from './audio';

/**
 * Mock of Gnani's realtime STT WebSocket (wss://api.vachana.ai/stt/v3/stream).
 * Built from https://docs.gnani.ai/api/STT/stt-websocket.md. Where the docs are silent
 * (close code on idle timeout, what happens to a wrong-size frame) the mock chooses a behaviour
 * and says so in a comment; the real latency spike (Prompt 2) is what settles those questions.
 *
 * Transcripts are SCRIPTED by the test or CLI. Nothing here recognises speech.
 */

export const STT_PATH = '/stt/v3/stream';

const ALL_FORMATS = ['verbatim', 'transcribe', 'codemix', 'transliterate'];
const V3_ONLY_FORMATS = ['codemix', 'transliterate'];
const SESSION_CAP_MS = 15 * 60 * 1000;

export interface SegmentContext {
  connectionId: number;
  segmentIndex: number;
  audioDurationMs: number;
}

export interface MockSttOptions {
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  /** When set, requests must send exactly this x-api-key-id. Otherwise any non-empty key works. */
  validApiKey?: string;
  /** Concurrent session cap (the real one is per organisation). Default: unlimited. */
  maxSessions?: number;
  /** Artificial delay before the `transcript` message; also reported in its `latency` field. */
  transcriptLatencyMs?: number;
  /** Used when no queued transcript is available. */
  defaultTranscript?: string | ((context: SegmentContext) => string);
  /** Frames with RMS above this (int16 scale) count as speech for the mock VAD. */
  speechRmsThreshold?: number;
  /** How far ahead of real time frames may arrive before being flagged `too_fast`. */
  frameToleranceMs?: number;
  /** Overrides x-idle-timeout-sec (tests need milliseconds, not seconds). */
  idleTimeoutMs?: number;
  /** Overrides the 15 minute session cap. */
  maxSessionMs?: number;
}

export type SttViolation =
  | { connectionId: number; kind: 'wrong_size'; size: number }
  | { connectionId: number; kind: 'too_fast'; leadMs: number };

export interface SttSegmentRecord {
  segmentIndex: number;
  text: string;
  audioDurationMs: number;
}

export interface SttConnectionRecord {
  id: number;
  /** Upgrade headers as received. The API key value is replaced, never stored. */
  headers: Record<string, string>;
  model: string;
  languageCode: string | undefined;
  format: string;
  sampleRate: number;
  /** Valid 1,024-byte frames received. */
  frames: number;
  /** `performance.now()` at arrival of each valid frame. */
  frameArrivals: number[];
  violations: SttViolation[];
  commits: number;
  /** Segments discarded for being shorter than x-min-segment-ms. */
  droppedSegments: number;
  segments: SttSegmentRecord[];
  settingsUpdates: number;
  closeCode: number | undefined;
  closeReason: string | undefined;
}

export interface MockSttServer {
  url: string;
  port: number;
  connections: SttConnectionRecord[];
  /** Queue scripted transcripts; each finished segment consumes one. */
  queueTranscripts(...texts: string[]): void;
  setTranscriptLatency(ms: number): void;
  /** Called for every wrong-size or too-fast frame. */
  onViolation(listener: (violation: SttViolation) => void): void;
  /** Push a Gnani-style `error` message to every open connection (the session stays open). */
  sendError(message: string): void;
  /** Close every open connection, as if Gnani dropped us. */
  dropConnections(code?: number, reason?: string): void;
  close(): Promise<void>;
}

interface Settings {
  languageCode: string | undefined;
  format: string;
  itnNativeNumerals: boolean;
  substitutionEnabled: boolean;
  biasWordCount: number;
  biasScore: number;
}

interface ServerState {
  options: MockSttOptions;
  nextConnectionId: number;
  transcriptQueue: string[];
  latencyMs: number;
  openSessions: Set<SttSession>;
  violationListeners: ((v: SttViolation) => void)[];
  connections: SttConnectionRecord[];
}

function firstHeader(req: IncomingMessage, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = req.headers[name];
    const text = Array.isArray(value) ? value[0] : value;
    if (text !== undefined && text.trim() !== '') return text.trim();
  }
  return undefined;
}

function numberHeader(req: IncomingMessage, name: string, fallback: number): number {
  const raw = firstHeader(req, name);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function formatIsValid(format: string, model: string): boolean {
  if (!ALL_FORMATS.includes(format)) return false;
  return model === 'prisma-v3.0' || !V3_ONLY_FORMATS.includes(format);
}

class SttSession {
  readonly record: SttConnectionRecord;
  private readonly requestId = randomUUID();
  private readonly frameMs: number;
  private readonly minSilenceMs: number;
  private readonly minSpeechMs: number;
  private readonly minSegmentMs: number;
  private readonly maxSpeechMs: number | undefined;
  private readonly idleMs: number;
  private readonly isV3: boolean;
  private settings: Settings;

  private speaking = false;
  private pendingSpeechFrames = 0;
  private segmentFrames = 0;
  private silenceFrames = 0;
  private segmentCounter = 0;
  private utteranceCounter = 0;
  private currentUtterance = '';
  /** Leaky-bucket clock: the time at which the next frame is "due" if the client is on cadence. */
  private nextDue = 0;

  private idleTimer: NodeJS.Timeout | undefined;
  private capTimer: NodeJS.Timeout | undefined;
  private readonly pendingTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly ws: WebSocket,
    req: IncomingMessage,
    private readonly server: ServerState,
  ) {
    const model = firstHeader(req, 'model', 'x-model') === 'prisma-v3.0' ? 'prisma-v3.0' : 'prisma-v2.5';
    this.isV3 = model === 'prisma-v3.0';
    const format = firstHeader(req, 'format', 'x-format') ?? 'verbatim';
    const sampleRate = numberHeader(req, 'x-sample-rate', 16_000);
    this.frameMs = (STT_FRAME_BYTES / 2 / sampleRate) * 1000;
    this.minSilenceMs = clamp(numberHeader(req, 'x-min-silence-ms', 500), 100, 2000);
    this.minSpeechMs = clamp(numberHeader(req, 'x-min-speech-ms', sampleRate === 8000 ? 200 : 100), 50, 2000);
    this.minSegmentMs = clamp(numberHeader(req, 'x-min-segment-ms', 120), 100, 1000);
    const maxSpeechS = firstHeader(req, 'x-max-speech-s');
    this.maxSpeechMs = maxSpeechS === undefined ? undefined : clamp(Number(maxSpeechS), 5, 120) * 1000;
    this.idleMs =
      server.options.idleTimeoutMs ?? clamp(numberHeader(req, 'x-idle-timeout-sec', 60), 5, 900) * 1000;

    const languageCode = firstHeader(req, 'language_code', 'lang_code');
    this.settings = {
      languageCode,
      format,
      itnNativeNumerals: firstHeader(req, 'itn_native_numerals') === 'true',
      substitutionEnabled: firstHeader(req, 'enable_substitution') === 'true',
      biasWordCount: 0,
      biasScore: numberHeader(req, 'bias_score', 0),
    };

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      headers[name] = name === 'x-api-key-id' ? '[redacted]' : String(value);
    }
    this.record = {
      id: server.nextConnectionId++,
      headers,
      model,
      languageCode,
      format,
      sampleRate,
      frames: 0,
      frameArrivals: [],
      violations: [],
      commits: 0,
      droppedSegments: 0,
      segments: [],
      settingsUpdates: 0,
      closeCode: undefined,
      closeReason: undefined,
    };
    server.connections.push(this.record);

    ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    ws.on('close', (code, reason) => this.onClose(code, reason.toString()));
    ws.on('error', () => undefined); // a peer reset is not interesting to the mock

    this.start(model);
  }

  closeFromServer(code: number, reason: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(code, reason);
  }

  sendError(message: string): void {
    this.send({ type: 'error', timestamp: now(), message });
  }

  private start(model: string): void {
    const cap = this.server.options.maxSessions;
    if (cap !== undefined && this.server.openSessions.size >= cap) {
      this.sendError(`Concurrent session limit reached (max ${cap}).`);
      this.ws.close(1001, 'session limit');
      return;
    }

    const { languageCode, format } = this.settings;
    const languageOptional = this.isV3 && format === 'transliterate';
    if (!formatIsValid(format, model)) {
      this.sendError('Invalid format for this model.');
      this.ws.close(1008, 'invalid format');
      return;
    }
    if (languageCode === undefined && !languageOptional) {
      this.sendError('language_code is required.');
      this.ws.close(1008, 'language_code required');
      return;
    }
    const candidates = (languageCode ?? 'indic-auto').split(',').filter(Boolean);
    if (candidates.length > 4 || (!this.isV3 && candidates.length > 1)) {
      this.sendError('Too many language codes for this model.');
      this.ws.close(1008, 'invalid language_code');
      return;
    }

    this.server.openSessions.add(this);
    const config: Record<string, unknown> = { sample_rate: this.record.sampleRate, chunk_size: 512 };
    if (this.isV3) {
      config['language_code'] = languageCode ?? 'indic-auto';
      config['format'] = format;
      if (candidates.length > 1) config['language_candidates'] = candidates;
    }
    this.send({
      type: 'connected',
      message: 'Mock Gnani STT connected (scripted transcripts)',
      timestamp: now(),
      ...(this.isV3 ? { request_id: this.requestId } : {}),
      config,
    });

    this.armIdleTimer();
    this.capTimer = setTimeout(() => {
      this.sendError('Session exceeded the maximum duration.');
      this.closeFromServer(1001, 'session cap');
    }, this.server.options.maxSessionMs ?? SESSION_CAP_MS);
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      this.onFrame(toUint8Array(data));
      return;
    }
    this.onControl(data.toString());
  }

  private onControl(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return; // not JSON: ignored, like any unknown control frame
    }
    if (typeof message !== 'object' || message === null) return;
    const type = (message as { type?: unknown }).type;
    if (type === 'commit') {
      this.record.commits++;
      this.commit();
    } else if (type === 'update_settings') {
      this.updateSettings(message as Record<string, unknown>);
    }
  }

  private onFrame(frame: Uint8Array): void {
    const arrival = performance.now();
    if (frame.byteLength !== STT_FRAME_BYTES) {
      // Docs say frames must be exactly 1,024 bytes but not what the server does otherwise.
      // The mock records the violation and ignores the frame.
      this.violate({ connectionId: this.record.id, kind: 'wrong_size', size: frame.byteLength });
      return;
    }

    if (this.nextDue < arrival) this.nextDue = arrival; // idle gap: the bucket refills
    const lead = this.nextDue - arrival;
    if (lead > (this.server.options.frameToleranceMs ?? 150)) {
      this.violate({ connectionId: this.record.id, kind: 'too_fast', leadMs: lead });
    }
    this.nextDue += this.frameMs;

    this.record.frames++;
    this.record.frameArrivals.push(arrival);
    this.runVad(rmsOfPcm16(frame) > (this.server.options.speechRmsThreshold ?? 500));
  }

  /** Frame-count based VAD, so behaviour does not depend on wall-clock timing in tests. */
  private runVad(isSpeech: boolean): void {
    if (!this.speaking) {
      if (!isSpeech) {
        this.pendingSpeechFrames = 0;
        return;
      }
      this.pendingSpeechFrames++;
      if (this.pendingSpeechFrames * this.frameMs >= this.minSpeechMs) this.beginSpeech();
      return;
    }

    this.segmentFrames++;
    this.silenceFrames = isSpeech ? 0 : this.silenceFrames + 1;
    const tooLong = this.maxSpeechMs !== undefined && this.segmentFrames * this.frameMs >= this.maxSpeechMs;
    if (this.silenceFrames * this.frameMs >= this.minSilenceMs || tooLong) this.finishSegment();
  }

  private beginSpeech(): void {
    this.speaking = true;
    this.segmentFrames = this.pendingSpeechFrames;
    this.silenceFrames = 0;
    this.utteranceCounter++;
    this.currentUtterance = `${this.requestId}-utt-${this.utteranceCounter}`;
    this.armIdleTimer();
    this.send({
      type: 'speech_start',
      ...(this.isV3 ? { utterance_id: this.currentUtterance } : {}),
    });
  }

  /** `commit` closes the open utterance immediately, even one shorter than x-min-speech-ms. */
  private commit(): void {
    if (!this.speaking && this.pendingSpeechFrames > 0) this.beginSpeech();
    if (this.speaking) this.finishSegment();
  }

  private finishSegment(): void {
    const audioDurationMs = Math.round(this.segmentFrames * this.frameMs);
    this.speaking = false;
    this.pendingSpeechFrames = 0;
    this.segmentFrames = 0;
    this.silenceFrames = 0;

    if (audioDurationMs < this.minSegmentMs) {
      this.record.droppedSegments++; // why a high x-min-segment-ms would swallow "haan"
      return;
    }

    const segmentIndex = ++this.segmentCounter;
    const latency = this.server.latencyMs;
    const text = this.nextTranscript({ connectionId: this.record.id, segmentIndex, audioDurationMs });
    const utteranceId = this.currentUtterance;

    this.send({ type: 'processing', timestamp: now() });

    const emit = () => {
      this.record.segments.push({ segmentIndex, text, audioDurationMs });
      this.armIdleTimer();
      this.send({
        type: 'transcript',
        timestamp: now(),
        text,
        audio_duration_ms: audioDurationMs,
        segment_id: `${this.requestId}-seg-${segmentIndex}`,
        segment_index: segmentIndex,
        latency,
        ...(this.isV3 ? { utterance_id: utteranceId } : {}),
        is_final: true,
        ...(this.isV3 && text !== '' && this.settings.format !== 'transliterate'
          ? { detected_language_code: 'hi-IN' } // scripted, not detected
          : {}),
      });
    };
    if (latency <= 0) {
      emit();
      return;
    }
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      emit();
    }, latency);
    this.pendingTimers.add(timer);
  }

  private nextTranscript(context: SegmentContext): string {
    const queued = this.server.transcriptQueue.shift();
    if (queued !== undefined) return queued;
    const fallback = this.server.options.defaultTranscript ?? 'mock transcript';
    return typeof fallback === 'function' ? fallback(context) : fallback;
  }

  private updateSettings(message: Record<string, unknown>): void {
    // Docs: VAD settings cannot change mid-session, and an invalid update is ignored as a whole.
    const forbidden = Object.keys(message).some((key) => /vad|silence|speech|segment/i.test(key));
    if (forbidden) return;

    const next = { ...this.settings };
    const { language_code, format, itn_native_numerals, substitution, bias } = message;

    if (language_code !== undefined) {
      if (typeof language_code !== 'string' || language_code === '') return;
      next.languageCode = language_code;
    }
    if (format !== undefined) {
      if (typeof format !== 'string' || !formatIsValid(format, this.record.model)) return;
      next.format = format;
    }
    if (itn_native_numerals !== undefined) {
      if (typeof itn_native_numerals !== 'boolean') return;
      next.itnNativeNumerals = itn_native_numerals;
    }
    if (substitution !== undefined) {
      const enabled = (substitution as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== 'boolean') return;
      next.substitutionEnabled = enabled;
    }
    if (bias !== undefined) {
      const { list, score } = (bias ?? {}) as { list?: unknown; score?: unknown };
      if (list !== undefined) {
        if (!Array.isArray(list) || list.some((w) => typeof w !== 'string')) return;
        next.biasWordCount = list.length;
      }
      if (score !== undefined) {
        if (typeof score !== 'number') return;
        next.biasScore = score;
      }
    }

    this.settings = next;
    this.record.settingsUpdates++;
    this.send({
      type: 'settings_updated',
      timestamp: now(),
      config: {
        language_code: next.languageCode,
        format: next.format,
        itn_native_numerals: next.itnNativeNumerals,
        substitution_enabled: next.substitutionEnabled,
        bias_word_count: next.biasWordCount,
        bias_score: next.biasScore,
      },
    });
  }

  private violate(violation: SttViolation): void {
    this.record.violations.push(violation);
    for (const listener of this.server.violationListeners) listener(violation);
  }

  private armIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.closeFromServer(1000, 'idle timeout'), this.idleMs);
  }

  private onClose(code: number, reason: string): void {
    this.record.closeCode = code;
    this.record.closeReason = reason;
    clearTimeout(this.idleTimer);
    clearTimeout(this.capTimer);
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.server.openSessions.delete(this);
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}

function now(): string {
  return new Date().toISOString();
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export async function startMockStt(options: MockSttOptions = {}): Promise<MockSttServer> {
  const state: ServerState = {
    options,
    nextConnectionId: 1,
    transcriptQueue: [],
    latencyMs: options.transcriptLatencyMs ?? 0,
    openSessions: new Set(),
    violationListeners: [],
    connections: [],
  };

  const httpServer = http.createServer((_req, res) => {
    res.writeHead(426).end('Upgrade Required');
  });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== STT_PATH) return reject(socket, '404 Not Found');
    const key = firstHeader(req, 'x-api-key-id');
    if (key === undefined || (options.validApiKey !== undefined && key !== options.validApiKey)) {
      return reject(socket, '401 Unauthorized');
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      new SttSession(ws, req, state);
    });
  });

  await new Promise<void>((resolve, reject_) => {
    httpServer.once('error', reject_);
    httpServer.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('mock STT failed to bind');
  const host = options.host ?? '127.0.0.1';

  return {
    url: `ws://${host}:${address.port}${STT_PATH}`,
    port: address.port,
    connections: state.connections,
    queueTranscripts: (...texts) => void state.transcriptQueue.push(...texts),
    setTranscriptLatency: (ms) => void (state.latencyMs = ms),
    onViolation: (listener) => void state.violationListeners.push(listener),
    sendError: (message) => state.openSessions.forEach((s) => s.sendError(message)),
    dropConnections: (code = 1011, reason = 'dropped by mock') =>
      state.openSessions.forEach((s) => s.closeFromServer(code, reason)),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      }),
  };
}
