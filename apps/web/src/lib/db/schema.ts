import Dexie, { type EntityTable } from 'dexie';
import type { Bill, Customer, LedgerEntry, Product } from '@bolbill/shared';

export interface MetaRow {
  key: string;
  value: string | number | boolean;
}

/**
 * The shop's data, on the device. Balances are never stored: they are derived from
 * `ledgerEntries` (README section 10).
 */
export class BolDb extends Dexie {
  products!: EntityTable<Product, 'id'>;
  customers!: EntityTable<Customer, 'id'>;
  bills!: EntityTable<Bill, 'id'>;
  ledgerEntries!: EntityTable<LedgerEntry, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'bolbill') {
    super(name);
    this.version(1).stores({
      products: 'id, name',
      customers: 'id, name',
      bills: 'id, customerId, createdAt',
      ledgerEntries: 'id, customerId, billId, createdAt',
      meta: 'key',
    });
  }
}

let shared: BolDb | null = null;

/** The app's database. Browser only: IndexedDB does not exist while Next renders on the server. */
export function getDb(): BolDb {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available here (server rendering or a blocked browser).');
  }
  shared ??= new BolDb();
  return shared;
}
