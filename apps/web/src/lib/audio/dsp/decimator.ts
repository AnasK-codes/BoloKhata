export interface DecimatorOptions {
  /** -6 dB point of the anti-alias filter. Speech has nothing useful above this. */
  cutoffHz?: number;
  /** Sinc zero crossings on each side; more means a steeper filter and more taps. */
  zeroCrossings?: number;
  /** Fractional-position resolution of the filter table. */
  phases?: number;
  /** Largest chunk copied into the working buffer at once. */
  maxBlock?: number;
}

const DEFAULTS = { cutoffHz: 7000, zeroCrossings: 16, phases: 1024, maxBlock: 1024 };

/**
 * Low-pass filters and resamples a mono float stream from the device's native rate (44.1 or
 * 48 kHz, rarely others) down to the output rate, in one step: each output sample is a
 * Blackman-windowed sinc interpolation centred on its exact fractional input position.
 * Filtering and decimating together keeps the cost at one dot product per OUTPUT sample, and
 * handles non-integer ratios (44.1 kHz to 16 kHz) without a separate stage.
 *
 * Streaming: state carries across `process` calls, so chunk boundaries do not matter.
 * Allocation-free after construction (the filter table and working buffer are fixed).
 */
export class Decimator {
  /** Input samples per output sample. */
  readonly ratio: number;
  private readonly halfWidth: number;
  private readonly taps: number;
  private readonly phases: number;
  private readonly maxBlock: number;
  private readonly table: Float32Array;
  private readonly buf: Float32Array;
  private filled = 0;
  private pos = 0;

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
    options: DecimatorOptions = {},
  ) {
    const o = { ...DEFAULTS, ...options };
    this.ratio = inputRate / outputRate;
    this.phases = o.phases;
    this.maxBlock = o.maxBlock;

    // Cutoff in cycles per input sample; never above 90% of the output Nyquist.
    const cutoff = Math.min(o.cutoffHz, 0.45 * outputRate) / inputRate;
    this.halfWidth = Math.max(2, Math.ceil(o.zeroCrossings / (2 * cutoff)));
    this.taps = 2 * this.halfWidth;
    this.table = buildKernelTable(cutoff, this.halfWidth, this.phases);
    this.buf = new Float32Array(this.taps + this.maxBlock);
    this.reset();
  }

  /** Output capacity a caller must provide for `inputLength` input samples. */
  maxOutputFor(inputLength: number): number {
    return Math.ceil(inputLength / this.ratio) + 2;
  }

  /** Forget history: the stream starts again from silence. */
  reset(): void {
    this.buf.fill(0);
    // Pretend `halfWidth` zero samples came before the stream, so the first output (input
    // sample 0) has a full window around it.
    this.filled = this.halfWidth;
    this.pos = this.halfWidth;
  }

  /** Returns the number of samples written to `out` starting at `outOffset`. */
  process(
    input: Float32Array,
    inOffset: number,
    length: number,
    out: Float32Array,
    outOffset: number,
  ): number {
    const { buf, table, taps, halfWidth, phases, ratio } = this;
    let produced = 0;
    let consumed = 0;
    while (consumed < length) {
      const n = Math.min(length - consumed, this.maxBlock);
      const src = inOffset + consumed;
      for (let i = 0; i < n; i++) buf[this.filled + i] = input[src + i] as number;
      this.filled += n;
      consumed += n;

      for (;;) {
        let i0 = Math.floor(this.pos);
        let phase = Math.round((this.pos - i0) * phases);
        if (phase === phases) {
          phase = 0;
          i0++;
        }
        if (i0 + halfWidth > this.filled - 1) break; // the window needs samples not yet arrived
        const start = i0 - halfWidth + 1;
        const row = phase * taps;
        let sum = 0;
        for (let t = 0; t < taps; t++) sum += (buf[start + t] as number) * (table[row + t] as number);
        out[outOffset + produced++] = sum;
        this.pos += ratio;
      }

      // Keep only what the next output still needs.
      const shift = Math.floor(this.pos) - halfWidth + 1;
      if (shift > 0) {
        buf.copyWithin(0, shift, this.filled);
        this.filled -= shift;
        this.pos -= shift;
      }
    }
    return produced;
  }
}

/**
 * Row `p` holds the weights for an output centred `p / phases` of a sample after an input
 * sample: h(j - p/phases) for j in [1 - halfWidth, halfWidth]. Each row is normalised to sum
 * to 1 so a constant (DC) signal passes at exactly unit gain whatever the fractional offset.
 */
function buildKernelTable(cutoff: number, halfWidth: number, phases: number): Float32Array {
  const taps = 2 * halfWidth;
  const table = new Float32Array(phases * taps);
  for (let p = 0; p < phases; p++) {
    let sum = 0;
    const row = p * taps;
    for (let t = 0; t < taps; t++) {
      const x = 1 - halfWidth + t - p / phases;
      const y = 2 * cutoff * x;
      const sinc = y === 0 ? 1 : Math.sin(Math.PI * y) / (Math.PI * y);
      const u = x / halfWidth;
      const window =
        Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
      const w = sinc * window;
      table[row + t] = w;
      sum += w;
    }
    for (let t = 0; t < taps; t++) table[row + t] = (table[row + t] as number) / sum;
  }
  return table;
}
