/** Test-only helper: loads the synthetic seed catalog from data/seed-catalog.json. */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { catalogProductSchema } from '../protocol/client';
import { aliasesSchema, idSchema, nameSchema } from '../protocol/common';
import { CatalogIndex } from '../domain/matching';

const seedSchema = z.object({
  products: z.array(catalogProductSchema),
  customers: z.array(z.object({ id: idSchema, name: nameSchema, aliases: aliasesSchema })),
});
export type SeedCatalog = z.infer<typeof seedSchema>;

export function loadSeed(): SeedCatalog {
  const url = new URL('../../../../data/seed-catalog.json', import.meta.url);
  return seedSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
}

export function seedIndex(): CatalogIndex {
  const seed = loadSeed();
  return new CatalogIndex(seed.products, seed.customers);
}
