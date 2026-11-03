/**
 * Billing: parsed items + catalog -> priced bill. Deterministic; the LLM never prices anything.
 *
 * Rules (one place, so they are explainable):
 * - Rounding: ONE rule, half up, applied per line total. Quantities are held as integer
 *   thousandths so there is no float drift: line = floor((milli * price + 500) / 1000).
 * - Unit conversion: kg<->g and l<->ml by 1000; dozen<->piece by 12. Anything else
 *   (kg vs packet, litre vs piece ...) is impossible: the item goes to `unresolvedItems`
 *   with a warning and `needsReview` is set. No unit spoken means "the catalog unit".
 * - Ambiguous or low-confidence product matches are never guessed; they go to
 *   `unresolvedItems` with candidates.
 * - Payment reconciliation: total = sum of line totals. Both paid and udhaar given and
 *   disagreeing: warn and trust udhaar (the credit is what gets recorded). Only udhaar:
 *   paid = total - udhaar. Only paid: udhaar = total - paid. Neither: fully paid.
 *   udhaar above total is capped with a warning.
 */
import { LIMITS } from '../protocol/constants';
import type { CatalogProduct } from '../protocol/client';
import type { Unit } from '../protocol/common';
import type { unresolvedSchema } from '../protocol/server';
import type { z } from 'zod';
import { CatalogIndex, type MatchResult } from './matching';
import type { BillItem, DraftBill } from './types';

export type UnresolvedItem = z.infer<typeof unresolvedSchema>;

export interface ParsedItem {
  name: string;
  quantity: number;
  /** null: no unit was spoken; use the catalog unit. */
  unit: Unit | null;
}

export interface BuildBillInput {
  parsedItems: readonly ParsedItem[];
  /** A product list (an index is built) or a prebuilt index (preferred in loops). */
  products: readonly CatalogProduct[] | CatalogIndex;
  customerId?: string;
  amountPaid?: number | null;
  udhaarAmount?: number | null;
}

export interface BuildBillResult {
  bill: DraftBill;
  unresolvedItems: UnresolvedItem[];
  warnings: string[];
  /** True when anything needs a human look (unresolved items, impossible conversions, mismatches). */
  needsReview: boolean;
}

/** Quantity of `from` in `to` units, in thousandths, or null if the units cannot convert. */
export function convertToMilli(quantity: number, from: Unit, to: Unit): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const factor = conversionFactor(from, to);
  if (factor === null) return null;
  return Math.round(quantity * factor * 1000);
}

function conversionFactor(from: Unit, to: Unit): number | null {
  if (from === to) return 1;
  if (from === 'g' && to === 'kg') return 1 / 1000;
  if (from === 'kg' && to === 'g') return 1000;
  if (from === 'ml' && to === 'l') return 1 / 1000;
  if (from === 'l' && to === 'ml') return 1000;
  if (from === 'dozen' && to === 'piece') return 12;
  if (from === 'piece' && to === 'dozen') return 1 / 12;
  return null;
}

/** Half-up rounding of milli-quantity times price, in whole rupees. */
export function lineTotal(milliQuantity: number, pricePerUnit: number): number {
  return Math.floor((milliQuantity * pricePerUnit + 500) / 1000);
}

const asRupees = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;

function candidatesOf(match: MatchResult): UnresolvedItem['candidates'] {
  return match.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score }));
}

function unresolved(
  item: ParsedItem,
  candidates: UnresolvedItem['candidates'],
): UnresolvedItem {
  const spoken = item.name.slice(0, LIMITS.maxNameLength) || '?';
  const out: UnresolvedItem = { kind: 'item', spoken, candidates };
  if (Number.isFinite(item.quantity) && item.quantity > 0) out.quantity = item.quantity;
  if (item.unit) out.unit = item.unit;
  return out;
}

export function buildBill(input: BuildBillInput): BuildBillResult {
  const index = input.products instanceof CatalogIndex ? input.products : new CatalogIndex(input.products);
  const warnings: string[] = [];
  const unresolvedItems: UnresolvedItem[] = [];
  const items: BillItem[] = [];
  let needsReview = false;

  const parsed = input.parsedItems.slice(0, LIMITS.maxBillItems);
  if (input.parsedItems.length > parsed.length) {
    warnings.push(`Only the first ${LIMITS.maxBillItems} items were used.`);
    needsReview = true;
  }

  for (const item of parsed) {
    const match = index.matchProduct(item.name);
    const product = match.best && !match.ambiguous ? index.getProduct(match.best.id) : undefined;
    if (!product) {
      unresolvedItems.push(unresolved(item, candidatesOf(match)));
      needsReview = true;
      continue;
    }
    const milli = convertToMilli(item.quantity, item.unit ?? product.unit, product.unit);
    if (milli === null || milli <= 0) {
      const bad = !Number.isFinite(item.quantity) || item.quantity <= 0;
      warnings.push(
        bad
          ? `Quantity for "${product.name}" is not valid.`
          : `${product.name} is sold per ${product.unit}; "${item.unit}" cannot be converted.`,
      );
      unresolvedItems.push(unresolved(item, candidatesOf(match)));
      needsReview = true;
      continue;
    }
    items.push({
      productId: product.id,
      name: product.name,
      quantity: milli / 1000,
      unit: product.unit,
      unitPrice: product.pricePerUnit,
      lineTotal: lineTotal(milli, product.pricePerUnit),
    });
  }

  const total = items.reduce((sum, i) => sum + i.lineTotal, 0);
  if (items.length === 0) warnings.push('The bill has no items.');

  const reconciled = reconcilePayment(total, input.amountPaid, input.udhaarAmount, input.customerId, warnings);
  if (reconciled.review) needsReview = true;

  return {
    bill: { items, total, paid: reconciled.paid, udhaar: reconciled.udhaar },
    unresolvedItems,
    warnings,
    needsReview,
  };
}

function reconcilePayment(
  total: number,
  amountPaid: number | null | undefined,
  udhaarAmount: number | null | undefined,
  customerId: string | undefined,
  warnings: string[],
): { paid: number; udhaar: number; review: boolean } {
  let review = false;
  const paidIn = asRupees(amountPaid);
  let udhaarIn = asRupees(udhaarAmount);
  if (amountPaid != null && paidIn === null) warnings.push('The paid amount was not valid and was ignored.');
  if (udhaarAmount != null && udhaarIn === null) warnings.push('The udhaar amount was not valid and was ignored.');

  if (udhaarIn !== null && udhaarIn > total) {
    warnings.push('Udhaar is more than the bill total, so it was reduced to the total.');
    udhaarIn = total;
    review = true;
  }

  let paid = total;
  let udhaar = 0;
  if (udhaarIn !== null) {
    udhaar = udhaarIn;
    paid = total - udhaarIn;
    if (paidIn !== null && paidIn !== paid) {
      warnings.push('Paid and udhaar do not add up to the total; udhaar was kept.');
      review = true;
    }
  } else if (paidIn !== null) {
    if (paidIn > total) {
      warnings.push('Paid is more than the bill total, so it was reduced to the total.');
      review = true;
    }
    paid = Math.min(paidIn, total);
    udhaar = total - paid;
  }

  if (udhaar > 0 && !customerId) {
    warnings.push('Udhaar needs a customer.');
    review = true;
  }
  return { paid, udhaar, review };
}
