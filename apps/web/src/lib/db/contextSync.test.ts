import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '@bolbill/shared';
import { ContextSync } from './contextSync';
import { createRepo } from './repo';
import { BolDb } from './schema';
import { seedIfFirstRun } from './seed';

let db: BolDb;
let sent: ClientMessage[];
let sync: ContextSync;
let online: boolean;
let n = 0;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  db = new BolDb(`sync-${++n}`);
  await seedIfFirstRun(db);
  sent = [];
  online = true;
  sync = new ContextSync({ db, debounceMs: 100, send: (m) => (online ? (sent.push(m), true) : false) });
});
afterEach(() => {
  sync.stop();
  vi.useRealTimers();
});

const settle = async (ms = 200) => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise((r) => setImmediate(r));
  await vi.advanceTimersByTimeAsync(ms);
};

describe('ContextSync', () => {
  it('sends nothing for the catalog hello already carried', async () => {
    await sync.snapshotForHello();
    sync.start();
    await settle();
    expect(sent).toEqual([]);
  });

  it('sends one context_update after a ledger change, with the new balance', async () => {
    await sync.snapshotForHello();
    sync.start();
    await settle();
    const repo = createRepo(db);
    await repo.addPayment('c_suresh_verma', 100);
    await repo.addPayment('c_suresh_verma', 50);
    await settle();
    expect(sent).toHaveLength(1);
    const message = sent[0] as Extract<ClientMessage, { type: 'context_update' }>;
    expect(message.catalog.customers?.find((c) => c.id === 'c_suresh_verma')?.balance).toBe(150);
  });

  it('sends after a catalog edit', async () => {
    await sync.snapshotForHello();
    sync.start();
    await settle();
    await createRepo(db).upsertProduct({ name: 'Namak', aliases: [], unit: 'kg', pricePerUnit: 20 });
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('keeps the change pending when the socket is down, and hello carries it later', async () => {
    await sync.snapshotForHello();
    sync.start();
    await settle();
    online = false;
    await createRepo(db).addPayment('c_suresh_verma', 100);
    await settle();
    expect(sent).toEqual([]);
    const hello = await sync.snapshotForHello();
    expect(hello.customers.find((c) => c.id === 'c_suresh_verma')?.balance).toBe(200);
  });
});
