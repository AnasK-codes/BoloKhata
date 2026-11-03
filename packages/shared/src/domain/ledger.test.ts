import { describe, expect, it } from 'vitest';
import { applyBill, applyPayment, getBalance, statement } from './ledger';
import type { Bill, LedgerEntry } from './types';

const entry = (
  id: string,
  customerId: string,
  type: LedgerEntry['type'],
  amount: number,
  createdAt: number,
): LedgerEntry => ({ id, customerId, type, amount, createdAt });

const bill = (overrides: Partial<Bill> = {}): Bill => ({
  id: 'b1',
  customerId: 'c1',
  items: [],
  total: 300,
  paid: 100,
  udhaar: 200,
  createdAt: 1000,
  ...overrides,
});

describe('getBalance', () => {
  it('is zero with no entries', () => {
    expect(getBalance('c1', [])).toBe(0);
  });
  it('is udhaar minus payments', () => {
    const entries = [entry('1', 'c1', 'udhaar', 500, 1), entry('2', 'c1', 'payment', 200, 2), entry('3', 'c1', 'udhaar', 50, 3)];
    expect(getBalance('c1', entries)).toBe(350);
  });
  it('ignores other customers', () => {
    const entries = [entry('1', 'c1', 'udhaar', 500, 1), entry('2', 'c2', 'udhaar', 999, 2)];
    expect(getBalance('c1', entries)).toBe(500);
    expect(getBalance('c2', entries)).toBe(999);
    expect(getBalance('c3', entries)).toBe(0);
  });
  it('can be negative after an overpayment', () => {
    expect(getBalance('c1', [entry('1', 'c1', 'udhaar', 100, 1), entry('2', 'c1', 'payment', 150, 2)])).toBe(-50);
  });
  it('is exact for large amounts', () => {
    expect(getBalance('c1', [entry('1', 'c1', 'udhaar', 99_999_999, 1), entry('2', 'c1', 'payment', 1, 2)])).toBe(99_999_998);
  });
  it('does not depend on entry order', () => {
    const a = entry('1', 'c1', 'udhaar', 70, 1);
    const b = entry('2', 'c1', 'payment', 20, 2);
    expect(getBalance('c1', [a, b])).toBe(getBalance('c1', [b, a]));
  });
});

describe('applyBill', () => {
  it('creates one udhaar entry for the credit part', () => {
    expect(applyBill(bill(), 'e1')).toEqual([
      { id: 'e1', customerId: 'c1', type: 'udhaar', amount: 200, billId: 'b1', createdAt: 1000 },
    ]);
  });
  it('creates nothing for a fully paid bill', () => {
    expect(applyBill(bill({ paid: 300, udhaar: 0 }), 'e1')).toEqual([]);
  });
  it('creates nothing without a customer', () => {
    const { customerId: _omit, ...rest } = bill();
    expect(applyBill(rest, 'e1')).toEqual([]);
  });
  it('raises the derived balance by exactly the udhaar', () => {
    const entries = applyBill(bill(), 'e1');
    expect(getBalance('c1', entries)).toBe(200);
  });
});

describe('applyPayment', () => {
  const meta = { id: 'p1', createdAt: 2000 };
  const owed = [entry('1', 'c1', 'udhaar', 300, 1)];

  it('records a payment and reports the balance after', () => {
    const r = applyPayment('c1', 200, owed, meta);
    expect(r).toMatchObject({ ok: true, balanceAfter: 100, warnings: [] });
    if (r.ok) expect(r.entry).toEqual({ id: 'p1', customerId: 'c1', type: 'payment', amount: 200, createdAt: 2000 });
  });
  it('keeps an optional note', () => {
    const r = applyPayment('c1', 10, owed, { ...meta, note: 'cash' });
    if (r.ok) expect(r.entry.note).toBe('cash');
  });
  it('allows paying exactly what is owed', () => {
    expect(applyPayment('c1', 300, owed, meta)).toMatchObject({ ok: true, balanceAfter: 0, warnings: [] });
  });
  it('allows overpayment with a warning', () => {
    const r = applyPayment('c1', 500, owed, meta);
    expect(r).toMatchObject({ ok: true, balanceAfter: -200 });
    if (r.ok) expect(r.warnings).toHaveLength(1);
  });
  it('warns on any payment when nothing is owed', () => {
    const r = applyPayment('c1', 50, [], meta);
    expect(r).toMatchObject({ ok: true, balanceAfter: -50 });
  });
  it.each([0, -10, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects amount %s', (amount) => {
    expect(applyPayment('c1', amount, owed, meta).ok).toBe(false);
  });
  it('rejects a missing customer', () => {
    expect(applyPayment('', 10, owed, meta).ok).toBe(false);
  });
});

describe('statement', () => {
  it('sorts by date and carries a running balance', () => {
    const entries = [
      entry('3', 'c1', 'udhaar', 50, 30),
      entry('1', 'c1', 'udhaar', 300, 10),
      entry('2', 'c1', 'payment', 120, 20),
      entry('x', 'c2', 'udhaar', 999, 15),
    ];
    const rows = statement('c1', entries);
    expect(rows.map((r) => r.entry.id)).toEqual(['1', '2', '3']);
    expect(rows.map((r) => r.balance)).toEqual([300, 180, 230]);
  });
  it('keeps input order for equal times', () => {
    const rows = statement('c1', [entry('a', 'c1', 'udhaar', 10, 5), entry('b', 'c1', 'payment', 4, 5)]);
    expect(rows.map((r) => r.entry.id)).toEqual(['a', 'b']);
    expect(rows.map((r) => r.balance)).toEqual([10, 6]);
  });
  it('is empty for an unknown customer', () => {
    expect(statement('nobody', [entry('1', 'c1', 'udhaar', 10, 1)])).toEqual([]);
  });
  it('ends at the same figure as getBalance', () => {
    const entries = [entry('1', 'c1', 'udhaar', 300, 1), entry('2', 'c1', 'payment', 400, 2)];
    const rows = statement('c1', entries);
    expect(rows.at(-1)?.balance).toBe(getBalance('c1', entries));
    expect(rows.at(-1)?.balance).toBe(-100);
  });
  it('does not change the input array', () => {
    const entries = [entry('2', 'c1', 'udhaar', 1, 2), entry('1', 'c1', 'udhaar', 1, 1)];
    statement('c1', entries);
    expect(entries.map((e) => e.id)).toEqual(['2', '1']);
  });
});
