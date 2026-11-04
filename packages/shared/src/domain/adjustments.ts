/**
 * Bill adjustments: discount, GST and round-off. One place, so the gateway and the browser
 * always agree on the payable total. Money is integer rupees and every rounding is half up.
 *
 * Order (fixed, so it is explainable):
 *   subtotal = sum of line totals
 *   discount = rupee amount, or percent of the subtotal (an amount wins if both are given),
 *              never more than the subtotal
 *   GST      = percent of (subtotal - discount)
 *   round-off = moves the total to the nearest ROUND_OFF_STEP rupees (can be negative)
 *   total    = subtotal - discount + GST + round-off
 */
import { z } from 'zod';
import { rupeesSchema } from '../protocol/common';

/** "Round off kar do" rounds the payable total to the nearest multiple of this. */
export const ROUND_OFF_STEP = 5;
export const MAX_GST_PERCENT = 28;

export const billAdjustSchema = z.object({
  discountAmount: rupeesSchema.max(1_000_000_000).optional(),
  discountPercent: z.number().int().min(1).max(100).optional(),
  gstPercent: z.number().int().min(1).max(MAX_GST_PERCENT).optional(),
  roundOff: z.boolean().optional(),
});
export type BillAdjust = z.infer<typeof billAdjustSchema>;

export interface BillTotals {
  subtotal: number;
  discount: number;
  gst: number;
  /** Signed: negative when the total was rounded down. */
  roundOff: number;
  total: number;
}

/** floor((2n + d) / 2d): half-up division for non-negative integers. */
const halfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator));

export function computeTotals(subtotal: number, adjust?: BillAdjust): BillTotals {
  const base = Math.max(0, Math.round(subtotal));
  const wanted = adjust?.discountAmount ?? (adjust?.discountPercent ? halfUp(base * adjust.discountPercent, 100) : 0);
  const discount = Math.min(base, Math.max(0, wanted));
  const taxable = base - discount;
  const gst = adjust?.gstPercent ? halfUp(taxable * adjust.gstPercent, 100) : 0;
  const before = taxable + gst;
  const roundOff = adjust?.roundOff ? halfUp(before, ROUND_OFF_STEP) * ROUND_OFF_STEP - before : 0;
  return { subtotal: base, discount, gst, roundOff, total: before + roundOff };
}

/** True when the adjustment changes nothing, so callers can leave it off a bill. */
export function isEmptyAdjust(adjust: BillAdjust | undefined): boolean {
  return !adjust || (!adjust.discountAmount && !adjust.discountPercent && !adjust.gstPercent && !adjust.roundOff);
}
