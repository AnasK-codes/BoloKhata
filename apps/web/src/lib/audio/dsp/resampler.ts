/**
 * Streaming linear resampler from 16-bit PCM to float, used to bring TTS audio (for example
 * 24 kHz) to the AudioContext's rate. The fractional read position and the last sample of the
 * previous chunk are carried over, so splitting the same audio into chunks anywhere produces
 * exactly the same output as one big call (no clicks or drift at chunk boundaries).
 */
export class LinearResampler {
  /** Source samples advanced per output sample. */
  private ratio: number;
  /** Next read position, relative to the start of the coming chunk; may be in [-1, 0). */
  private t = 0;
  private prev = 0;

  constructor(
    sourceRate: number,
    readonly targetRate: number,
  ) {
    this.ratio = sourceRate / targetRate;
  }

  maxOutputFor(sourceLength: number): number {
    return Math.ceil(sourceLength / this.ratio) + 2;
  }

  reset(sourceRate?: number): void {
    if (sourceRate !== undefined) this.ratio = sourceRate / this.targetRate;
    this.t = 0;
    this.prev = 0;
  }

  /**
   * Resamples `length` samples of `src` starting at `srcOffset` into `dst`, scaled to
   * [-1, 1). Returns the number of samples written.
   */
  process(
    src: Int16Array,
    srcOffset: number,
    length: number,
    dst: Float32Array,
    dstOffset: number,
  ): number {
    if (length === 0) return 0;
    const scale = 1 / 32768;
    let written = 0;
    let t = this.t;
    // Interpolating between src[i] and src[i + 1] needs i + 1 <= length - 1.
    while (t < length - 1) {
      const i = Math.floor(t);
      const frac = t - i;
      const a = i < 0 ? this.prev : (src[srcOffset + i] as number);
      const b = src[srcOffset + i + 1] as number;
      dst[dstOffset + written++] = (a + (b - a) * frac) * scale;
      t += this.ratio;
    }
    this.t = t - length;
    this.prev = src[srcOffset + length - 1] as number;
    return written;
  }
}
