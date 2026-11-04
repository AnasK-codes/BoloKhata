import { FloatRing } from './ringBuffer';
import { LinearResampler } from './resampler';

export interface PlaybackEvents {
  /** First sample of a turn is being played; `contextTime` is when it enters the render output. */
  started(turnId: number, contextTime: number): void;
  /** Everything for the turn was played (it had ended and the buffer ran dry). */
  finished(turnId: number): void;
}

export interface PlaybackOptions {
  ringSeconds?: number;
  prefillMs?: number;
}

const NO_TURN = -1;
/** Ramp to zero over this long after a flush, so cutting audio mid-wave does not click. */
const FADE_MS = 2;
const CHUNK = 2048;
const MIN_SOURCE_RATE = 8000;

type Mode = 'idle' | 'buffering' | 'playing';

/**
 * The playback DSP, independent of the AudioWorklet so tests can drive it directly.
 * PCM chunks come in at the TTS rate, are resampled to the context rate straight into a ring
 * buffer, and `render` drains the ring a quantum at a time.
 *
 * Start-up waits for `prefillMs` of audio so network jitter does not cause gaps. An underrun
 * (ring empty while a turn is still arriving) outputs silence, is counted, and rebuffers.
 * Only the active turn's audio is accepted; everything else is ignored.
 */
export class PlaybackCore {
  private readonly ring: FloatRing;
  private readonly resampler: LinearResampler;
  private readonly staging: Float32Array;
  private readonly fadeSamples: number;
  private prefillSamples: number;
  private mode: Mode = 'idle';
  private turn = NO_TURN;
  private sourceRate = 0;
  private ended = false;
  private lastSample = 0;
  private fadeLeft = 0;
  underruns = 0;
  /** Source samples dropped because the ring was full. */
  overflowed = 0;

  constructor(
    readonly contextRate: number,
    private readonly events: PlaybackEvents,
    options: PlaybackOptions = {},
  ) {
    this.ring = new FloatRing(Math.round(contextRate * (options.ringSeconds ?? 2)));
    this.resampler = new LinearResampler(contextRate, contextRate);
    // Worst case: the slowest source rate we accept (8 kHz) upsampled to the context rate.
    this.staging = new Float32Array(Math.ceil((CHUNK * contextRate) / MIN_SOURCE_RATE) + 2);
    this.fadeSamples = Math.max(1, Math.round((contextRate * FADE_MS) / 1000));
    this.prefillSamples = Math.round((contextRate * (options.prefillMs ?? 80)) / 1000);
  }

  get activeTurn(): number {
    return this.turn;
  }

  get bufferedMs(): number {
    return (this.ring.available / this.contextRate) * 1000;
  }

  get capacityMs(): number {
    return (this.ring.capacity / this.contextRate) * 1000;
  }

  get playing(): boolean {
    return this.mode === 'playing';
  }

  setPrefillMs(ms: number): void {
    this.prefillSamples = Math.round((this.contextRate * ms) / 1000);
  }

  /** A new turn's audio is about to arrive. Anything older is discarded. */
  begin(turnId: number, sourceRate: number): void {
    if (turnId !== this.turn) {
      this.ring.clear();
      this.turn = turnId;
      this.mode = 'buffering';
      this.fadeLeft = 0;
      this.lastSample = 0;
    }
    this.ended = false;
    this.sourceRate = sourceRate;
    this.resampler.reset(sourceRate);
  }

  /** Returns the number of source samples accepted. Zero for a stale turn. */
  pushPcm(turnId: number, pcm: Int16Array): number {
    if (turnId !== this.turn || this.sourceRate === 0) return 0;
    let accepted = 0;
    for (let offset = 0; offset < pcm.length; offset += CHUNK) {
      const n = Math.min(CHUNK, pcm.length - offset);
      const produced = this.resampler.process(pcm, offset, n, this.staging, 0);
      const written = this.ring.write(this.staging, 0, produced);
      if (written < produced) {
        this.overflowed += n;
        continue;
      }
      accepted += n;
    }
    return accepted;
  }

  /** No more audio is coming for this turn: play what is buffered even if it is below the prefill. */
  end(turnId: number): void {
    if (turnId !== this.turn) return;
    this.ended = true;
  }

  /** Instantly drop everything and go silent, after a very short fade. */
  flush(): void {
    if (this.mode === 'playing') this.fadeLeft = this.fadeSamples;
    this.ring.clear();
    this.mode = 'idle';
    this.turn = NO_TURN;
    this.ended = false;
  }

  /** Fills `out` (one render quantum of mono audio). `contextTime` is the quantum's start. */
  render(out: Float32Array, contextTime: number): void {
    const length = out.length;
    let written = 0;

    if (this.mode === 'buffering') {
      const ready =
        this.ring.available >= this.prefillSamples || (this.ended && this.ring.available > 0);
      if (ready) {
        this.mode = 'playing';
        this.events.started(this.turn, contextTime);
      }
    }

    if (this.mode === 'playing') {
      written = this.ring.read(out, 0, length);
      if (written > 0) this.lastSample = out[written - 1] as number;
      if (written < length) {
        if (this.ended) {
          const turn = this.turn;
          this.mode = 'idle';
          this.turn = NO_TURN;
          this.ended = false;
          this.events.finished(turn);
        } else {
          this.underruns++;
          this.mode = 'buffering';
        }
      }
    }

    if (written < length) {
      let i = written;
      for (; i < length && this.fadeLeft > 0; i++) {
        out[i] = (this.lastSample * this.fadeLeft) / this.fadeSamples;
        this.fadeLeft--;
      }
      out.fill(0, i);
    }
  }
}
