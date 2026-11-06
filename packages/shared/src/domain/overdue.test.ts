import { describe, expect, it } from 'vitest';
import { daysSince, oldestUnpaidSince } from './overdue';
import type { LedgerEntry } from './types';

const DAY = 86_400_000;
const e = (id: string, type: 'udhaar' | 'payment', amount: number, day: number, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, customerId: 'c1', type, amount, createdAt: day * DAY, ...extra,
});

describe('oldestUnpaidSince', () => {
  it('is null when nothing is owed', () => {
    expect(oldestUnpaidSince([])).toBeNull();
    expect(oldestUnpaidSince([e('a', 'udhaar', 100, 1), e('b', 'payment', 100, 2)])).toBeNull();
  });

  it('is the date of the oldest udhaar when nothing was paid', () => {
    expect(oldestUnpaidSince([e('b', 'udhaar', 50, 5), e('a', 'udhaar', 100, 1)])).toBe(1 * DAY);
  });

  it('pays the oldest udhaar first, so a part payment moves the date forward only when a lot is cleared', () => {
    const entries = [e('a', 'udhaar', 100, 1), e('b', 'udhaar', 50, 5), e('p', 'payment', 60, 6)];
    expect(oldestUnpaidSince(entries)).toBe(1 * DAY); // 40 of the first lot is still open
    expect(oldestUnpaidSince([...entries, e('p2', 'payment', 40, 7)])).toBe(5 * DAY);
  });

  it('ignores an overpayment and a customer with only advance', () => {
    expect(oldestUnpaidSince([e('a', 'udhaar', 100, 1), e('p', 'payment', 500, 2)])).toBeNull();
    expect(oldestUnpaidSince([e('p', 'payment', 500, 2)])).toBeNull();
  });

  it('removes a reversed udhaar entry instead of paying the oldest one', () => {
    const entries = [e('a', 'udhaar', 100, 1), e('b', 'udhaar', 50, 5), e('r', 'payment', 100, 6, { reversesEntryId: 'a' })];
    expect(oldestUnpaidSince(entries)).toBe(5 * DAY);
  });

  it('counts a reversed payment as a new debt from the day it was reversed', () => {
    const entries = [e('a', 'udhaar', 100, 1), e('p', 'payment', 100, 2), e('r', 'udhaar', 100, 9, { reversesEntryId: 'p' })];
    expect(oldestUnpaidSince(entries)).toBe(9 * DAY);
  });

  it('does not depend on the order entries are listed', () => {
    const entries = [e('p', 'payment', 100, 2), e('b', 'udhaar', 50, 5), e('a', 'udhaar', 100, 1)];
    expect(oldestUnpaidSince(entries)).toBe(5 * DAY);
  });
});

describe('daysSince', () => {
  it('counts whole days and never goes negative', () => {
    expect(daysSince(1 * DAY, 4 * DAY + 5)).toBe(3);
    expect(daysSince(5 * DAY, 4 * DAY)).toBe(0);
  });
});
