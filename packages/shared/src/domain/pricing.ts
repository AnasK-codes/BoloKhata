/**
 * Billing: rules-extracted spoken quotes or catalog rates -> priced bill. The LLM never prices anything.
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
import { spokenPriceSchema } from '../protocol/server';
import { computeTotals, halfUp, isEmptyAdjust, type BillAdjust } from './adjustments';

export type UnresolvedItem = z.infer<typeof unresolvedSchema>;

export interface ParsedItem {
  name: string;
  quantity: number;
  /** null: no unit was spoken; use the catalog unit. */
  unit: Unit | null;
  /** Rules-extracted only; never accepted from a model. */
  spokenPrice?: { amount: number; basis: 'line' | 'unit'; unit: Unit | null; quantity?: number };
  /** Rules only: the amount was vague ("thoda aata"); the line is priced at a placeholder and asked about. */
  quantityUnclear?: true;
}

export interface BuildBillInput {
  parsedItems: readonly ParsedItem[];
  /** A product list (an index is built) or a prebuilt index (preferred in loops). */
  products: readonly CatalogProduct[] | CatalogIndex;
  customerId?: string;
  amountPaid?: number | null;
  udhaarAmount?: number | null;
  /** Rules-extracted only (like a spoken price); the model never supplies it. */
  adjust?: BillAdjust;
}

export interface BuildBillResult {
  bill: DraftBill;
  unresolvedItems: UnresolvedItem[];
  warnings: string[];
  /** True when anything needs a human look (unresolved items, impossible conversions, mismatches). */
  needsReview: boolean;
  /** Indexes into `bill.items` whose amount was vague and must be asked for. */
  unclearQuantity: number[];
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
  return halfUp(milliQuantity * pricePerUnit, 1000);
}

/** The largest quantity on one line, in thousandths of a unit (one million units). */
const MAX_MILLI_QUANTITY = 1_000_000_000;

export function repriceBillItem(item: BillItem, quantity: number): BillItem | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity * 1000 > MAX_MILLI_QUANTITY) return null;
  const price = item.spokenPrice;
  if (!price) return item.unitPrice === null ? null : { ...item, quantity, lineTotal: lineTotal(Math.round(quantity * 1000), item.unitPrice) };
  const milli = convertToMilli(quantity, item.unit, price.unit);
  if (milli === null || milli <= 0) return null;
  const denominator = Math.round(price.quantity * 1000);
  if (denominator <= 0) return null;
  const numerator = milli * price.amount;
  if (!Number.isSafeInteger(numerator * 2 + denominator)) return null;
  return { ...item, quantity, lineTotal: halfUp(numerator, denominator) };
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
  const unclearQuantity: number[] = [];
  let needsReview = false;

  const parsed = input.parsedItems.slice(0, LIMITS.maxBillItems);
  if (input.parsedItems.length > parsed.length) {
    warnings.push(`Only the first ${LIMITS.maxBillItems} items were used.`);
    needsReview = true;
  }

  for (const item of parsed) {
    const match = index.matchProduct(item.name);
    const product = match.best && !match.ambiguous ? index.getProduct(match.best.id) : undefined;
    if (item.spokenPrice) {
      const unit = item.unit ?? product?.unit ?? 'piece';
      const quote = spokenPriceSchema.safeParse({ ...item.spokenPrice,
        quantity: item.spokenPrice.quantity ?? (item.spokenPrice.basis === 'line' ? item.quantity : 1),
        unit: item.spokenPrice.unit ?? unit });
      const rateQuantity = quote.success ? convertToMilli(1, unit, quote.data.unit) : null;
      const denominator = quote.success ? Math.round(quote.data.quantity * 1000) : 0;
      const rateNumerator = quote.success && rateQuantity !== null ? rateQuantity * quote.data.amount : 0;
      const unitPrice = denominator > 0 && rateQuantity !== null && rateNumerator % denominator === 0 ? rateNumerator / denominator : null;
      const priced = quote.success ? repriceBillItem({
        productId: product?.id ?? `spoken:${items.length}:${normalizeSpokenId(item.name)}`,
        name: product?.name ?? item.name, quantity: item.quantity, unit, unitPrice,
        lineTotal: 0, spokenPrice: quote.data,
      }, item.quantity) : null;
      if (priced && item.name.trim()) {
        if (item.quantityUnclear) unclearQuantity.push(items.length);
        items.push(priced);
        continue;
      }
      warnings.push(`"${item.name}" ki boli gayi price ya unit valid nahi hai. Poore rupaye aur sahi unit bolo.`);
      unresolvedItems.push(unresolved(item, candidatesOf(match))); needsReview = true; continue;
    }
    if (!product) {
      unresolvedItems.push(unresolved(item, candidatesOf(match)));
      needsReview = true;
      continue;
    }
    const milli = convertToMilli(item.quantity, item.unit ?? product.unit, product.unit);
    // Same bound as a spoken price (repriceBillItem): an absurd quantity is a mishearing, not a sale.
    if (milli === null || milli <= 0 || milli > MAX_MILLI_QUANTITY || !Number.isSafeInteger(milli * product.pricePerUnit * 2 + 1000)) {
      const bad = !Number.isFinite(item.quantity) || item.quantity <= 0 || milli !== null;
      warnings.push(
        bad
          ? `Quantity for "${product.name}" is not valid.`
          : `${product.name} is sold per ${product.unit}; "${item.unit}" cannot be converted.`,
      );
      unresolvedItems.push(unresolved(item, candidatesOf(match)));
      needsReview = true;
      continue;
    }
    if (item.quantityUnclear) unclearQuantity.push(items.length);
    items.push({
      productId: product.id,
      name: product.name,
      quantity: milli / 1000,
      unit: product.unit,
      unitPrice: product.pricePerUnit,
      lineTotal: lineTotal(milli, product.pricePerUnit),
    });
  }

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const adjust = isEmptyAdjust(input.adjust) ? undefined : input.adjust;
  const total = computeTotals(subtotal, adjust).total;
  if (items.length === 0) warnings.push('The bill has no items.');

  const reconciled = reconcilePayment(total, input.amountPaid, input.udhaarAmount, input.customerId, warnings);
  if (reconciled.review) needsReview = true;

  return {
    bill: { items, total, paid: reconciled.paid, udhaar: reconciled.udhaar, ...(adjust ? { adjust } : {}) },
    unresolvedItems,
    warnings,
    needsReview,
    unclearQuantity,
  };
}

function normalizeSpokenId(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 40) || 'item';
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
