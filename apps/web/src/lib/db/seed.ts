import { z } from 'zod';
import { aliasesSchema, catalogProductSchema, idSchema, nameSchema } from '@bolbill/shared';
import seedFile from '../../../../../data/seed-catalog.json';
import type { BolDb } from './schema';

const seedSchema = z.object({
  products: z.array(catalogProductSchema),
  customers: z.array(z.object({ id: idSchema, name: nameSchema, aliases: aliasesSchema })),
  openingBalances: z
    .array(z.object({ customerId: idSchema, amount: z.number().int().positive(), note: z.string().max(80).optional() }))
    .default([]),
});

const SEEDED_KEY = 'seededAt';
const OPENING_TIME = Date.UTC(2026, 0, 1);

/**
 * Loads the synthetic seed catalog the first time the app runs, guarded by a flag stored in the
 * same transaction, so reloading (or two tabs) never duplicates it and a shop that deleted
 * everything is not re-seeded. Returns true when it seeded.
 */
export async function seedIfFirstRun(db: BolDb, now: number = Date.now()): Promise<boolean> {
  const seed = seedSchema.parse(seedFile);
  return db.transaction('rw', [db.products, db.customers, db.ledgerEntries, db.meta], async () => {
    if (await db.meta.get(SEEDED_KEY)) return false;
    await db.products.bulkPut(seed.products);
    await db.customers.bulkPut(seed.customers.map((c) => ({ ...c, createdAt: now })));
    await db.ledgerEntries.bulkPut(
      seed.openingBalances.map((o) => ({
        id: `opening:${o.customerId}`,
        customerId: o.customerId,
        type: 'udhaar' as const,
        amount: o.amount,
        ...(o.note ? { note: o.note } : {}),
        createdAt: OPENING_TIME,
      })),
    );
    await db.meta.put({ key: SEEDED_KEY, value: now });
    return true;
  });
}

/** Wipes every table and loads the seed again. Callers must confirm with the user first. */
export async function resetDemoData(db: BolDb, now: number = Date.now()): Promise<void> {
  await db.transaction('rw', [db.products, db.customers, db.bills, db.ledgerEntries, db.meta], async () => {
    await Promise.all([db.products.clear(), db.customers.clear(), db.bills.clear(), db.ledgerEntries.clear(), db.meta.clear()]);
  });
  await seedIfFirstRun(db, now);
}
