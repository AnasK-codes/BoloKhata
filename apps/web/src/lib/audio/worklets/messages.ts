/** Messages between the main thread and the worklets. Plain data, no classes. */

export type CaptureCommand =
  | { type: 'gate'; open: boolean; seq: number }
  /** Hands a frame buffer back after it was sent, so the worklet can reuse it. */
  | { type: 'recycle'; buffer: ArrayBuffer };

export type CaptureEvent =
  | { type: 'level'; rms: number; overruns: number }
  /** Reply to a `gate` command, after the last partial frame (if any) was posted. */
  | { type: 'gate_ack'; open: boolean; seq: number };

export type PlaybackCommand =
  | { type: 'begin'; turnId: number; sampleRate: number }
  | { type: 'chunk'; turnId: number; pcm: ArrayBuffer }
  | { type: 'end'; turnId: number }
  | { type: 'flush' }
  | { type: 'config'; prefillMs: number };

export type PlaybackEvent =
  | { type: 'stats'; bufferedMs: number; underruns: number; overflowed: number; playing: boolean }
  | { type: 'started'; turnId: number; contextTime: number }
  | { type: 'finished'; turnId: number };
