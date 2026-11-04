import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BolDb } from './schema';
import { createRepo, type Repo } from './repo';
import { buildSnapshot } from './snapshot';

let db: BolDb;
let repo: Repo;
let clock = Date.now();
let counter = 0;
let dbName = 0;

beforeEach(async () => {
  db = new BolDb(`shop-${++dbName}`);
  clock = Date.now();
  counter = 0;
  repo = createRepo(db, () => (clock += 10), () => `id-${++counter}`);
  await db.products.bulkAdd([
    { id: 'p1', name: 'Aata', aliases: [], unit: 'kg', pricePerUnit: 45, stock: 10 },
    { id: 'p2', name: 'Cheeni', aliases: ['sugar'], unit: 'kg', pricePerUnit: 50 },
  ]);
  await db.customers.add({ id: 'c1', name: 'Sharma ji', aliases: [], createdAt: 1, mobile: '9876543210', address: 'Gali 4, Delhi' });
});

const line = (quantity: number) => ({ productId: 'p1', name: 'Aata', quantity, unit: 'kg' as const, unitPrice: 45, lineTotal: quantity * 45 });

describe('stock', () => {
  it('goes down when a bill is saved and comes back when it is reversed', async () => {
    await repo.saveBillWithLedger({ draftId: 'b1', items: [line(2.5)], total: 113, paid: 113, udhaar: 0 });
    expect((await db.products.get('p1'))?.stock).toBe(7.5);
    await repo.reverseBill('b1', 'galat bill');
    expect((await db.products.get('p1'))?.stock).toBe(10);
  });

  it('does not touch products without a stock count', async () => {
    await repo.saveBillWithLedger({ draftId: 'b2', items: [{ ...line(1), productId: 'p2', name: 'Cheeni' }], total: 45, paid: 45, udhaar: 0 });
    expect((await db.products.get('p2'))?.stock).toBeUndefined();
  });

  it('does not take stock twice for the same draft', async () => {
    await repo.saveBillWithLedger({ draftId: 'b3', items: [line(1)], total: 45, paid: 45, udhaar: 0 });
    await repo.saveBillWithLedger({ draftId: 'b3', items: [line(1)], total: 45, paid: 45, udhaar: 0 });
    expect((await db.products.get('p1'))?.stock).toBe(9);
  });

  it('marks a product out of stock and can stop tracking it', async () => {
    expect(await repo.setStock('p1', 0)).toEqual({ ok: true });
    expect((await db.products.get('p1'))?.stock).toBe(0);
    await repo.setStock('p1', undefined);
    expect((await db.products.get('p1'))?.stock).toBeUndefined();
    expect((await repo.setStock('p1', -1)).ok).toBe(false);
    expect((await repo.setStock('missing', 1)).ok).toBe(false);
  });
});

describe('bill adjustments', () => {
  it('keeps the adjustment on the saved bill', async () => {
    const result = await repo.saveBillWithLedger({ draftId: 'b4', items: [line(2)], total: 85, paid: 85, udhaar: 0, adjust: { discountAmount: 5 } });
    expect(result.bill.adjust).toEqual({ discountAmount: 5 });
    expect((await db.bills.get('b4'))?.total).toBe(85);
  });
});

describe('learning how the shop says things', () => {
  it('adds a spoken word as a product alias', async () => {
    expect(await repo.learnProductAlias('p2', 'shakkar')).toBe(true);
    expect((await db.products.get('p2'))?.aliases).toEqual(['sugar', 'shakkar']);
  });

  it('does not add a word that already names a product', async () => {
    expect(await repo.learnProductAlias('p1', 'sugar')).toBe(false);
    expect(await repo.learnProductAlias('p1', 'aata')).toBe(false);
    // Spelled differently but folded to the same word as an existing name: already understood.
    expect(await repo.learnProductAlias('p1', 'chini')).toBe(false);
    expect(await repo.learnProductAlias('p1', '   ')).toBe(false);
  });

  it('adds a customer alias, but never one that belongs to someone else', async () => {
    await db.customers.add({ id: 'c2', name: 'Verma ji', aliases: [], createdAt: 2 });
    expect(await repo.learnCustomerAlias('c1', 'shamu')).toBe(true);
    expect(await repo.learnCustomerAlias('c1', 'verma ji')).toBe(false);
  });
});

describe('shop numbers for the voice summary', () => {
  it('counts today\'s live bills and the total udhaar', async () => {
    await repo.saveBillWithLedger({ draftId: 's1', customerId: 'c1', items: [line(2)], total: 90, paid: 0, udhaar: 90 });
    await repo.saveBillWithLedger({ draftId: 's2', items: [line(1)], total: 45, paid: 45, udhaar: 0 });
    await repo.saveBillWithLedger({ draftId: 's3', items: [line(1)], total: 45, paid: 45, udhaar: 0 });
    await repo.reverseBill('s3', 'galat');
    const { shop } = await buildSnapshot(db);
    expect(shop).toEqual({ todaySales: 135, todayBills: 2, totalUdhaar: 90 });
  });

  it('leaves stock out of the snapshot sent to the gateway', async () => {
    const { products } = await buildSnapshot(db);
    expect(products.every((p) => !('stock' in p))).toBe(true);
  });
});
