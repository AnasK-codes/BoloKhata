import { describe, expect, it } from 'vitest';
import { getBalance, reverseEntry } from './ledger';
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

describe('oldestUnpaidSince with random ledgers (property)', () => {
  function prng(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 4_294_967_296);
  }

  it('reversing an udhaar that a payment already settled does not leave a debt behind', () => {
    const entries = [e('a', 'udhaar', 100, 1), e('b', 'udhaar', 100, 2), e('p', 'payment', 100, 3), e('ra', 'payment', 100, 4, { reversesEntryId: 'a' })];
    expect(getBalance('c1', entries)).toBe(0);
    expect(oldestUnpaidSince(entries)).toBeNull();
  });

  it('is null exactly when the balance is not positive, and never later than the newest entry', () => {
    for (let run = 0; run < 500; run++) {
      const rand = prng(run + 1);
      const entries: LedgerEntry[] = [];
      for (let i = 0; i < 12; i++) {
        const pick = rand();
        if (pick < 0.45) entries.push(e(`u${i}`, 'udhaar', 1 + Math.floor(rand() * 500), i));
        else if (pick < 0.8) entries.push(e(`p${i}`, 'payment', 1 + Math.floor(rand() * 500), i));
        else if (entries.length > 0) {
          const target = entries[Math.floor(rand() * entries.length)]!;
          const r = reverseEntry(target, entries, { id: `r${i}`, createdAt: i * DAY });
          if (r.ok) entries.push(r.entry);
        }
      }
      const since = oldestUnpaidSince(entries);
      const balance = getBalance('c1', entries);
      expect(since === null, `run ${run}: balance ${balance}`).toBe(balance <= 0);
      if (since !== null) expect(since).toBeLessThanOrEqual(11 * DAY);
    }
  });
});
