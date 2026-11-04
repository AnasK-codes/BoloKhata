import { AUDIO_FRAME_SAMPLES, AUDIO_SAMPLE_RATE } from '@bolbill/shared';
import { Decimator } from './decimator';
import { floatToInt16 } from './int16';

/** Where finished frames and meter readings go. The worklet shell implements it over a MessagePort. */
export interface CaptureSink {
  /** A 512-sample Int16Array to fill. Ownership passes to the sink on `emit`. */
  acquire(): Int16Array;
  emit(frame: Int16Array): void;
  /** RMS of the native-rate input over roughly the last 50 ms (0 to 1). */
  level(rms: number): void;
}

export interface CaptureOptions {
  levelIntervalMs?: number;
}

const BLOCK = 1024;

/**
 * The capture DSP, independent of the AudioWorklet so tests can drive it directly:
 * decimate to 16 kHz, convert to 16-bit, cut into exactly 512-sample frames.
 *
 * While the gate is closed it only measures level; it does no filtering and holds no frame
 * buffer, so a warm microphone costs almost nothing and sends nothing. Opening the gate
 * restarts the filter from silence. Closing it pads the last partial frame with zeros and
 * emits it, so the tail of the last word is not cut off (at most 32 ms of padding).
 */
export class CaptureCore {
  private readonly decimator: Decimator | null;
  private readonly scratch: Float32Array;
  private readonly levelEvery: number;
  private frame: Int16Array | null = null;
  private filled = 0;
  private open = false;
  private sumSquares = 0;
  private levelCount = 0;
  framesEmitted = 0;

  constructor(
    readonly inputRate: number,
    private readonly sink: CaptureSink,
    options: CaptureOptions = {},
  ) {
    this.decimator =
      inputRate === AUDIO_SAMPLE_RATE ? null : new Decimator(inputRate, AUDIO_SAMPLE_RATE, { maxBlock: BLOCK });
    this.scratch = new Float32Array(this.decimator ? this.decimator.maxOutputFor(BLOCK) : 0);
    this.levelEvery = Math.max(1, Math.round((inputRate * (options.levelIntervalMs ?? 50)) / 1000));
  }

  get gateOpen(): boolean {
    return this.open;
  }

  setGate(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) {
      this.decimator?.reset();
      this.filled = 0;
      return;
    }
    if (this.frame !== null && this.filled > 0) {
      this.frame.fill(0, this.filled);
      this.emitFrame();
    }
  }

  process(input: Float32Array): void {
    this.measure(input);
    if (!this.open) return;
    const length = input.length;
    for (let offset = 0; offset < length; offset += BLOCK) {
      const n = Math.min(BLOCK, length - offset);
      if (this.decimator === null) {
        this.append(input, offset, n);
      } else {
        const produced = this.decimator.process(input, offset, n, this.scratch, 0);
        this.append(this.scratch, 0, produced);
      }
    }
  }

  private append(samples: Float32Array, offset: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.frame === null) this.frame = this.sink.acquire();
      this.frame[this.filled++] = floatToInt16(samples[offset + i] as number);
      if (this.filled === AUDIO_FRAME_SAMPLES) this.emitFrame();
    }
  }

  private emitFrame(): void {
    const frame = this.frame;
    this.frame = null;
    this.filled = 0;
    if (frame === null) return;
    this.framesEmitted++;
    this.sink.emit(frame);
  }

  private measure(input: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i] as number;
      sum += v * v;
    }
    this.sumSquares += sum;
    this.levelCount += input.length;
    if (this.levelCount >= this.levelEvery) {
      this.sink.level(Math.sqrt(this.sumSquares / this.levelCount));
      this.sumSquares = 0;
      this.levelCount = 0;
    }
  }
}
