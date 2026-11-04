import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('doubles the ceiling each attempt', () => {
    const top = (attempt: number) => backoffDelay(attempt, () => 1);
    expect([0, 1, 2, 3].map(top)).toEqual([500, 1000, 2000, 4000]);
  });

  it('never goes below half the ceiling, so a retry is never instant', () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(3, () => 0)).toBe(2000);
  });

  it('is capped', () => {
    expect(backoffDelay(20, () => 1)).toBe(10_000);
    expect(backoffDelay(1000, () => 1)).toBe(10_000);
  });

  it('spreads clients out between the bounds', () => {
    const delays = [0, 0.25, 0.5, 0.75, 1].map((r) => backoffDelay(2, () => r));
    expect(delays).toEqual([1000, 1250, 1500, 1750, 2000]);
  });
});
