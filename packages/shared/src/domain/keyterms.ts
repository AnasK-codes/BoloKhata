/**
 * Keyterms for Gnani STT biasing, taken from product and customer names and aliases.
 *
 * Header transport: HTTP header values must be ASCII, so `keytermsHeaderValue` returns a
 * JSON array with every non-ASCII character as a \uXXXX escape. The exact header format
 * Gnani expects is NOT verified here; confirm it in the docs/spike before relying on it.
 */
import type { CatalogCustomer, CatalogProduct } from '../protocol/client';

export const MAX_KEYTERMS = 200;
const MIN_LENGTH = 2;
const MAX_LENGTH = 40;

interface NameSource {
  name: string;
  aliases: readonly string[];
}

/** Products first (most speech is about items), then customers; deduplicated, capped. */
export function extractKeyterms(
  products: readonly Pick<CatalogProduct, 'name' | 'aliases'>[],
  customers: readonly Pick<CatalogCustomer, 'name' | 'aliases'>[] = [],
  max: number = MAX_KEYTERMS,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const sources: NameSource[] = [...products, ...customers];
  for (const source of sources) {
    for (const raw of [source.name, ...source.aliases]) {
      if (out.length >= max) return out;
      const term = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
      if (term.length < MIN_LENGTH || term.length > MAX_LENGTH) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

/** JSON array, ASCII only. */
export function keytermsHeaderValue(terms: readonly string[]): string {
  return JSON.stringify(terms).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
