import type { Bill, Customer, LedgerEntry, Product } from '@bolbill/shared';

/** Everything the shop has on this device, as read from IndexedDB. */
export interface ShopData {
  products: Product[];
  customers: Customer[];
  bills: Bill[];
  ledgerEntries: LedgerEntry[];
}

type Cell = string | number | undefined;

/**
 * A spreadsheet opens a cell starting with = + - @ as a formula. Names and notes are user text,
 * so those are prefixed with a quote; numbers are written as they are.
 */
function escapeCell(cell: Cell): string {
  if (cell === undefined) return '';
  const text = typeof cell === 'number' ? String(cell) : /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const nameOf = (customers: readonly Customer[]): Map<string, string> => new Map(customers.map((c) => [c.id, c.name]));

export function billsCsv(data: ShopData): string {
  const names = nameOf(data.customers);
  return toCsv(
    ['bill_id', 'date', 'customer', 'items', 'total', 'paid', 'udhaar', 'discount_rupees', 'discount_percent', 'gst_percent', 'round_off', 'reversed'],
    [...data.bills]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((b) => [
        b.id,
        day(b.createdAt),
        names.get(b.customerId ?? '') ?? 'Cash',
        b.items.map((i) => `${i.name} ${i.quantity} ${i.unit}`).join('; '),
        b.total,
        b.paid,
        b.udhaar,
        b.adjust?.discountAmount,
        b.adjust?.discountPercent,
        b.adjust?.gstPercent,
        b.adjust?.roundOff ? 'yes' : undefined,
        b.reversedAt === undefined ? undefined : day(b.reversedAt),
      ]),
  );
}

export function ledgerCsv(data: ShopData): string {
  const names = nameOf(data.customers);
  return toCsv(
    ['date', 'customer', 'type', 'amount', 'bill_id', 'note', 'reverses_entry'],
    [...data.ledgerEntries]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => [day(e.createdAt), names.get(e.customerId) ?? e.customerId, e.type, e.amount, e.billId, e.note, e.reversesEntryId]),
  );
}

export function backupJson(data: ShopData, now: number): string {
  return JSON.stringify({ app: 'bol-bill', exportedAt: new Date(now).toISOString(), version: 1, ...data }, null, 2);
}

/** Browser only: hands the text to the user as a file. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
