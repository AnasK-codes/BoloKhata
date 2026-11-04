/**
 * Fixed-capacity single-producer single-consumer ring of float samples. Everything here runs
 * on one thread (the audio worklet), so there is no atomics code: it only needs to wrap
 * around correctly and never allocate after construction.
 */
export class FloatRing {
  private readonly data: Float32Array;
  private readIndex = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get available(): number {
    return this.count;
  }

  get free(): number {
    return this.capacity - this.count;
  }

  /** Copies up to `length` samples in; returns how many fit. The rest are NOT written. */
  write(src: Float32Array, offset: number, length: number): number {
    const n = Math.min(length, this.capacity - this.count);
    let w = this.readIndex + this.count;
    if (w >= this.capacity) w -= this.capacity;
    const first = Math.min(n, this.capacity - w);
    for (let i = 0; i < first; i++) this.data[w + i] = src[offset + i] as number;
    for (let i = first; i < n; i++) this.data[i - first] = src[offset + i] as number;
    this.count += n;
    return n;
  }

  /** Copies up to `length` samples out; returns how many were available. */
  read(dst: Float32Array, offset: number, length: number): number {
    const n = Math.min(length, this.count);
    const first = Math.min(n, this.capacity - this.readIndex);
    for (let i = 0; i < first; i++) dst[offset + i] = this.data[this.readIndex + i] as number;
    for (let i = first; i < n; i++) dst[offset + i] = this.data[i - first] as number;
    this.readIndex += n;
    if (this.readIndex >= this.capacity) this.readIndex -= this.capacity;
    this.count -= n;
    return n;
  }

  /** Instant: drops everything buffered without touching the data. */
  clear(): void {
    this.readIndex = 0;
    this.count = 0;
  }
}
