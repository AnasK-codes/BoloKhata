import type { Bill } from '@bolbill/shared';
import { formatDate, formatQuantity, rupees } from './format';

/** Receipts deliberately omit customer contact details. */
export function receiptText(bill: Bill, customerName?: string): string {
  return [
    'Bol-Bill', `Bill: ${bill.id}`, formatDate(bill.createdAt),
    ...(customerName ? [`Grahak: ${customerName}`] : []),
    ...(bill.reversedAt !== undefined ? [`REVERSED: ${formatDate(bill.reversedAt)}`, `Wajah: ${bill.reversalReason ?? ''}`] : []),
    ...bill.items.map((item) => `${item.name} — ${formatQuantity(item.quantity)} ${item.unit} × ${rupees(item.unitPrice)} = ${rupees(item.lineTotal)}`),
    `Total: ${rupees(bill.total)}`, `Paid: ${rupees(bill.paid)}`, `Udhaar: ${rupees(bill.udhaar)}`,
    ...(bill.reversedAt !== undefined ? ['Yeh bill reverse ho chuka hai; payment ki demand nahi hai.'] : []),
  ].join('\n');
}
