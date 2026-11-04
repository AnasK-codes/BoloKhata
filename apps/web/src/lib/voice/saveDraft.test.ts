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
});
