import { AUDIO_FRAME_BYTES, AUDIO_FRAME_MS } from '@bolbill/shared';

/** Time source, injectable so cadence can be tested without waiting. */
export interface Clock {
  nowNs(): bigint;
  setTimer(fn: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemClock: Clock = {
  nowNs: () => process.hrtime.bigint(),
  setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export type FrameSink = (frame: Uint8Array) => void;

export interface PacerOptions {
  clock?: Clock;
  /** What to do with the backlog on release: keep the cadence, or send it at once. */
  drain: 'paced' | 'burst';
  /** Ring size in frames (default 512 = about 16 s of audio). */
  capacityFrames?: number;
}

const FRAME_NS = BigInt(Math.round(AUDIO_FRAME_MS * 1e6)); // 32 ms
/** Timers may fire about 1 ms early; a frame that close to due is sent now. */
const EARLY_TOLERANCE_NS = 1_000_000n;
/** If we fall further behind than this, forget the lag instead of catching up in a burst. */
const MAX_CATCH_UP_NS = FRAME_NS * 2n;

/**
 * Forwards microphone frames to Gnani at real-time cadence (one 1,024-byte frame per 32 ms).
 *
 * The browser sends frames as it captures them, but network jitter bunches them up; Gnani wants
 * even spacing, so frames wait in a pre-allocated ring and leave on a drift-corrected schedule:
 * each deadline is the previous deadline plus 32 ms, not "now plus 32 ms", so timer lateness
 * does not accumulate. Hot path: no allocation apart from the unavoidable timer handle.
 *
 * The sink must copy or finish with the frame synchronously: ring slots are reused. (The `ws`
 * client masks outgoing frames into a new buffer, which satisfies this.)
 */
export class Pacer {
  framesSent = 0;
  framesDropped = 0;

  private readonly clock: Clock;
  private readonly drainMode: 'paced' | 'burst';
  private readonly capacity: number;
  private readonly slots: Uint8Array[];
  private head = 0;
  private count = 0;
  private sink: FrameSink | null = null;
  private nextDueNs = 0n;
  private timer: unknown = null;
  private drainWaiter: (() => void) | null = null;
  private readonly onTimer = () => {
    this.timer = null;
    this.pump();
  };

  constructor(options: PacerOptions) {
    this.clock = options.clock ?? systemClock;
    this.drainMode = options.drain;
    this.capacity = options.capacityFrames ?? 512;
    const memory = new Uint8Array(this.capacity * AUDIO_FRAME_BYTES);
    this.slots = Array.from({ length: this.capacity }, (_, i) =>
      memory.subarray(i * AUDIO_FRAME_BYTES, (i + 1) * AUDIO_FRAME_BYTES),
    );
  }

  get backlog(): number {
    return this.count;
  }

  /** Where frames go. `null` pauses sending (for example while the upstream socket is down). */
  setSink(sink: FrameSink | null): void {
    this.sink = sink;
    if (sink) this.resumeOutput();
  }

  /** Copies `frame` into the ring. False means the ring is full and the frame was dropped. */
  push(frame: Uint8Array): boolean {
    if (this.count === this.capacity) {
      this.framesDropped++;
      return false;
    }
    this.slots[(this.head + this.count) % this.capacity]!.set(frame);
    this.count++;
    if (this.timer === null) this.pump();
    return true;
  }

  /**
   * Called on release. `done` runs once everything pushed so far has been sent: immediately if
   * nothing is waiting, otherwise after the backlog drains (paced or burst, per options).
   */
  endUtterance(done: () => void): void {
    if (this.count === 0) {
      done();
      return;
    }
    this.drainWaiter = done;
    this.resumeOutput();
  }

  /** Drops the backlog and any pending `endUtterance` callback (interrupt or disconnect). */
  reset(): void {
    this.clearTimer();
    this.head = 0;
    this.count = 0;
    this.drainWaiter = null;
  }

  private resumeOutput(): void {
    if (this.sink === null || this.count === 0) return;
    if (this.drainWaiter !== null && this.drainMode === 'burst') {
      while (this.count > 0) this.sendOne();
      this.finishDrain();
      return;
    }
    if (this.timer === null) this.pump();
  }

  private pump(): void {
    if (this.sink === null || this.count === 0) return;
    const now = this.clock.nowNs();
    if (this.nextDueNs + MAX_CATCH_UP_NS < now) this.nextDueNs = now; // idle gap or long stall
    if (now + EARLY_TOLERANCE_NS >= this.nextDueNs) {
      this.sendOne();
      this.nextDueNs += FRAME_NS;
      if (this.count === 0) {
        this.finishDrain();
        return;
      }
    }
    const waitNs = this.nextDueNs - this.clock.nowNs();
    this.timer = this.clock.setTimer(this.onTimer, Math.max(0, Math.ceil(Number(waitNs) / 1e6)));
  }

  private sendOne(): void {
    const frame = this.slots[this.head]!;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    this.framesSent++;
    this.sink?.(frame);
  }

  private finishDrain(): void {
    const waiter = this.drainWaiter;
    this.drainWaiter = null;
    waiter?.();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimer(this.timer);
    this.timer = null;
  }
}
