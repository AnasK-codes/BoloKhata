/**
 * Ledger rules. A balance is DERIVED from entries (udhaar minus payments), never stored.
 * Positive = the customer owes the shop. Negative = the shop owes the customer (overpaid).
 * Pure functions: ids and timestamps come from the caller.
 */
import type { Bill, LedgerEntry } from './types';

export function getBalance(customerId: string, entries: readonly LedgerEntry[]): number {
  let balance = 0;
  for (const e of entries) {
    if (e.customerId !== customerId) continue;
    balance += e.type === 'udhaar' ? e.amount : -e.amount;
  }
  return balance;
}

/**
 * Udhaar is a debt owed BY someone: a bill with udhaar and no customer would be stored with no
 * ledger entry, so the debt would silently vanish. Callers must not offer to save such a bill.
 */
export function udhaarNeedsCustomer(udhaar: number, hasCustomer: boolean): boolean {
  return udhaar > 0 && !hasCustomer;
}

/** Entries to append when a bill is saved: one udhaar entry if any part is on credit. */
export function applyBill(bill: Bill, entryId: string): LedgerEntry[] {
  if (!bill.customerId || bill.udhaar <= 0) return [];
  return [
    {
      id: entryId,
      customerId: bill.customerId,
      type: 'udhaar',
      amount: bill.udhaar,
      billId: bill.id,
      createdAt: bill.createdAt,
    },
  ];
}

export interface PaymentMeta {
  id: string;
  createdAt: number;
  note?: string;
}

export type PaymentResult =
  | { ok: true; entry: LedgerEntry; warnings: string[]; balanceAfter: number }
  | { ok: false; error: string };

/**
 * A payment entry. Non-positive or non-integer amounts are rejected. Paying more than is
 * owed is allowed (a negative balance means the shop owes the customer) but warns.
 */
export function applyPayment(
  customerId: string,
  amount: number,
  entries: readonly LedgerEntry[],
  meta: PaymentMeta,
): PaymentResult {
  if (!customerId) return { ok: false, error: 'A customer is required.' };
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: 'The payment amount must be a whole number above zero.' };
  }
  const entry: LedgerEntry = {
    id: meta.id,
    customerId,
    type: 'payment',
    amount,
    createdAt: meta.createdAt,
  };
  if (meta.note) entry.note = meta.note;
  const balanceAfter = getBalance(customerId, entries) - amount;
  const warnings = balanceAfter < 0 ? ['This is more than the customer owes; the shop now owes them.'] : [];
  return { ok: true, entry, warnings, balanceAfter };
}

export interface StatementRow {
  entry: LedgerEntry;
  /** Balance after this entry. */
  balance: number;
}

/** One customer's entries, oldest first (stable for equal times), with a running balance. */
export function statement(customerId: string, entries: readonly LedgerEntry[]): StatementRow[] {
  const mine = entries
    .map((entry, order) => ({ entry, order }))
    .filter((x) => x.entry.customerId === customerId)
    .sort((a, b) => a.entry.createdAt - b.entry.createdAt || a.order - b.order);
  let balance = 0;
  return mine.map(({ entry }) => {
    balance += entry.type === 'udhaar' ? entry.amount : -entry.amount;
    return { entry, balance };
  });
}
