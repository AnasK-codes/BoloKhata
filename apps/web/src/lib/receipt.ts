import { computeTotals, type Bill } from '@bolbill/shared';
import { formatDate, formatQuantity, rupees } from './format';

/** Receipts deliberately omit customer contact details. */
export function receiptText(bill: Bill, customerName?: string): string {
  return [
    ...(bill.business ? [bill.business.businessName, bill.business.address, `Mobile: ${bill.business.mobile}`] : ['Bol-Bill']),
    `Bill: ${bill.id}`, formatDate(bill.createdAt),
    ...(customerName ? [`Grahak: ${customerName}`] : []),
    ...(bill.reversedAt !== undefined ? [`REVERSED: ${formatDate(bill.reversedAt)}`, `Wajah: ${bill.reversalReason ?? ''}`] : []),
    ...bill.items.map((item) => item.spokenPrice
      ? `${item.name} — ${formatQuantity(item.quantity)} ${item.unit} = ${rupees(item.lineTotal)} (bola: ${rupees(item.spokenPrice.amount)} / ${formatQuantity(item.spokenPrice.quantity)} ${item.spokenPrice.unit}${item.spokenPrice.basis === 'line' ? ' total' : ' rate'})`
      : `${item.name} — ${formatQuantity(item.quantity)} ${item.unit} × ${rupees(item.unitPrice ?? 0)} = ${rupees(item.lineTotal)}`),
    ...(bill.adjust ? adjustmentLines(bill) : []),
    `Total: ${rupees(bill.total)}`, `Paid: ${rupees(bill.paid)}`, `Udhaar: ${rupees(bill.udhaar)}`,
    ...(bill.reversedAt !== undefined ? ['Yeh bill reverse ho chuka hai; payment ki demand nahi hai.'] : []),
    ...(bill.business?.receiptFooter ? [bill.business.receiptFooter] : []),
  ].join('\n');
}

function adjustmentLines(bill: Bill): string[] {
  const t = computeTotals(bill.items.reduce((sum, i) => sum + i.lineTotal, 0), bill.adjust);
  return [
    `Subtotal: ${rupees(t.subtotal)}`,
    ...(t.discount > 0 ? [`Chhoot: -${rupees(t.discount)}`] : []),
    ...(t.gst > 0 ? [`GST ${bill.adjust?.gstPercent ?? 0}%: +${rupees(t.gst)}`] : []),
    ...(t.roundOff !== 0 ? [`Round-off: ${t.roundOff > 0 ? '+' : '-'}${rupees(Math.abs(t.roundOff))}`] : []),
  ];
}
