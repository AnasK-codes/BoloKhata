import type { CatalogSnapshot } from '../realtime/types';

/** Synthetic shop data for the dev labs. Fictional names, no real people. */
export const DEV_CATALOG: CatalogSnapshot = {
  version: 1,
  products: [
    { id: 'p-aata', name: 'Aata', aliases: ['atta', 'wheat flour'], unit: 'kg', pricePerUnit: 45 },
    { id: 'p-cheeni', name: 'Cheeni', aliases: ['sugar', 'chini'], unit: 'kg', pricePerUnit: 50 },
    { id: 'p-maggi', name: 'Maggi', aliases: ['maggie', 'noodles'], unit: 'packet', pricePerUnit: 14 },
    { id: 'p-chai', name: 'Chai patti', aliases: ['tea'], unit: 'packet', pricePerUnit: 120 },
  ],
  customers: [
    { id: 'c-sharma', name: 'Sharma ji', aliases: ['Sharma uncle'], balance: 120 },
    { id: 'c-verma', name: 'Verma ji', aliases: [], balance: 300 },
  ],
};
