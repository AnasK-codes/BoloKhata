import type { Bill } from './types';

export type PaymentStatus = 'paid' | 'unpaid' | 'partial';

/**
 * Where a saved bill stands. "Khate mein jodo" saves a bill with nothing paid, so it reads UNPAID;
 * some money down and the rest on credit is PARTIAL; no udhaar is PAID. A bill with a zero total
 * (nothing to pay) is PAID. One rule for the screen, the text receipt and the thermal receipt.
 */
export function paymentStatus(bill: Pick<Bill, 'total' | 'paid' | 'udhaar'>): PaymentStatus {
  if (bill.udhaar <= 0) return 'paid';
  return bill.paid <= 0 ? 'unpaid' : 'partial';
}
