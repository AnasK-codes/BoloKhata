import { describe, expect, it } from 'vitest';
import { floatToInt16, int16ToFloat } from './int16';

describe('floatToInt16', () => {
  it('maps full scale to the ends of the range', () => {
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(0)).toBe(0);
  });

  it('clips instead of wrapping', () => {
    expect(floatToInt16(1.7)).toBe(32767);
    expect(floatToInt16(-3)).toBe(-32768);
    expect(floatToInt16(Infinity)).toBe(32767);
    expect(floatToInt16(-Infinity)).toBe(-32768);
  });

  it('rounds to the nearest step', () => {
    expect(floatToInt16(0.5)).toBe(16384);
    expect(floatToInt16(-0.5)).toBe(-16384);
  });

  it('round-trips within one step', () => {
    for (const x of [0.1, -0.25, 0.9999, -0.7]) {
      expect(Math.abs(int16ToFloat(floatToInt16(x)) - x)).toBeLessThan(1 / 16384);
    }
  });
});
