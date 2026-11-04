import {
  LIMITS,
  applyBill,
  applyPayment,
  getBalance,
  normalize,
  statement,
  type Bill,
  type BillItem,
  type Customer,
  type LedgerEntry,
  type Product,
  type StatementRow,
} from '@bolbill/shared';
import type { BolDb } from './schema';

export interface SaveBillInput {
  /** The draft's id: saving the same draft twice stores it once. */
  draftId: string;
  customerId?: string;
  /** Used when there is no id: finds the customer by name or creates one, in the same transaction. */
  customerName?: string;
  items: BillItem[];
  total: number;
  paid: number;
  udhaar: number;
}

export interface SaveBillResult {
  /** False when this draft had already been saved (nothing was written). */
  created: boolean;
  bill: Bill;
  customer?: Customer;
}

export type PaymentOutcome =
  | { ok: true; created: boolean; entry: LedgerEntry; balanceAfter: number; warnings: string[] }
  | { ok: false; error: string };

export interface CustomerBalance {
  customer: Customer;
  balance: number;
}

type Clock = () => number;
type NewId = () => string;

const defaultId: NewId = () => globalThis.crypto.randomUUID();

/** Everything the screens and the voice flow do with stored data. Pure rules come from `@bolbill/shared`. */
export function createRepo(db: BolDb, clock: Clock = Date.now, newId: NewId = defaultId) {
  const customerKeys = (c: Pick<Customer, 'name' | 'aliases'>) => [c.name, ...c.aliases].map((n) => normalize(n));

  async function findCustomerByName(name: string): Promise<Customer | undefined> {
    const key = normalize(name);
    if (key === '') return undefined;
    return (await db.customers.toArray()).find((c) => customerKeys(c).includes(key));
  }

  async function findOrCreateInTx(name: string): Promise<Customer> {
    const found = await findCustomerByName(name);
    if (found) return found;
    const customer: Customer = { id: newId(), name: name.trim().slice(0, LIMITS.maxNameLength), aliases: [], createdAt: clock() };
    await db.customers.add(customer);
    return customer;
  }

  return {
    // ---- products -------------------------------------------------------------------------
    listProducts: () => db.products.orderBy('name').toArray(),
    async upsertProduct(product: Omit<Product, 'id'> & { id?: string }): Promise<Product> {
      const saved: Product = { ...product, id: product.id ?? newId() };
      await db.products.put(saved);
      return saved;
    },
    deleteProduct: (id: string) => db.products.delete(id),

    // ---- customers ------------------------------------------------------------------------
    listCustomers: () => db.customers.orderBy('name').toArray(),
    findCustomerByName,
    findOrCreateCustomer(name: string): Promise<Customer> {
      return db.transaction('rw', db.customers, () => findOrCreateInTx(name));
    },

    // ---- bills and ledger -----------------------------------------------------------------
    /**
     * Writes the bill and its udhaar entry in ONE transaction: both or neither. Idempotent by
     * draft id, so a tap and a spoken "haan" for the same bill cannot save it twice.
     */
    saveBillWithLedger(input: SaveBillInput): Promise<SaveBillResult> {
      return db.transaction('rw', [db.bills, db.customers, db.ledgerEntries], async () => {
        const existing = await db.bills.get(input.draftId);
        if (existing) return { created: false, bill: existing };

        let customer: Customer | undefined;
        if (input.customerId) customer = await db.customers.get(input.customerId);
        if (!customer && input.customerName) customer = await findOrCreateInTx(input.customerName);

        const bill: Bill = {
          id: input.draftId,
          ...(customer ? { customerId: customer.id } : {}),
          items: input.items,
          total: input.total,
          paid: input.paid,
          udhaar: input.udhaar,
          createdAt: clock(),
        };
        await db.bills.add(bill);
        await db.ledgerEntries.bulkAdd(applyBill(bill, `udhaar:${bill.id}`));
        return { created: true, bill, ...(customer ? { customer } : {}) };
      });
    },

    /** Records money received. Idempotent when `draftId` is given. */
    addPayment(customerId: string, amount: number, options: { draftId?: string; note?: string } = {}): Promise<PaymentOutcome> {
      return db.transaction('rw', [db.customers, db.ledgerEntries], async () => {
        const entryId = options.draftId ? `payment:${options.draftId}` : newId();
        const customerEntries = await db.ledgerEntries.where('customerId').equals(customerId).toArray();
        const existing = customerEntries.find((e) => e.id === entryId);
        if (existing) {
          return { ok: true, created: false, entry: existing, balanceAfter: getBalance(customerId, customerEntries), warnings: [] } as const;
        }
        if (!(await db.customers.get(customerId))) return { ok: false, error: 'Customer not found.' } as const;
        const result = applyPayment(customerId, amount, customerEntries, {
          id: entryId,
          createdAt: clock(),
          ...(options.note ? { note: options.note } : {}),
        });
        if (!result.ok) return result;
        await db.ledgerEntries.add(result.entry);
        return { ok: true, created: true, entry: result.entry, balanceAfter: result.balanceAfter, warnings: result.warnings } as const;
      });
    },

    async getCustomerStatement(customerId: string): Promise<StatementRow[]> {
      return statement(customerId, await db.ledgerEntries.where('customerId').equals(customerId).toArray());
    },

    async getBalances(): Promise<Map<string, number>> {
      const balances = new Map<string, number>();
      await db.ledgerEntries.each((e) => {
        balances.set(e.customerId, (balances.get(e.customerId) ?? 0) + (e.type === 'udhaar' ? e.amount : -e.amount));
      });
      return balances;
    },

    async listCustomersWithBalance(): Promise<CustomerBalance[]> {
      const [customers, entries] = await Promise.all([db.customers.toArray(), db.ledgerEntries.toArray()]);
      return customers.map((customer) => ({ customer, balance: getBalance(customer.id, entries) }));
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
