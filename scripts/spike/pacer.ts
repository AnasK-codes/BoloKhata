import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const FRAME_MS = 32;

export interface PaceOptions {
  /** Audio captured before the press is sent as a burst at the start (0 = strictly real time). */
  preRollMs: number;
  /** The last this-many ms of audio are sent without waiting (0 = strictly real time). */
  drainMs: number;
}

/**
 * When each frame is due, in ms after the first send. Absolute targets (not "sleep 32 ms") so
 * timer jitter never accumulates into drift.
 */
export function frameOffsetsMs(frameCount: number, options: PaceOptions): number[] {
  const drainFrames = Math.min(frameCount, Math.ceil(options.drainMs / FRAME_MS));
  const firstDrained = frameCount - drainFrames;
  const offsets: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    offsets.push(i < firstDrained ? Math.max(0, i * FRAME_MS - options.preRollMs) : 0);
  }
  // Drained frames go out right behind the last paced frame.
  const lastPaced = firstDrained > 0 ? (offsets[firstDrained - 1] ?? 0) : 0;
  for (let i = firstDrained; i < frameCount; i++) offsets[i] = lastPaced;
  return offsets;
}

async function sleepUntil(targetMs: number): Promise<void> {
  // Windows timers are ~15 ms coarse: sleep most of the wait, then yield-spin for the last 2 ms.
  for (;;) {
    const remaining = targetMs - performance.now();
    if (remaining <= 0) return;
    if (remaining > 3) await delay(remaining - 2);
    else await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export interface PaceResult {
  firstFrameAt: number;
  lastFrameAt: number;
  framesSent: number;
  /** Worst case of (actual send time - due time). Large values mean the local timer misbehaved. */
  maxLateMs: number;
}

export async function sendPaced(
  frames: Buffer,
  frameBytes: number,
  options: PaceOptions,
  send: (frame: Buffer) => void,
  isOpen: () => boolean,
): Promise<PaceResult> {
  const count = frames.length / frameBytes;
  const offsets = frameOffsetsMs(count, options);
  const start = performance.now();
  let maxLateMs = 0;
  let framesSent = 0;
  let lastFrameAt = start;
  for (let i = 0; i < count; i++) {
    const due = start + (offsets[i] ?? 0);
    await sleepUntil(due);
    if (!isOpen()) break;
    send(frames.subarray(i * frameBytes, (i + 1) * frameBytes));
    lastFrameAt = performance.now();
    framesSent += 1;
    maxLateMs = Math.max(maxLateMs, lastFrameAt - due);
  }
  return { firstFrameAt: start, lastFrameAt, framesSent, maxLateMs };
}
