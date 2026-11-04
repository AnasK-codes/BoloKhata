import { describe, expect, it } from 'vitest';
import { FloatRing } from './ringBuffer';

const range = (from: number, count: number) => Float32Array.from({ length: count }, (_, i) => from + i);

describe('FloatRing', () => {
  it('returns what was written, in order', () => {
    const ring = new FloatRing(8);
    expect(ring.write(range(1, 5), 0, 5)).toBe(5);
    const out = new Float32Array(5);
    expect(ring.read(out, 0, 5)).toBe(5);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
    expect(ring.available).toBe(0);
  });

  it('wraps around the end of the storage', () => {
    const ring = new FloatRing(8);
    const scratch = new Float32Array(8);
    ring.write(range(1, 6), 0, 6);
    ring.read(scratch, 0, 5); // read index is now 5
    expect(ring.write(range(10, 6), 0, 6)).toBe(6); // wraps: 3 at the end, 3 at the start
    const out = new Float32Array(7);
    expect(ring.read(out, 0, 7)).toBe(7);
    expect(Array.from(out)).toEqual([6, 10, 11, 12, 13, 14, 15]);
  });

  it('accepts only what fits and says so', () => {
    const ring = new FloatRing(4);
    expect(ring.write(range(1, 6), 0, 6)).toBe(4);
    expect(ring.free).toBe(0);
    const out = new Float32Array(6);
    expect(ring.read(out, 0, 6)).toBe(4);
    expect(Array.from(out.slice(0, 4))).toEqual([1, 2, 3, 4]);
  });

  it('honours source and destination offsets', () => {
    const ring = new FloatRing(8);
    ring.write(range(0, 8), 2, 3);
    const out = new Float32Array(6);
    ring.read(out, 1, 3);
    expect(Array.from(out)).toEqual([0, 2, 3, 4, 0, 0]);
  });

  it('flushes instantly and keeps working afterwards', () => {
    const ring = new FloatRing(4);
    ring.write(range(1, 4), 0, 4);
    ring.clear();
    expect(ring.available).toBe(0);
    expect(ring.free).toBe(4);
    ring.write(range(9, 2), 0, 2);
    const out = new Float32Array(2);
    ring.read(out, 0, 2);
    expect(Array.from(out)).toEqual([9, 10]);
  });
});
