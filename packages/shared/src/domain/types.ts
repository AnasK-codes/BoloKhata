/** Local data model (README section 10). Money is integer rupees; times are epoch milliseconds. */
import type { CatalogProduct } from '../protocol/client';
import type { BillItem } from '../protocol/server';

export type { BillItem };
export type Product = CatalogProduct;

export interface Customer {
  id: string;
  name: string;
  aliases: string[];
  createdAt: number;
}

/** A saved bill. */
export interface Bill {
  id: string;
  customerId?: string;
  items: BillItem[];
  total: number;
  paid: number;
  udhaar: number;
  createdAt: number;
}

/** A bill before it is saved: no id or timestamp yet (those come from the caller, keeping this pure). */
export interface DraftBill {
  items: BillItem[];
  total: number;
  paid: number;
  udhaar: number;
}

export type LedgerEntryType = 'udhaar' | 'payment';

export interface LedgerEntry {
  id: string;
  customerId: string;
  type: LedgerEntryType;
  amount: number;
  billId?: string;
  note?: string;
  createdAt: number;
}
