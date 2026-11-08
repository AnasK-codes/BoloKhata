import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { z } from 'zod';

export interface TtsRequest {
  text: string;
  model: 'timbre-v2.5' | 'timbre-v3.0';
  voice: string;
  language: string;
  sampleRate: number;
  container: 'raw' | 'wav';
  speed?: number;
}

export function ttsRequestBody(request: TtsRequest): Record<string, unknown> {
  return {
    text: request.text,
    model: request.model,
    voice: request.voice,
    language: request.language,
    speed: request.speed ?? 1.0,
    audio_config: {
      sample_rate: request.sampleRate,
      num_channels: 1,
      sample_width: 2,
      encoding: 'linear_pcm',
      container: request.container,
    },
  };
}

const upstreamSchema = z.looseObject({
  type: z.string(),
  message: z.string().optional(),
  request_id: z.string().optional(),
  data: z
    .looseObject({
      chunk_index: z.number().optional(),
      audio: z.string().optional(),
      is_final: z.boolean().optional(),
    })
    .optional(),
});

export interface TtsChunk {
  index: number | null;
  bytes: number;
  /** ms after the request was sent. */
  atMs: number;
}

export interface TtsResult {
  /** `start` arrival, ms after the request was sent (null if none came). */
  startMs: number | null;
  firstChunkMs: number | null;
  totalMs: number | null;
  completed: boolean;
  error: string | null;
  chunks: TtsChunk[];
  audio: Buffer;
  /** First four bytes of the first chunk as ASCII, to see whether chunks carry a RIFF header. */
  firstChunkMagic: string | null;
  /** How many chunks (after the first) begin with "RIFF". */
  riffChunks: number;
}

export class TtsOpenError extends Error {}

interface RawMessage {
  t: number;
  type: string;
  message: string | undefined;
  chunkIndex: number | null;
  audio: Buffer | null;
  isFinal: boolean;
}

export class TtsSession {
  readonly openMs: number;
  private readonly inbox: RawMessage[] = [];
  private listeners = new Set<() => void>();
  closed = false;
  private readonly openedAt: number;

  private constructor(
    private readonly ws: WebSocket,
    openedAt: number,
    openMs: number,
  ) {
    this.openedAt = openedAt;
    this.openMs = openMs;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onText(data.toString());
    });
    ws.on('error', () => this.notify());
    ws.on('close', () => {
      this.closed = true;
      this.notify();
    });
  }

  static open(url: string, apiKey: string, timeoutMs = 10_000): Promise<TtsSession> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const ws = new WebSocket(url, {
        headers: { 'X-API-Key-ID': apiKey, 'Content-Type': 'application/json' },
        perMessageDeflate: false,
      });
      const fail = (reason: string) => {
        clearTimeout(timer);
        ws.terminate();
        reject(new TtsOpenError(reason));
      };
      const timer = setTimeout(() => fail('timed out opening the TTS socket'), timeoutMs);
      ws.on('unexpected-response', (_req, res) => fail(`handshake rejected with HTTP ${res.statusCode ?? '?'}`));
      ws.on('error', (error) => fail(`socket error: ${error.message}`));
      ws.on('open', () => {
        clearTimeout(timer);
        ws.removeAllListeners();
        resolve(new TtsSession(ws, started, performance.now() - started));
      });
    });
  }

  private onText(text: string): void {
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    const parsed = upstreamSchema.safeParse(json);
    if (!parsed.success) return;
    const { data, type, message } = parsed.data;
    this.inbox.push({
      t: performance.now(),
      type,
      message,
      chunkIndex: data?.chunk_index ?? null,
      audio: data?.audio ? Buffer.from(data.audio, 'base64') : null,
      isFinal: data?.is_final ?? false,
    });
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private next(timeoutMs: number): Promise<RawMessage | null> {
    return new Promise((resolve) => {
      const check = (): boolean => {
        const message = this.inbox.shift();
        if (message) return finish(message);
        if (this.closed) return finish(null);
        return false;
      };
      const finish = (value: RawMessage | null): boolean => {
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve(value);
        return true;
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.listeners.add(check);
      check();
    });
  }

  sendRaw(body: unknown): number {
    const at = performance.now();
    this.ws.send(JSON.stringify(body));
    return at;
  }

  /** Sends one synthesis request and reads messages until `complete`, `error`, close or timeout. */
  async synthesize(request: TtsRequest, timeoutMs = 15_000): Promise<TtsResult> {
    const sentAt = this.sendRaw(ttsRequestBody(request));
    return this.collect(sentAt, timeoutMs);
  }

  async collect(sentAt: number, timeoutMs: number): Promise<TtsResult> {
    const result: TtsResult = {
      startMs: null,
      firstChunkMs: null,
      totalMs: null,
      completed: false,
      error: null,
      chunks: [],
      audio: Buffer.alloc(0),
      firstChunkMagic: null,
      riffChunks: 0,
    };
    const parts: Buffer[] = [];
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const message = await this.next(deadline - performance.now());
      if (!message) {
        result.error ??= this.closed ? 'socket closed before complete' : 'timed out';
        break;
      }
      const atMs = message.t - sentAt;
      // Gnani sends `complete` twice per request (observed 2026-11-08, not documented). Anything
      // before this request's own `start` is the previous request's tail and must not end this one.
      if (message.type !== 'start' && message.type !== 'error' && result.startMs === null) continue;
      if (message.type === 'start') {
        result.startMs = atMs;
      } else if (message.type === 'audio' && message.audio) {
        if (result.chunks.length === 0) {
          result.firstChunkMs = atMs;
          result.firstChunkMagic = message.audio.toString('ascii', 0, 4);
        } else if (message.audio.toString('ascii', 0, 4) === 'RIFF') {
          result.riffChunks += 1;
        }
        result.chunks.push({ index: message.chunkIndex, bytes: message.audio.length, atMs });
        parts.push(message.audio);
      } else if (message.type === 'complete') {
        result.completed = true;
        result.totalMs = atMs;
        break;
      } else if (message.type === 'error') {
        result.error = message.message ?? 'unknown error';
        result.totalMs = atMs;
        break;
      }
    }
    result.audio = Buffer.concat(parts);
    return result;
  }

  /** Raw access for the concurrency test: everything that arrives within `windowMs`. */
  async drainFor(windowMs: number): Promise<{ type: string; atMs: number; chunkIndex: number | null }[]> {
    const begin = performance.now();
    const seen: { type: string; atMs: number; chunkIndex: number | null }[] = [];
    while (performance.now() - begin < windowMs) {
      const message = await this.next(windowMs - (performance.now() - begin));
      if (!message) break;
      seen.push({ type: message.type, atMs: message.t - begin, chunkIndex: message.chunkIndex });
    }
    return seen;
  }

  get connectionSeconds(): number {
    return (performance.now() - this.openedAt) / 1000;
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.ws.once('close', () => resolve()));
    this.ws.close(1000);
    await Promise.race([closed, delay(1500)]);
    this.ws.terminate();
  }
}

/**
 * Playability check: if playback starts when the first chunk arrives, how many later chunks arrive
 * after the audio already queued would have run out (an audible gap)?
 */
export function underruns(chunks: TtsChunk[], sampleRate: number): number {
  const first = chunks[0];
  if (!first) return 0;
  let playedMs = 0;
  let gaps = 0;
  for (const chunk of chunks) {
    if (chunk.atMs - first.atMs > playedMs + 1e-6) gaps += 1;
    playedMs += (chunk.bytes / 2 / sampleRate) * 1000;
  }
  return gaps;
}

export function audioMs(bytes: number, sampleRate: number): number {
  return (bytes / 2 / sampleRate) * 1000;
}
