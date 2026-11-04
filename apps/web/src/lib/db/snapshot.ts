import { LIMITS, hasCreditDetails, type CatalogCustomer, type CatalogProduct } from '@bolbill/shared';
import type { CatalogSnapshot } from '../realtime/types';
import type { BolDb } from './schema';

const clip = (s: string) => s.slice(0, LIMITS.maxNameLength);
const aliases = (list: string[]) => list.map(clip).filter((a) => a.length > 0).slice(0, LIMITS.maxAliasesPerEntry);

/**
 * The shop's catalog as the gateway wants it (`hello` / `context_update`): products with
 * prices, customers with DERIVED balances. Trimmed to the protocol's size limits.
 */
export async function buildSnapshot(db: BolDb): Promise<CatalogSnapshot> {
  const [products, customers, entries] = await Promise.all([
    db.products.toArray(),
    db.customers.toArray(),
    db.ledgerEntries.toArray(),
  ]);
  const balances = new Map<string, number>();
  for (const e of entries) {
    balances.set(e.customerId, (balances.get(e.customerId) ?? 0) + (e.type === 'udhaar' ? e.amount : -e.amount));
  }
  const catalogProducts: CatalogProduct[] = products.slice(0, LIMITS.maxProducts).map((p) => ({
    id: p.id,
    name: clip(p.name),
    aliases: aliases(p.aliases),
    unit: p.unit,
    pricePerUnit: p.pricePerUnit,
    ...(p.category ? { category: clip(p.category) } : {}),
  }));
  const catalogCustomers: CatalogCustomer[] = customers.slice(0, LIMITS.maxCustomers).map((c) => ({
    id: c.id,
    name: clip(c.name),
    aliases: aliases(c.aliases),
    balance: balances.get(c.id) ?? 0,
    creditReady: hasCreditDetails(c),
  }));
  return { version: 0, products: catalogProducts, customers: catalogCustomers };
}
