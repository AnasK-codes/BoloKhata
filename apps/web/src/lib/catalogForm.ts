import { LIMITS, UNITS, type Unit } from '@bolbill/shared';
import { detailErrors } from './detailIssues';
import { t } from './i18n';

export interface ProductFormInput {
  name: string;
  price: string;
  unit: string;
  /** Comma-separated. */
  aliases: string;
  /** Optional on-hand count. Empty means the product's stock is not tracked. */
  stock?: string;
}

export interface ProductFormValue {
  name: string;
  pricePerUnit: number;
  unit: Unit;
  aliases: string[];
  /** Absent when not tracked. */
  stock?: number;
}

export type ProductFormResult =
  | { ok: true; value: ProductFormValue }
  | { ok: false; errors: Partial<Record<keyof ProductFormInput, string>> };

export function parseAliases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const alias = part.trim().slice(0, LIMITS.maxNameLength);
    const key = alias.toLowerCase();
    if (alias === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** Validates the catalog form. Messages are short, in the interface language, with the fix in them. */
export function validateProductForm(input: ProductFormInput): ProductFormResult {
  const errors: Partial<Record<keyof ProductFormInput, string>> = {};
  const name = input.name.trim();
  if (name === '') errors.name = t('form.nameRequired');
  else if (name.length > LIMITS.maxNameLength) errors.name = t('form.nameTooLong', { max: LIMITS.maxNameLength });

  const price = Number(input.price.trim());
  if (input.price.trim() === '' || !Number.isInteger(price) || price <= 0) {
    errors.price = t('form.priceInvalid');
  }
  if (!(UNITS as readonly string[]).includes(input.unit)) errors.unit = t('form.unitRequired');

  const aliases = parseAliases(input.aliases);
  if (aliases.length > LIMITS.maxAliasesPerEntry) errors.aliases = t('form.tooManyAliases', { max: LIMITS.maxAliasesPerEntry });

  const stockText = input.stock?.trim() ?? '';
  const stock = stockText === '' ? undefined : Number(stockText);
  if (stock !== undefined && (!Number.isFinite(stock) || stock < 0 || stock > 1_000_000)) errors.stock = t('form.stockInvalid');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, pricePerUnit: price, unit: input.unit as Unit, aliases, ...(stock !== undefined ? { stock } : {}) } };
}

export interface CustomerFormInput {
  name: string;
  /** Comma-separated: other ways the name is said, for example "Sharma uncle, शर्मा जी". */
  aliases: string;
  mobile?: string;
  address?: string;
}

export type CustomerFormResult =
  | { ok: true; value: { name: string; aliases: string[]; mobile?: string; address?: string } }
  | { ok: false; errors: Partial<Record<keyof CustomerFormInput, string>> };

export function validateCustomerForm(input: CustomerFormInput): CustomerFormResult {
  const errors: Partial<Record<keyof CustomerFormInput, string>> = {};
  const name = input.name.trim();
  if (name === '') errors.name = t('form.nameRequired');
  else if (name.length > LIMITS.maxNameLength) errors.name = t('form.nameTooLong', { max: LIMITS.maxNameLength });
  const aliases = parseAliases(input.aliases);
  const mobile = input.mobile?.trim() ?? '';
  const address = input.address?.trim() ?? '';
  if (mobile || address) {
    // Saving contact details needs both. Say which one is wrong and why, not a single catch-all.
    const found = detailErrors(t, { name, mobile, address });
    if (found.mobile) errors.mobile = found.mobile;
    if (found.address) errors.address = found.address;
  }
  if (aliases.length > LIMITS.maxAliasesPerEntry) errors.aliases = t('form.tooManyAliases', { max: LIMITS.maxAliasesPerEntry });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, aliases, ...(mobile || address ? { mobile, address } : {}) } };
}
