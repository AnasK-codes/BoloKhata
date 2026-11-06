import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepo } from '../db/repo';
import { BolDb } from '../db/schema';
import { seedIfFirstRun } from '../db/seed';
import { draftMessage } from '../turn/testing';
import { saveDraft } from './saveDraft';

let db: BolDb;
let n = 0;
beforeEach(async () => {
  db = new BolDb(`save-${++n}`);
  await seedIfFirstRun(db);
  // Explicit synthetic contact fixture for credit-saving tests.
  await db.customers.update('c_ramesh_sharma', { mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' });
});

describe('saveDraft', () => {
  it('saves a bill once however many times it is confirmed (tap plus "haan")', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(1, { customer: { id: 'c_ramesh_sharma', name: 'Ramesh Sharma', isNew: false } });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'bill', created: true });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'bill', created: false });
    expect((await repo.getBalances()).get('c_ramesh_sharma')).toBe(210);
  });

  it('requires details before creating a new customer on credit', async () => {
    const repo = createRepo(db);
    const result = await saveDraft(repo, draftMessage(2, { customer: { name: 'Naya Grahak', isNew: true } }));
    expect(result).toMatchObject({ kind: 'error', message: expect.stringContaining('mobile') });
    expect(await repo.findCustomerByName('naya grahak')).toBeUndefined();
  });

  it('records a payment once', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(3, { intent: 'record_payment', bill: undefined, payment: { amount: 100 }, customer: { id: 'c_suresh_verma', name: 'Suresh Verma', isNew: false } });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'payment', created: true, balanceAfter: 200 });
    expect(await saveDraft(repo, draft)).toMatchObject({ kind: 'payment', created: false });
    expect((await repo.getBalances()).get('c_suresh_verma')).toBe(200);
  });

  it('refuses drafts that are not savable', async () => {
    const repo = createRepo(db);
    expect((await saveDraft(repo, draftMessage(4, { intent: 'query_balance' }))).kind).toBe('error');
  });

  it('adds a spoken customer once, however many times it is confirmed', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(4, { intent: 'add_customer', bill: undefined, customer: { name: 'Mohan Lal', isNew: true } });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'customer', created: true });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'customer', created: false });
    expect(await repo.findCustomerByName('mohan lal')).toMatchObject({ name: 'Mohan Lal' });
  });

  it('adds a Devanagari customer that can then be found by that name', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(5, { intent: 'add_customer', bill: undefined, customer: { name: 'अनिल सिंह जी', isNew: true } });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'customer', created: true });
    expect(await repo.findCustomerByName('अनिल सिंह')).toBeDefined();
  });

  it('adds a spoken product once and the catalog can price it', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(6, { intent: 'add_product', bill: undefined, customer: undefined, product: { name: 'मैदा', unit: 'kg', pricePerUnit: 40, isNew: true } });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'product', created: true });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'product', created: false });
    const rows = (await repo.listProducts()).filter((p) => p.name === 'मैदा');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unit: 'kg', pricePerUnit: 40 });
  });

  it('refuses a product with no usable price', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(7, { intent: 'add_product', bill: undefined, customer: undefined, product: { name: 'Free', unit: 'kg', pricePerUnit: 1, isNew: true } });
    expect(await saveDraft(repo, { ...draft, product: { name: '', unit: 'kg', pricePerUnit: 1, isNew: true } })).toMatchObject({ kind: 'error' });
  });

  it('changes a product rate once and keeps its name, unit and stock', async () => {
    const repo = createRepo(db);
    const before = (await repo.listProducts()).find((p) => p.name === 'Aata' || p.aliases.length > 0);
    expect(before).toBeDefined();
    const id = before!.id;
    const draft = draftMessage(8, { intent: 'update_price', bill: undefined, customer: undefined, product: { id, name: before!.name, unit: before!.unit, pricePerUnit: before!.pricePerUnit + 5, previousPrice: before!.pricePerUnit, isNew: false } });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'price', created: true });
    const after = (await repo.listProducts()).find((p) => p.id === id);
    expect(after).toMatchObject({ name: before!.name, unit: before!.unit, pricePerUnit: before!.pricePerUnit + 5 });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'price', created: false });
  });

  it('will not change the rate of a product that is gone', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(9, { intent: 'update_price', bill: undefined, customer: undefined, product: { id: 'nope', name: 'Gone', unit: 'kg', pricePerUnit: 50, previousPrice: 40, isNew: false } });
    expect(await saveDraft(repo, draft)).toMatchObject({ kind: 'error' });
  });

  it('adds a whole list once, skipping products that already exist', async () => {
    const repo = createRepo(db);
    const row = (name: string, pricePerUnit: number) => ({ name, unit: 'kg' as const, pricePerUnit, isNew: true });
    const draft = draftMessage(10, { intent: 'add_products', bill: undefined, customer: undefined, products: [row('Sooji', 52), row('Besan', 80), row('Sooji', 60)] });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'products', created: 2 });
    expect(await saveDraft(repo, draft)).toEqual({ kind: 'products', created: 0 });
    const all = await repo.listProducts();
    expect(all.filter((p) => p.name === 'Sooji')).toHaveLength(1);
    expect(all.find((p) => p.name === 'Sooji')?.pricePerUnit).toBe(52);
    expect(all.find((p) => p.name === 'Besan')?.pricePerUnit).toBe(80);
  });

  it('refuses the whole list if one row is invalid, so nothing is half-saved', async () => {
    const repo = createRepo(db);
    const draft = draftMessage(11, { intent: 'add_products', bill: undefined, customer: undefined, products: [
      { name: 'Ragi', unit: 'kg', pricePerUnit: 40, isNew: true },
      { name: '', unit: 'kg', pricePerUnit: 40, isNew: true },
    ] });
    expect(await saveDraft(repo, draft)).toMatchObject({ kind: 'error' });
    expect((await repo.listProducts()).some((p) => p.name === 'Ragi')).toBe(false);
  });
});
