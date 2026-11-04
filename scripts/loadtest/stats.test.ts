import { describe, expect, it } from 'vitest';
import { percentile, slope, spread } from './stats';

describe('loadtest stats', () => {
  it('computes nearest-rank percentiles and ignores non-finite values', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([3, NaN, 1, Infinity, 2], 100)).toBe(3);
    expect(percentile([], 50)).toBeNull();
  });
  it('fits a slope', () => {
    expect(slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toBeCloseTo(2);
    expect(slope([{ x: 1, y: 5 }])).toBe(0);
    expect(slope([{ x: 1, y: 5 }, { x: 1, y: 9 }])).toBe(0);
  });
  it('summarises', () => {
    expect(spread([10, 20, 30])).toEqual({ n: 3, p50: 20, p95: 30, max: 30 });
  });
});
