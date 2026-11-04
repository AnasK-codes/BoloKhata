/**
 * Optional stock counts. A product with no `stock` is simply not tracked. Quantities move in
 * the product's own unit, through the same unit conversion billing uses (kg <-> g and so on).
 */
import type { BillItem, Product } from './types';
import { convertToMilli } from './pricing';

/** At or below this many units (and above zero) a product shows as low. */
export const LOW_STOCK_AT = 5;

export const isOutOfStock = (p: Pick<Product, 'stock'>): boolean => p.stock !== undefined && p.stock <= 0;
export const isLowStock = (p: Pick<Product, 'stock'>): boolean => p.stock !== undefined && p.stock > 0 && p.stock <= LOW_STOCK_AT;

/**
 * Stock after a bill line is sold (`direction` -1, never below zero) or put back by a reversal
 * (+1). Returns undefined when nothing should change: the product is not tracked, or the line's
 * unit cannot convert to the product's unit.
 */
export function stockAfterLine(product: Pick<Product, 'stock' | 'unit'>, item: Pick<BillItem, 'quantity' | 'unit'>, direction: 1 | -1): number | undefined {
  if (product.stock === undefined) return undefined;
  const milli = convertToMilli(item.quantity, item.unit, product.unit);
  if (milli === null) return undefined;
  const next = Math.round(product.stock * 1000) + direction * milli;
  return Math.max(0, next) / 1000;
}
