import { LIMITS, UNITS, creditDetailsSchema, type Unit } from '@bolbill/shared';

export interface ProductFormInput {
  name: string;
  price: string;
  unit: string;
  /** Comma-separated. */
  aliases: string;
}

export interface ProductFormValue {
  name: string;
  pricePerUnit: number;
  unit: Unit;
  aliases: string[];
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

/** Validates the catalog form. Messages are short Hinglish with the fix in them. */
export function validateProductForm(input: ProductFormInput): ProductFormResult {
  const errors: Partial<Record<keyof ProductFormInput, string>> = {};
  const name = input.name.trim();
  if (name === '') errors.name = 'Naam likho (name is required).';
  else if (name.length > LIMITS.maxNameLength) errors.name = `Naam ${LIMITS.maxNameLength} akshar se chhota rakho.`;

  const price = Number(input.price.trim());
  if (input.price.trim() === '' || !Number.isInteger(price) || price <= 0) {
    errors.price = 'Rate poora rupaya ho, 0 se zyada (whole rupees, above 0).';
  }
  if (!(UNITS as readonly string[]).includes(input.unit)) errors.unit = 'Unit chuno.';

  const aliases = parseAliases(input.aliases);
  if (aliases.length > LIMITS.maxAliasesPerEntry) errors.aliases = `Zyada se zyada ${LIMITS.maxAliasesPerEntry} doosre naam.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, pricePerUnit: price, unit: input.unit as Unit, aliases } };
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
  if (name === '') errors.name = 'Naam likho (name is required).';
  else if (name.length > LIMITS.maxNameLength) errors.name = `Naam ${LIMITS.maxNameLength} akshar se chhota rakho.`;
  const aliases = parseAliases(input.aliases);
  const mobile = input.mobile?.trim() ?? '';
  const address = input.address?.trim() ?? '';
  if (mobile || address) {
    const details = creditDetailsSchema.safeParse({ name, mobile, address });
    if (!details.success) for (const issue of details.error.issues) {
      if (issue.path[0] === 'mobile') errors.mobile = '10 digit mobile number likho.';
      if (issue.path[0] === 'address') errors.address = 'Poora address likho (5–300 letters).';
    }
  }
  if (aliases.length > LIMITS.maxAliasesPerEntry) errors.aliases = `Zyada se zyada ${LIMITS.maxAliasesPerEntry} doosre naam.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, aliases, ...(mobile || address ? { mobile, address } : {}) } };
}
