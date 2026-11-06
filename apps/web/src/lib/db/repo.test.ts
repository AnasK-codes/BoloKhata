import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BolDb } from './schema';
import { createRepo, type Repo } from './repo';
import { resetDemoData, seedIfFirstRun } from './seed';
import { buildSnapshot } from './snapshot';
import type { Product } from '@bolbill/shared';

let db: BolDb;
let repo: Repo;
let clock = Date.UTC(2026, 5, 1);
let counter = 0;
let dbName = 0;

beforeEach(async () => {
  db = new BolDb(`test-${++dbName}`);
  clock = Date.UTC(2026, 5, 1);
  counter = 0;
  repo = createRepo(db, () => (clock += 10), () => `id-${++counter}`);
});

const item = { productId: 'p1', name: 'Aata', quantity: 2, unit: 'kg' as const, unitPrice: 45, lineTotal: 90 };
const bill = (draftId: string, extra: Partial<Parameters<Repo['saveBillWithLedger']>[0]> = {}) => ({
  draftId,
  items: [item],
  total: 90,
  paid: 0,
  udhaar: 90,
  ...extra,
});

describe('seeding', () => {
  it('loads the synthetic catalog once and never again', async () => {
    expect(await seedIfFirstRun(db)).toBe(true);
    const products = await db.products.count();
    expect(products).toBeGreaterThan(30);
    expect(await db.customers.count()).toBe(8);
    expect(await seedIfFirstRun(db)).toBe(false);
    expect(await db.products.count()).toBe(products);
  });

  it('does not bring back products the shop deleted', async () => {
    await seedIfFirstRun(db);
    await repo.deleteProduct('p_aata');
    await seedIfFirstRun(db);
    expect(await db.products.get('p_aata')).toBeUndefined();
  });

  it('gives the demo customers their opening udhaar through ledger entries', async () => {
    await seedIfFirstRun(db);
    const balances = await repo.getBalances();
    expect(balances.get('c_ramesh_sharma')).toBe(120);
    expect(balances.get('c_suresh_verma')).toBe(300);
  });

  it('resets to the seed, discarding everything else', async () => {
    await seedIfFirstRun(db);
    await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
    await repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' }));
    await repo.upsertProduct({ name: 'Extra', aliases: [], unit: 'kg', pricePerUnit: 1 });
    await resetDemoData(db);
    expect(await db.bills.count()).toBe(0);
    expect((await repo.getBalances()).get('c_ramesh_sharma')).toBe(120);
    expect((await repo.listProducts()).some((p) => p.name === 'Extra')).toBe(false);
  });
});

describe('products and customers', () => {
  it('adds, edits and deletes products', async () => {
    const p = await repo.upsertProduct({ name: 'Namak', aliases: ['salt'], unit: 'kg', pricePerUnit: 20 });
    expect(p.id).toBe('id-1');
    await repo.upsertProduct({ ...p, pricePerUnit: 22 });
    expect((await repo.listProducts())[0]?.pricePerUnit).toBe(22);
    await repo.deleteProduct(p.id);
    expect(await repo.listProducts()).toEqual([]);
  });

  it('finds a customer by name or alias, ignoring case and honorifics, else creates one', async () => {
    await seedIfFirstRun(db);
    const a = await repo.findOrCreateCustomer('sharma ji');
    expect(a.id).toBe('c_ramesh_sharma');
    const b = await repo.findOrCreateCustomer('Naya Grahak');
    expect(b.name).toBe('Naya Grahak');
    expect((await repo.findOrCreateCustomer('naya grahak')).id).toBe(b.id);
    expect(await db.customers.count()).toBe(9);
  });
});

describe('customers: add, edit, delete', () => {
  it('adds a custom customer with a Devanagari alias, who can then be found by either name', async () => {
    await seedIfFirstRun(db);
    const result = await repo.saveCustomer({ name: 'Mohan Lal', aliases: ['मोहन'] });
    expect(result.ok).toBe(true);
    expect((await repo.findCustomerByName('मोहन'))?.name).toBe('Mohan Lal');
    expect((await repo.findCustomerByName('mohan lal'))?.id).toBe(result.ok ? result.customer.id : '');
  });

  it('edits a customer in place, keeping id and history', async () => {
    await seedIfFirstRun(db);
    const edited = await repo.saveCustomer({ id: 'c_ramesh_sharma', name: 'Ramesh Sharma', aliases: ['Sharma ji', 'शर्मा जी', 'Rameshji'] });
    expect(edited.ok && edited.customer.id).toBe('c_ramesh_sharma');
    expect((await repo.getBalances()).get('c_ramesh_sharma')).toBe(120);
  });

  it('refuses a name or alias that already belongs to someone else', async () => {
    await seedIfFirstRun(db);
    expect((await repo.saveCustomer({ name: 'Sharma ji', aliases: [] })).ok).toBe(false); // an alias of Ramesh Sharma
    expect((await repo.saveCustomer({ name: 'Naya', aliases: ['Verma ji'] })).ok).toBe(false);
    expect((await repo.saveCustomer({ id: 'nobody', name: 'X', aliases: [] })).ok).toBe(false);
    expect(await db.customers.count()).toBe(8);
  });

  it('deletes only a customer with no history', async () => {
    await seedIfFirstRun(db);
    const added = await repo.saveCustomer({ name: 'Mohan Lal', aliases: [] });
    if (!added.ok) throw new Error('setup');
    expect((await repo.deleteCustomer(added.customer.id)).ok).toBe(true);
    expect((await repo.deleteCustomer('c_ramesh_sharma')).ok).toBe(false); // has opening udhaar
    expect(await db.customers.get('c_ramesh_sharma')).toBeDefined();
  });
});

describe('saveBillWithLedger', () => {
  it('stores the bill and its udhaar entry together', async () => {
    await seedIfFirstRun(db);
    await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
    const result = await repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' }));
    expect(result.created).toBe(true);
    expect(await db.bills.get('d1')).toMatchObject({ total: 90, customerId: 'c_ramesh_sharma' });
    expect((await repo.getBalances()).get('c_ramesh_sharma')).toBe(210);
  });

  it('is idempotent by draft id: a second save writes nothing', async () => {
    await seedIfFirstRun(db);
    await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
    await repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' }));
    const again = await repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' }));
    expect(again.created).toBe(false);
    expect(await db.bills.count()).toBe(1);
    expect((await repo.getBalances()).get('c_ramesh_sharma')).toBe(210);
  });

  it('survives two saves of the same draft racing each other', async () => {
    await seedIfFirstRun(db);
    await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
    await Promise.all([
      repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' })),
      repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' })),
    ]);
    expect(await db.bills.count()).toBe(1);
    expect((await repo.getBalances()).get('c_ramesh_sharma')).toBe(210);
  });

  it('writes nothing at all if the ledger write fails (atomic)', async () => {
    await seedIfFirstRun(db);
    await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
    // An existing entry with the id the save will use forces bulkAdd to fail after the bill was added.
    await db.ledgerEntries.add({ id: 'udhaar:d9', customerId: 'c_ramesh_sharma', type: 'udhaar', amount: 1, createdAt: 1 });
    await expect(repo.saveBillWithLedger(bill('d9', { customerId: 'c_ramesh_sharma' }))).rejects.toThrow();
    expect(await db.bills.get('d9')).toBeUndefined();
    expect(await db.ledgerEntries.count()).toBe(3);
  });

  it('creates a new customer by name inside the same transaction', async () => {
    const result = await repo.saveBillWithLedger(bill('d2', { customerName: 'Gupta ji', paid: 90, udhaar: 0 }));
    expect(result.customer?.name).toBe('Gupta ji');
    expect(result.bill.customerId).toBe(result.customer?.id);
    expect((await repo.getBalances()).get(result.customer!.id) ?? 0).toBe(0);
  });

  it('adds no ledger entry for a fully paid or customer-less bill', async () => {
    await repo.saveBillWithLedger(bill('d3', { paid: 90, udhaar: 0, customerName: 'Walk In' }));
    await repo.saveBillWithLedger(bill('d4', { paid: 90, udhaar: 0 }));
    expect(await db.ledgerEntries.count()).toBe(0);
    expect(await db.bills.count()).toBe(2);
  });
});

describe('payments and statements', () => {
  it('records a payment and lowers the derived balance', async () => {
    await seedIfFirstRun(db);
    const result = await repo.addPayment('c_suresh_verma', 100);
    expect(result).toMatchObject({ ok: true, created: true, balanceAfter: 200 });
    expect((await repo.getBalances()).get('c_suresh_verma')).toBe(200);
  });

  it('is idempotent by draft id', async () => {
    await seedIfFirstRun(db);
    await repo.addPayment('c_suresh_verma', 100, { draftId: 'pay1' });
    const again = await repo.addPayment('c_suresh_verma', 100, { draftId: 'pay1' });
    expect(again).toMatchObject({ ok: true, created: false });
    expect((await repo.getBalances()).get('c_suresh_verma')).toBe(200);
  });

  it('rejects bad amounts and unknown customers, writing nothing', async () => {
    await seedIfFirstRun(db);
    expect((await repo.addPayment('c_suresh_verma', 0)).ok).toBe(false);
    expect((await repo.addPayment('c_suresh_verma', 12.5)).ok).toBe(false);
    expect((await repo.addPayment('nobody', 10)).ok).toBe(false);
    expect(await db.ledgerEntries.count()).toBe(2);
  });

  it('allows overpaying (negative balance) with a warning', async () => {
    await seedIfFirstRun(db);
    const result = await repo.addPayment('c_ramesh_sharma', 500);
    expect(result).toMatchObject({ ok: true, balanceAfter: -380 });
    expect(result.ok && result.warnings.length).toBe(1);
  });

  it('builds a statement with a running balance, oldest first', async () => {
    await seedIfFirstRun(db);
    await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
    await repo.saveBillWithLedger(bill('d1', { customerId: 'c_ramesh_sharma' }));
    await repo.addPayment('c_ramesh_sharma', 50);
    const rows = await repo.getCustomerStatement('c_ramesh_sharma');
    expect(rows.map((r) => [r.entry.type, r.balance])).toEqual([['udhaar', 120], ['udhaar', 210], ['payment', 160]]);
  });

  it('lists customers with balances', async () => {
    await seedIfFirstRun(db);
    const list = await repo.listCustomersWithBalance();
    expect(list.find((x) => x.customer.id === 'c_suresh_verma')?.balance).toBe(300);
    expect(list.find((x) => x.customer.id === 'c_anil_singh')?.balance).toBe(0);
  });

  it('says since when a customer has owed money, and nothing for a customer who owes nothing', async () => {
    await seedIfFirstRun(db);
    const list = await repo.listCustomersWithBalance();
    const verma = list.find((x) => x.customer.id === 'c_suresh_verma');
    expect(verma?.oldestUnpaidAt).toEqual(expect.any(Number));
    expect(list.find((x) => x.customer.id === 'c_anil_singh')?.oldestUnpaidAt).toBeNull();
  });
});

describe('frequent products (quick tiles)', () => {
  it('lists the products sold most often first, and ignores reversed bills', async () => {
    await seedIfFirstRun(db);
    const products = await repo.listProducts();
    const [a, b] = products as [Product, Product];
    const line = (p: Product) => ({ productId: p.id, name: p.name, quantity: 1, unit: p.unit, unitPrice: p.pricePerUnit, lineTotal: p.pricePerUnit });
    await repo.saveBillWithLedger({ draftId: 'f1', items: [line(b)], total: b.pricePerUnit, paid: b.pricePerUnit, udhaar: 0 });
    await repo.saveBillWithLedger({ draftId: 'f2', items: [line(b)], total: b.pricePerUnit, paid: b.pricePerUnit, udhaar: 0 });
    await repo.saveBillWithLedger({ draftId: 'f3', items: [line(a)], total: a.pricePerUnit, paid: a.pricePerUnit, udhaar: 0 });
    const top = await repo.listFrequentProducts(2);
    expect(top.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it('falls back to the catalog by name for a shop with no bills yet, up to the limit', async () => {
    await seedIfFirstRun(db);
    const top = await repo.listFrequentProducts(3);
    expect(top).toHaveLength(3);
    expect(top.map((p) => p.name)).toEqual((await repo.listProducts()).slice(0, 3).map((p) => p.name));
  });
});

describe('snapshot', () => {
  it('carries prices, derived balances and respects protocol limits', async () => {
    await seedIfFirstRun(db);
    await repo.upsertProduct({ name: 'N'.repeat(200), aliases: Array.from({ length: 30 }, (_, i) => `a${i}`), unit: 'kg', pricePerUnit: 5 });
    const snapshot = await buildSnapshot(db);
    expect(snapshot.customers.find((c) => c.id === 'c_ramesh_sharma')?.balance).toBe(120);
    const big = snapshot.products.find((p) => p.name.startsWith('NNN'))!;
    expect(big.name).toHaveLength(80);
    expect(big.aliases).toHaveLength(12);
  });
});
