import { PlaybackFeed } from './playbackFeed';
import type { PlaybackCommand, PlaybackEvent } from './worklets/messages';

export interface PlaybackStats {
  bufferedMs: number;
  pendingMs: number;
  underruns: number;
  overflowed: number;
  playing: boolean;
}

export interface FirstAudible {
  turnId: number;
  /** When the first sample of the turn reaches the speaker, on the `performance.now()` clock. */
  perfMs: number;
  /** `timestamp` uses the browser's output clock; `latency` adds the reported latencies. */
  method: 'timestamp' | 'latency';
}

export interface PlaybackEngineEvents {
  onFirstAudible?: (event: FirstAudible) => void;
  /** All audio for the turn has been played out. */
  onFinished?: (turnId: number) => void;
  onStats?: (stats: PlaybackStats) => void;
  /** The worklet confirmed it is empty after a flush; `perfMs` is when that reached the page. */
  onFlushed?: (perfMs: number) => void;
}

const WORKLET_URL = '/worklets/playback.js';
const RING_SECONDS = 2;

/**
 * TTS audio out. Chunks are copied once (the gateway's PCM view sits at an odd byte offset),
 * transferred to the playback worklet, resampled there, and played from a ring buffer.
 */
export class PlaybackEngine {
  private node: AudioWorkletNode | null = null;
  private feed: PlaybackFeed | null = null;
  private flushPending = false;
  private stats: PlaybackStats = { bufferedMs: 0, pendingMs: 0, underruns: 0, overflowed: 0, playing: false };

  constructor(
    private readonly context: AudioContext,
    private readonly events: PlaybackEngineEvents = {},
  ) {}

  getStats(): PlaybackStats {
    return this.stats;
  }

  get activeTurn(): number {
    return this.feed?.activeTurn ?? -1;
  }

  async init(): Promise<void> {
    if (this.node !== null) return;
    await this.context.audioWorklet.addModule(WORKLET_URL);
    const node = new AudioWorkletNode(this.context, 'bolbill-playback', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event: MessageEvent<PlaybackEvent>) => this.onWorkletMessage(event.data);
    node.connect(this.context.destination);
    this.node = node;
    this.feed = new PlaybackFeed(RING_SECONDS * 1000, (command, transfer) =>
      this.post(command, transfer),
    );
  }

  setPrefillMs(prefillMs: number): void {
    this.post({ type: 'config', prefillMs });
  }

  beginTurn(turnId: number, sampleRate: number): void {
    this.feed?.begin(turnId, sampleRate);
  }

  /** `pcm` is raw 16-bit little-endian PCM; it is copied, so the caller keeps its buffer. */
  pushPcm(turnId: number, pcm: Uint8Array): void {
    if (this.feed === null || turnId !== this.feed.activeTurn) return;
    this.feed.push(turnId, pcm.slice().buffer);
  }

  endTurn(turnId: number): void {
    this.feed?.end(turnId);
  }

  /** Silence now. Safe to call at any time. */
  flush(): void {
    this.feed?.flush();
    this.flushPending = true;
    this.stats = { ...this.stats, bufferedMs: 0, pendingMs: 0, playing: false };
    this.events.onStats?.(this.stats);
  }

  dispose(): void {
    this.flush();
    this.node?.disconnect();
    this.node = null;
    this.feed = null;
  }

  private post(command: PlaybackCommand, transfer: ArrayBuffer[] = []): void {
    this.node?.port.postMessage(command, transfer);
  }

  private onWorkletMessage(message: PlaybackEvent): void {
    if (message.type === 'stats') {
      this.feed?.onBuffered(message.bufferedMs);
      this.stats = {
        bufferedMs: message.bufferedMs,
        pendingMs: this.feed?.pendingMs ?? 0,
        underruns: message.underruns,
        overflowed: message.overflowed,
        playing: message.playing,
      };
      this.events.onStats?.(this.stats);
      if (this.flushPending && message.bufferedMs === 0) {
        this.flushPending = false;
        this.events.onFlushed?.(performance.now());
      }
    } else if (message.type === 'started') {
      if (message.turnId === this.activeTurn) this.events.onFirstAudible?.(this.audibleAt(message));
    } else if (message.turnId === this.activeTurn || this.activeTurn === -1) {
      this.events.onFinished?.(message.turnId);
    }
  }

  /** Converts the worklet's context time of the first sample into a `performance.now()` time. */
  private audibleAt(message: { turnId: number; contextTime: number }): FirstAudible {
    const stamp = this.context.getOutputTimestamp?.();
    if (stamp !== undefined && stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.contextTime > 0) {
      // The output timestamp is the position of the sample the device is playing right now.
      return {
        turnId: message.turnId,
        perfMs: stamp.performanceTime + (message.contextTime - stamp.contextTime) * 1000,
        method: 'timestamp',
      };
    }
    const latency = (this.context.baseLatency ?? 0) + (this.context.outputLatency ?? 0);
    return {
      turnId: message.turnId,
      perfMs: performance.now() + (message.contextTime - this.context.currentTime + latency) * 1000,
      method: 'latency',
    };
  }
}
