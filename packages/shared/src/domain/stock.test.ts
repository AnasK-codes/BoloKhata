import { describe, expect, it } from 'vitest';
import { isLowStock, isOutOfStock, stockAfterLine } from './stock';

describe('stock', () => {
  it('flags low and out of stock only for tracked products', () => {
    expect(isLowStock({})).toBe(false);
    expect(isOutOfStock({})).toBe(false);
    expect(isLowStock({ stock: 5 })).toBe(true);
    expect(isLowStock({ stock: 6 })).toBe(false);
    expect(isLowStock({ stock: 0 })).toBe(false);
    expect(isOutOfStock({ stock: 0 })).toBe(true);
  });

  it('reduces by what was sold and never below zero', () => {
    expect(stockAfterLine({ stock: 10, unit: 'kg' }, { quantity: 2.5, unit: 'kg' }, -1)).toBe(7.5);
    expect(stockAfterLine({ stock: 1, unit: 'kg' }, { quantity: 3, unit: 'kg' }, -1)).toBe(0);
  });

  it('converts units', () => {
    expect(stockAfterLine({ stock: 10, unit: 'kg' }, { quantity: 500, unit: 'g' }, -1)).toBe(9.5);
  });

  it('puts stock back on a reversal', () => {
    expect(stockAfterLine({ stock: 7.5, unit: 'kg' }, { quantity: 2.5, unit: 'kg' }, 1)).toBe(10);
  });

  it('leaves untracked products and unconvertible units alone', () => {
    expect(stockAfterLine({ unit: 'kg' }, { quantity: 1, unit: 'kg' }, -1)).toBeUndefined();
    expect(stockAfterLine({ stock: 4, unit: 'kg' }, { quantity: 1, unit: 'packet' }, -1)).toBeUndefined();
  });
});
