import { computeTotals, paymentStatus, type Bill, type BillItem } from '@bolbill/shared';
import { formatQuantity } from './format';

/** Characters per line on a 58 mm thermal roll in the printer's normal font. */
export const THERMAL_COLUMNS = 32;

const rs = (n: number): string => `${n < 0 ? '-' : ''}Rs${Math.abs(n).toLocaleString('en-IN')}`;
const UNIT_LABEL: Record<BillItem['unit'], string> = { kg: 'kg', g: 'g', l: 'ltr', ml: 'ml', piece: 'pc', packet: 'pkt', dozen: 'doz' };

/** Breaks text on spaces so no line passes `width`; a single word longer than `width` is cut. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (word === '') continue;
    const candidate = line === '' ? word : `${line} ${word}`;
    if (candidate.length <= width) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    let rest = word;
    while (rest.length > width) {
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    line = rest;
  }
  if (line !== '') lines.push(line);
  return lines;
}

const center = (text: string, width: number): string =>
  wrapText(text, width)
    .map((l) => ' '.repeat(Math.floor((width - l.length) / 2)) + l)
    .join('\n');

/** `left` at the start, `right` at the end of one line. If they do not fit, the left side wraps first. */
function pair(left: string, right: string, width: number): string[] {
  if (left.length + right.length + 1 <= width) return [left + ' '.repeat(width - left.length - right.length) + right];
  const wrapped = wrapText(left, width - right.length - 1);
  const last = wrapped.pop() ?? '';
  return [...wrapped, last + ' '.repeat(Math.max(1, width - last.length - right.length)) + right];
}

function dateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function itemLines(item: BillItem, width: number): string[] {
  const qty = `${formatQuantity(item.quantity)} ${UNIT_LABEL[item.unit]}`;
  const detail = item.spokenPrice
    ? `${qty} (bola ${rs(item.spokenPrice.amount)}${item.spokenPrice.basis === 'line' ? '' : '/' + UNIT_LABEL[item.spokenPrice.unit]})`
    : item.unitPrice !== null
      ? `${qty} x ${rs(item.unitPrice)}`
      : qty;
  return [...wrapText(item.name, width), ...pair(`  ${detail}`, rs(item.lineTotal), width)];
}

/**
 * The receipt as plain monospace lines for a 58 mm thermal printer. ASCII-friendly on purpose:
 * thermal fonts often lack the rupee sign, so amounts print as "Rs". Customer contact details are
 * never printed. Pure: everything comes from the saved bill.
 */
export function thermalReceipt(bill: Bill, customerName?: string, width = THERMAL_COLUMNS): string {
  const rule = '-'.repeat(width);
  const heavy = '='.repeat(width);
  const out: string[] = [];

  if (bill.business) {
    out.push(center(bill.business.businessName.toUpperCase(), width), center(bill.business.address, width), center(`Mob: ${bill.business.mobile}`, width));
  } else {
    out.push(center('BOL-BILL', width));
  }
  out.push(rule, ...pair(`Bill: ${bill.id.slice(0, 8)}`, dateTime(bill.createdAt), width));
  if (customerName) out.push(...wrapText(`Grahak: ${customerName}`, width));
  if (bill.reversedAt !== undefined) out.push(center('** REVERSED **', width), ...wrapText(`Wajah: ${bill.reversalReason ?? ''}`, width));
  out.push(rule);

  for (const item of bill.items) out.push(...itemLines(item, width));
  out.push(rule);

  const totals = computeTotals(
    bill.items.reduce((sum, i) => sum + i.lineTotal, 0),
    bill.adjust,
  );
  if (bill.adjust) {
    out.push(...pair('Subtotal', rs(totals.subtotal), width));
    if (totals.discount > 0) out.push(...pair('Chhoot', `-${rs(totals.discount)}`, width));
    if (totals.gst > 0) out.push(...pair(`GST ${bill.adjust.gstPercent}%`, `+${rs(totals.gst)}`, width));
    if (totals.roundOff !== 0) out.push(...pair('Round-off', `${totals.roundOff > 0 ? '+' : '-'}${rs(Math.abs(totals.roundOff))}`, width));
  }
  out.push(heavy, ...pair('TOTAL', rs(bill.total), width), heavy);
  out.push(...pair('Paid', rs(bill.paid), width));
  if (bill.udhaar > 0) out.push(...pair('UDHAAR', rs(bill.udhaar), width));
  if (bill.reversedAt !== undefined) out.push(...wrapText('Yeh bill reverse ho chuka hai.', width));
  else {
    const status = paymentStatus(bill);
    out.push(center(status === 'paid' ? '** PAID **' : status === 'unpaid' ? '** UNPAID - KHATA **' : '** PART PAID **', width));
  }

  if (bill.business?.receiptFooter) out.push(rule, center(bill.business.receiptFooter, width));
  return out.join('\n');
}
