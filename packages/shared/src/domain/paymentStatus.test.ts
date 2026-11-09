import { describe, expect, it } from 'vitest';
import { paymentStatus } from './paymentStatus';

describe('paymentStatus', () => {
  it('is PAID when nothing is owed', () => {
    expect(paymentStatus({ total: 90, paid: 90, udhaar: 0 })).toBe('paid');
    expect(paymentStatus({ total: 0, paid: 0, udhaar: 0 })).toBe('paid');
  });
  it('is UNPAID when the whole bill went on khata', () => {
    expect(paymentStatus({ total: 90, paid: 0, udhaar: 90 })).toBe('unpaid');
  });
  it('is PARTIAL when some was paid and the rest is udhaar', () => {
    expect(paymentStatus({ total: 90, paid: 50, udhaar: 40 })).toBe('partial');
  });
});
