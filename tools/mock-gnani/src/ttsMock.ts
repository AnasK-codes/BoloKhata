import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { wavHeader, writeSine } from './audio';

/**
 * Mock of Gnani's realtime TTS WebSocket (wss://api.vachana.ai/api/v1/tts).
 * Built from https://docs.gnani.ai/api/TTS/tts-websocket.md.
 *
 * It "speaks" a sine tone whose length depends on the text length. Nothing is synthesised.
 * Mock-only choices where the docs are silent: the voice catalog is not checked, a second request
 * while one is active gets an `error` message (the docs only say not to do it), and `wav` output
 * puts the 44-byte header at the start of the first chunk.
 */

export const TTS_PATH = '/api/v1/tts';

const MODELS = ['timbre-v2.5', 'timbre-v3.0'];
const LANGUAGES = [
  'auto', 'hi-IN', 'en-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'pa-IN', 'bn-IN', 'gu-IN', 'hi-en',
];
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];
const SPEED_WORDS: Record<string, number> = { slow: 0.85, medium: 1.0, fast: 1.15 };

export interface MockTtsOptions {
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  validApiKey?: string;
  /** Spoken length per character of text. */
  msPerChar?: number;
  minAudioMs?: number;
  /** Bytes per `audio` chunk (rounded to a whole sample). Ignored when `chunkCount` is set. */
  chunkBytes?: number;
  /** Split the audio into this many chunks instead. */
  chunkCount?: number;
  firstChunkDelayMs?: number;
  interChunkDelayMs?: number;
  /**
   * Real Gnani (observed 2026-11-08, not in the docs) sends `complete` twice per request: once with
   * the next chunk_index and once with chunk_index null. On by default so tests see what production
   * sees; set false for the single `complete` the docs describe.
   */
  duplicateComplete?: boolean;
  /**
   * Hold the duplicate `complete` back (at most this long) so it reaches the client in a separate
   * packet, after the client has sent its next request but still before that request's `start`.
   */
  duplicateCompleteDelayMs?: number;
}

export interface TtsRequestRecord {
  text: string;
  model: string;
  voice: string;
  language: string;
  speed: number;
  sampleRate: number;
  container: string;
  receivedAt: number;
  chunksSent: number;
  completed: boolean;
  /** True when the socket closed before `complete` was sent. */
  aborted: boolean;
}

export interface MockTtsServer {
  url: string;
  port: number;
  requests: TtsRequestRecord[];
  /** Requests refused because another one was still streaming. */
  readonly rejectedConcurrent: number;
  /** The next valid request fails with an `error` message instead of audio. */
  failNextRequest(message?: string): void;
  dropConnections(code?: number, reason?: string): void;
  close(): Promise<void>;
}

interface Config {
  sampleRate: number;
  container: 'raw' | 'wav';
}

function parseRequest(raw: string): (Config & {
  text: string; model: string; voice: string; language: string; speed: number;
}) | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { text, model, voice, language, speed, audio_config } = body as Record<string, unknown>;

  if (typeof text !== 'string' || text.trim() === '') return null;
  if (typeof model !== 'string' || !MODELS.includes(model)) return null;
  if (typeof voice !== 'string' || voice === '') return null;
  if (typeof language !== 'string' || !LANGUAGES.includes(language)) return null;

  let speedValue = 1;
  if (typeof speed === 'number') speedValue = speed;
  else if (typeof speed === 'string' && speed in SPEED_WORDS) speedValue = SPEED_WORDS[speed] ?? 1;
  else if (speed !== undefined) return null;
  if (speedValue < 0.85 || speedValue > 1.15) return null;

  const cfg = (audio_config ?? {}) as Record<string, unknown>;
  const sampleRate = cfg['sample_rate'] ?? 48_000; // docs default
  const container = cfg['container'] ?? 'wav'; // docs default
  const encoding = cfg['encoding'] ?? 'linear_pcm';
  if (typeof sampleRate !== 'number' || !SAMPLE_RATES.includes(sampleRate)) return null;
  // The mock only produces PCM: raw or wav. Other containers are real-API features it does not fake.
  if (container !== 'raw' && container !== 'wav') return null;
  if (encoding !== 'linear_pcm' && encoding !== 'pcm_s16le') return null;

  return { text, model, voice, language, speed: speedValue, sampleRate, container };
}

class TtsSession {
  private active = false;
  private timer: NodeJS.Timeout | undefined;
  private record: TtsRequestRecord | undefined;

  constructor(
    private readonly ws: WebSocket,
    private readonly server: TtsState,
  ) {
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => this.onClose());
    ws.on('error', () => undefined);
    server.sessions.add(this);
  }

  closeFromServer(code: number, reason: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(code, reason);
  }

  private onMessage(raw: string): void {
    const request = parseRequest(raw);
    if (request === null) {
      this.send({ type: 'error', message: 'Invalid text or audio configuration.' });
      return;
    }
    if (this.active) {
      this.server.rejectedConcurrent++;
      this.send({ type: 'error', message: 'Another synthesis request is already active.' });
      return;
    }
    if (this.server.failMessage !== undefined) {
      const message = this.server.failMessage;
      this.server.failMessage = undefined;
      this.send({ type: 'error', message });
      return;
    }
    // Like a real server, everything for the previous request goes out before the next one starts.
    this.pendingDuplicate?.();
    this.stream(request);
  }

  private stream(request: NonNullable<ReturnType<typeof parseRequest>>): void {
    const { options } = this.server;
    this.active = true;
    const record: TtsRequestRecord = {
      text: request.text,
      model: request.model,
      voice: request.voice,
      language: request.language,
      speed: request.speed,
      sampleRate: request.sampleRate,
      container: request.container,
      receivedAt: performance.now(),
      chunksSent: 0,
      completed: false,
      aborted: false,
    };
    this.record = record;
    this.server.requests.push(record);

    const durationMs = Math.max(options.minAudioMs ?? 200, request.text.length * (options.msPerChar ?? 60));
    const totalBytes = Math.round((request.sampleRate * 2 * durationMs) / 1000 / 2) * 2;
    const chunkBytes = Math.max(
      2,
      options.chunkCount !== undefined
        ? Math.ceil(totalBytes / options.chunkCount / 2) * 2
        : Math.floor((options.chunkBytes ?? 4800) / 2) * 2,
    );

    this.send({ type: 'start', message: 'Streaming started', request_id: `req_${randomUUID().slice(0, 8)}` });

    let sentBytes = 0;
    let chunkIndex = 0;
    const sendNext = () => {
      if (sentBytes >= totalBytes) {
        this.send({ type: 'complete', data: { chunk_index: chunkIndex + 1, audio: '', is_final: true } });
        if (options.duplicateComplete !== false) {
          const again = () => {
            clearTimeout(timer);
            this.pendingDuplicate = null;
            this.send({ type: 'complete', data: { chunk_index: null, audio: '', is_final: true } });
          };
          const timer = options.duplicateCompleteDelayMs ? setTimeout(again, options.duplicateCompleteDelayMs) : undefined;
          if (timer) this.pendingDuplicate = again;
          else again();
        }
        record.completed = true;
        this.active = false;
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sentBytes);
      const pcm = new Uint8Array(size);
      writeSine(pcm, sentBytes / 2, request.sampleRate);
      const payload =
        request.container === 'wav' && chunkIndex === 0
          ? Buffer.concat([wavHeader(totalBytes, request.sampleRate), pcm])
          : Buffer.from(pcm);
      sentBytes += size;
      chunkIndex++;
      record.chunksSent = chunkIndex;
      this.send({
        type: 'audio',
        data: { chunk_index: chunkIndex, audio: payload.toString('base64'), is_final: false },
      });
      this.timer = setTimeout(sendNext, options.interChunkDelayMs ?? 5);
    };
    this.timer = setTimeout(sendNext, options.firstChunkDelayMs ?? 30);
  }

  private onClose(): void {
    clearTimeout(this.timer);
    if (this.active && this.record) this.record.aborted = true;
    this.active = false;
    this.server.sessions.delete(this);
  }

  /** The previous request's duplicate `complete`, when it is being held back (separate packet). */
  private pendingDuplicate: (() => void) | null = null;

  private send(message: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
}

interface TtsState {
  options: MockTtsOptions;
  requests: TtsRequestRecord[];
  sessions: Set<TtsSession>;
  rejectedConcurrent: number;
  failMessage: string | undefined;
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return text !== undefined && text.trim() !== '' ? text.trim() : undefined;
}

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export async function startMockTts(options: MockTtsOptions = {}): Promise<MockTtsServer> {
  const state: TtsState = {
    options,
    requests: [],
    sessions: new Set(),
    rejectedConcurrent: 0,
    failMessage: undefined,
  };

  const httpServer = http.createServer((_req, res) => {
    res.writeHead(426).end('Upgrade Required');
  });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== TTS_PATH) return refuse(socket, '404 Not Found');
    const key = firstHeader(req, 'x-api-key-id');
    if (key === undefined || (options.validApiKey !== undefined && key !== options.validApiKey)) {
      return refuse(socket, '401 Unauthorized');
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      new TtsSession(ws, state);
    });
  });

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? 0, host, resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('mock TTS failed to bind');

  return {
    url: `ws://${host}:${address.port}${TTS_PATH}`,
    port: address.port,
    requests: state.requests,
    get rejectedConcurrent() {
      return state.rejectedConcurrent;
    },
    failNextRequest: (message = 'Synthesis failed.') => void (state.failMessage = message),
    dropConnections: (code = 1011, reason = 'dropped by mock') =>
      state.sessions.forEach((s) => s.closeFromServer(code, reason)),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      }),
  };
}
