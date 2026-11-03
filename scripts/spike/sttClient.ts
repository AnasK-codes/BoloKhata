import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { FRAME_MS, sendPaced, type PaceOptions } from './pacer';
import { STT_FRAME_BYTES } from './wav';

export interface VadConfig {
  threshold: number;
  minSilenceMs: number;
  minSpeechMs: number;
  minSegmentMs: number;
}

/** The `x-vad-*` defaults from the Gnani docs. */
export const DOCS_DEFAULT_VAD: VadConfig = { threshold: 0.7, minSilenceMs: 500, minSpeechMs: 100, minSegmentMs: 120 };

export interface SttConfig {
  url: string;
  apiKey: string;
  model: 'prisma-v3.0' | 'prisma-v2.5';
  language: string;
  format: 'verbatim' | 'transcribe' | 'codemix' | 'transliterate';
  keyterms?: string[];
  vad?: VadConfig;
  idleTimeoutSec?: number;
}

export function sttHeaders(config: SttConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key-id': config.apiKey,
    model: config.model,
    language_code: config.language,
    format: config.format,
    'x-sample-rate': '16000',
  };
  if (config.keyterms && config.keyterms.length > 0) headers['keyterms'] = config.keyterms.join(',');
  if (config.idleTimeoutSec !== undefined) headers['x-idle-timeout-sec'] = String(config.idleTimeoutSec);
  if (config.vad) {
    headers['x-vad-threshold'] = String(config.vad.threshold);
    headers['x-min-silence-ms'] = String(config.vad.minSilenceMs);
    headers['x-min-speech-ms'] = String(config.vad.minSpeechMs);
    headers['x-min-segment-ms'] = String(config.vad.minSegmentMs);
  }
  return headers;
}

// Upstream messages are untrusted: validate the shape we rely on, keep the rest opaque.
const upstreamSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  latency: z.number().optional(),
  segment_index: z.number().optional(),
  segment_id: z.string().optional(),
  utterance_id: z.string().optional(),
  audio_duration_ms: z.number().optional(),
  message: z.string().optional(),
});
export type SttMessage = z.infer<typeof upstreamSchema>;

export interface SttEvent {
  type: string;
  /** performance.now() on arrival. */
  t: number;
  msg: SttMessage;
}

export interface CloseInfo {
  code: number;
  reason: string;
  t: number;
}

export class SttOpenError extends Error {}

export class SttSession {
  readonly events: SttEvent[] = [];
  closeInfo: CloseInfo | null = null;
  private listeners = new Set<() => void>();

  private constructor(
    private readonly ws: WebSocket,
    readonly openedAt: number,
    readonly upgradeMs: number,
    readonly connectedMs: number,
  ) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onText(data.toString());
    });
    ws.on('close', (code, reason) => {
      this.closeInfo = { code, reason: reason.toString(), t: performance.now() };
      this.notify();
    });
    ws.on('error', () => this.notify());
  }

  /** Opens the socket and resolves once Gnani has sent `connected`. */
  static open(config: SttConfig, timeoutMs = 10_000): Promise<SttSession> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const ws = new WebSocket(config.url, { headers: sttHeaders(config), perMessageDeflate: false });
      let upgradeAt = 0;
      const fail = (reason: string) => {
        clearTimeout(timer);
        ws.terminate();
        reject(new SttOpenError(reason));
      };
      const timer = setTimeout(() => fail('timed out waiting for the STT `connected` message'), timeoutMs);
      ws.on('open', () => {
        upgradeAt = performance.now();
      });
      ws.on('unexpected-response', (_req, res) => fail(`handshake rejected with HTTP ${res.statusCode ?? '?'}`));
      ws.on('error', (error) => fail(`socket error: ${error.message}`));
      ws.on('close', (code, reason) => fail(`closed before connected (code ${code} ${reason.toString()})`));
      ws.on('message', (data, isBinary) => {
        if (isBinary || upgradeAt === 0) return;
        const parsed = upstreamSchema.safeParse(safeJson(data.toString()));
        if (!parsed.success || parsed.data.type !== 'connected') return;
        clearTimeout(timer);
        ws.removeAllListeners();
        const session = new SttSession(ws, started, upgradeAt - started, performance.now() - started);
        session.events.push({ type: 'connected', t: performance.now(), msg: parsed.data });
        resolve(session);
      });
    });
  }

  private onText(text: string): void {
    const parsed = upstreamSchema.safeParse(safeJson(text));
    if (parsed.success) {
      this.events.push({ type: parsed.data.type, t: performance.now(), msg: parsed.data });
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  sendFrame(frame: Buffer): void {
    this.ws.send(frame, { binary: true });
  }

  sendJson(value: unknown): void {
    this.ws.send(JSON.stringify(value));
  }

  commit(): void {
    this.sendJson({ type: 'commit' });
  }

  /** First event at or after `fromIndex` that matches, or null on timeout / close. */
  waitForEvent(match: (event: SttEvent) => boolean, fromIndex: number, timeoutMs: number): Promise<SttEvent | null> {
    return new Promise((resolve) => {
      const check = (): boolean => {
        const found = this.events.slice(fromIndex).find(match);
        if (found) return finish(found);
        if (this.closeInfo) return finish(null);
        return false;
      };
      const finish = (value: SttEvent | null): boolean => {
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

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.ws.once('close', () => resolve()));
    this.ws.close(1000);
    await Promise.race([closed, delay(1500)]);
    this.ws.terminate();
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface TranscriptRecord {
  text: string;
  /** ms after the commit (negative: arrived while streaming, the VAD closed the segment first). */
  afterCommitMs: number;
  reportedLatencyMs: number | null;
  segmentIndex: number | null;
  segmentId: string | null;
  utteranceId: string | null;
  audioDurationMs: number | null;
}

export interface UtteranceResult {
  framesSent: number;
  audioSeconds: number;
  maxLateMs: number;
  /** First frame sent to commit (roughly the clip length). */
  streamMs: number;
  /** Commit to the first `processing` event at or after it. */
  commitToProcessingMs: number | null;
  /** Commit to the first `transcript` at or after it. */
  commitToTranscriptMs: number | null;
  reportedLatencyMs: number | null;
  /** True when a transcript arrived before the commit and none after (server VAD won the race). */
  vadClosedFirst: boolean;
  transcripts: TranscriptRecord[];
  text: string;
  errors: string[];
}

/** Streams one clip at real-time cadence, commits, and measures what comes back. */
export async function streamUtterance(
  session: SttSession,
  pcm: Buffer,
  pace: PaceOptions,
  options: { transcriptTimeoutMs?: number } = {},
): Promise<UtteranceResult> {
  const startIndex = session.events.length;
  const paced = await sendPaced(pcm, STT_FRAME_BYTES, pace, (f) => session.sendFrame(f), () => session.isOpen);
  const commitAt = performance.now();
  if (session.isOpen) session.commit();

  const afterCommit = (e: SttEvent) => e.t >= commitAt;
  const processing = await session.waitForEvent((e) => e.type === 'processing' && afterCommit(e), startIndex, 8000);
  const first = await session.waitForEvent(
    (e) => e.type === 'transcript' && afterCommit(e),
    startIndex,
    options.transcriptTimeoutMs ?? 8000,
  );
  // Give a possible second segment a moment to arrive before reading the log.
  if (first) await delay(300);

  const transcripts = session.events
    .slice(startIndex)
    .filter((e) => e.type === 'transcript')
    .map((e): TranscriptRecord => ({
      text: e.msg.text ?? '',
      afterCommitMs: e.t - commitAt,
      reportedLatencyMs: e.msg.latency ?? null,
      segmentIndex: e.msg.segment_index ?? null,
      segmentId: e.msg.segment_id ?? null,
      utteranceId: e.msg.utterance_id ?? null,
      audioDurationMs: e.msg.audio_duration_ms ?? null,
    }));
  const errors = session.events
    .slice(startIndex)
    .filter((e) => e.type === 'error')
    .map((e) => e.msg.message ?? 'unknown error');

  return {
    framesSent: paced.framesSent,
    audioSeconds: (paced.framesSent * FRAME_MS) / 1000,
    maxLateMs: paced.maxLateMs,
    streamMs: commitAt - paced.firstFrameAt,
    commitToProcessingMs: processing ? processing.t - commitAt : null,
    commitToTranscriptMs: first ? first.t - commitAt : null,
    reportedLatencyMs: first?.msg.latency ?? null,
    vadClosedFirst: !first && transcripts.length > 0,
    transcripts,
    text: transcripts.map((t) => t.text).join(' ').trim(),
    errors,
  };
}
