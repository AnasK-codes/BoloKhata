import { describe, expect, it } from 'vitest';
import { computeTotals, isEmptyAdjust } from './adjustments';

describe('computeTotals', () => {
  it('is the subtotal when nothing is adjusted', () => {
    expect(computeTotals(342)).toEqual({ subtotal: 342, discount: 0, gst: 0, roundOff: 0, total: 342 });
  });

  it('subtracts a rupee discount', () => {
    expect(computeTotals(342, { discountAmount: 42 }).total).toBe(300);
  });

  it('never discounts below zero', () => {
    expect(computeTotals(100, { discountAmount: 500 })).toMatchObject({ discount: 100, total: 0 });
  });

  it('takes a percent discount half up', () => {
    expect(computeTotals(250, { discountPercent: 10 }).discount).toBe(25);
    expect(computeTotals(105, { discountPercent: 10 }).discount).toBe(11); // 10.5 -> 11
  });

  it('lets an amount win over a percent', () => {
    expect(computeTotals(200, { discountAmount: 5, discountPercent: 50 }).discount).toBe(5);
  });

  it('charges GST on the discounted amount', () => {
    expect(computeTotals(200, { discountAmount: 100, gstPercent: 18 })).toMatchObject({ gst: 18, total: 118 });
  });

  it('rounds GST half up', () => {
    expect(computeTotals(150, { gstPercent: 5 }).gst).toBe(8); // 7.5 -> 8
  });

  it('rounds the payable total to the nearest 5, up or down', () => {
    expect(computeTotals(343, { roundOff: true })).toMatchObject({ roundOff: 2, total: 345 });
    expect(computeTotals(342, { roundOff: true })).toMatchObject({ roundOff: -2, total: 340 });
    expect(computeTotals(341, { roundOff: true })).toMatchObject({ roundOff: -1, total: 340 });
    expect(computeTotals(345, { roundOff: true })).toMatchObject({ roundOff: 0, total: 345 });
  });

  it('applies discount, then GST, then round-off', () => {
    // 1000 - 100 = 900; GST 5% = 45 -> 945; already a multiple of 5.
    expect(computeTotals(1000, { discountAmount: 100, gstPercent: 5, roundOff: true }).total).toBe(945);
    // 333 - 33 = 300; GST 12% = 36 -> 336; round-off -1 -> 335.
    expect(computeTotals(333, { discountAmount: 33, gstPercent: 12, roundOff: true })).toMatchObject({ gst: 36, roundOff: -1, total: 335 });
  });
});

describe('isEmptyAdjust', () => {
  it('is true for nothing and for all-empty values', () => {
    expect(isEmptyAdjust(undefined)).toBe(true);
    expect(isEmptyAdjust({ roundOff: false })).toBe(true);
    expect(isEmptyAdjust({ gstPercent: 5 })).toBe(false);
  });
});
