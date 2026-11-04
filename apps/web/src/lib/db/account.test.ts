import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getDb, BolDb } from './schema';
import { createRepo } from './repo';

describe('account local data and receipt identity', () => {
  it('opens a separate local store per account and leaves legacy guest data untouched', async () => {
    const a = getDb('11111111-1111-4111-8111-111111111111');
    const b = getDb('22222222-2222-4222-8222-222222222222');
    const guest = getDb();
    await a.products.put({ id: 'p', name: 'Synthetic Item', aliases: [], unit: 'piece', pricePerUnit: 10 });
    expect(await b.products.count()).toBe(0); expect(await guest.products.count()).toBe(0);
    expect(getDb('11111111-1111-4111-8111-111111111111')).toBe(a);
    await Promise.all([a.delete(), b.delete(), guest.delete()]);
  });
  it('snapshots receipt details so later business edits do not rewrite saved bills', async () => {
    const db = new BolDb('receipt-business-test');
    let business = { businessName: 'Synthetic Kirana', address: 'Synthetic Lane, Demo Nagar', mobile: '9000000000', receiptFooter: 'Thank you' };
    const repo = createRepo(db, () => 1, () => 'id', () => business);
    const bill = { items: [{ productId: 'p', name: 'Synthetic Item', quantity: 1, unit: 'piece' as const, unitPrice: 10, lineTotal: 10 }], total: 10, paid: 10, udhaar: 0 };
    await repo.saveBillWithLedger({ draftId: 'one', ...bill });
    business = { ...business, businessName: 'Renamed Synthetic Shop' };
    await repo.saveBillWithLedger({ draftId: 'two', ...bill });
    expect((await db.bills.get('one'))?.business?.businessName).toBe('Synthetic Kirana');
    expect((await db.bills.get('two'))?.business?.businessName).toBe('Renamed Synthetic Shop');
    await db.delete();
  });
});
