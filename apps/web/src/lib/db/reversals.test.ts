import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BolDb } from './schema';
import { createRepo, type Repo } from './repo';
import { buildSnapshot } from './snapshot';

let db: BolDb;
let repo: Repo;
let serial = 0;
beforeEach(async () => {
  db = new BolDb(`reversal-${++serial}`);
  repo = createRepo(db);
  await db.customers.add({ id: 'c', name: 'Synthetic Customer', aliases: [], createdAt: 1,
    mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
});
afterEach(async () => { await db.delete(); });
const bill = (id: string, udhaar = 90) => ({ draftId: id, customerId: 'c', items: [
  { productId: 'a', name: 'Aata', unit: 'kg' as const, quantity: 2, unitPrice: 45, lineTotal: 90 },
], total: 90, paid: 90 - udhaar, udhaar });

describe('bill history and reversals', () => {
  it('saves spoken prices without creating or updating a catalog product', async () => {
    const quoted = { productId: 'spoken:0:biscuit', name: 'Biscuit', unit: 'packet' as const, quantity: 3, unitPrice: null, lineTotal: 50,
      spokenPrice: { amount: 50, basis: 'line' as const, quantity: 3, unit: 'packet' as const } };
    await repo.saveBillWithLedger({ draftId: 'quote', items: [quoted], total: 50, paid: 50, udhaar: 0 });
    expect((await repo.listBills())[0]?.items[0]).toEqual(quoted);
    expect(await repo.listProducts()).toEqual([]);
  });
  it('reverses a bill once atomically; subsequent payments stay in the ledger', async () => {
    await repo.saveBillWithLedger(bill('b'));
    await repo.addPayment('c', 30);
    expect((await repo.getBalances()).get('c')).toBe(60);
    expect(await repo.reverseBill('b', 'Wrong synthetic bill')).toEqual({ ok: true });
    expect((await repo.getBalances()).get('c')).toBe(-30);
    expect((await repo.listBills())[0]?.reversedAt).toBeDefined();
    expect((await repo.reverseBill('b', 'Again')).ok).toBe(false);
    expect(await db.ledgerEntries.count()).toBe(3);
  });
  it('reverses a payment without deleting the original and rejects double reversal', async () => {
    const payment = await repo.addPayment('c', 50);
    if (!payment.ok) throw new Error('Payment failed');
    expect((await repo.reverseLedgerEntry(payment.entry.id, 'Wrong payment')).ok).toBe(true);
    expect((await repo.getBalances()).get('c')).toBe(0);
    expect((await repo.reverseLedgerEntry(payment.entry.id, 'Again')).ok).toBe(false);
    expect((await repo.reverseLedgerEntry(`reversal:${payment.entry.id}`, 'Again')).ok).toBe(false);
  });
  it('serializes racing bill reversals', async () => {
    await repo.saveBillWithLedger(bill('b'));
    const results = await Promise.all([repo.reverseBill('b', 'One'), repo.reverseBill('b', 'Two')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await repo.getBalances()).get('c')).toBe(0);
  });
  it('marks cash bills reversed without creating ledger entries', async () => {
    await repo.saveBillWithLedger(bill('cash', 0));
    expect((await repo.reverseBill('cash', 'Wrong cash bill')).ok).toBe(true);
    expect(await db.ledgerEntries.count()).toBe(0);
  });
  it('requires a reason and routes bill-linked entries to full bill reversal', async () => {
    await repo.saveBillWithLedger(bill('b'));
    expect((await repo.reverseBill('b', ' ')).ok).toBe(false);
    expect((await repo.reverseLedgerEntry('udhaar:b', 'Wrong')).ok).toBe(false);
    expect((await repo.reverseBill('missing', 'Wrong')).ok).toBe(false);
  });
  it('rejects credit without details and rolls back creation of a customer', async () => {
    await expect(repo.saveBillWithLedger({ ...bill('bad'), customerId: undefined, customerName: 'Missing Details' })).rejects.toThrow('CREDIT_DETAILS_REQUIRED');
    expect(await repo.findCustomerByName('Missing Details')).toBeUndefined();
    expect(await db.bills.count()).toBe(0);
    await db.customers.update('c', { mobile: '' });
    await expect(repo.saveBillWithLedger(bill('bad2'))).rejects.toThrow('CREDIT_DETAILS_REQUIRED');
  });
  it('keeps mobile and address out of gateway snapshots', async () => {
    const snapshot = await buildSnapshot(db);
    expect(snapshot.customers[0]).toMatchObject({ creditReady: true });
    expect(JSON.stringify(snapshot)).not.toContain('9000000000');
    expect(JSON.stringify(snapshot)).not.toContain('Synthetic Lane');
  });
});
