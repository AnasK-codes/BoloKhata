import { describe, expect, it } from 'vitest';
import { draftSchema } from '../protocol/server';
import { computeTotals } from './adjustments';
import { buildBill, type ParsedItem } from './pricing';
import type { CatalogProduct } from '../protocol/client';

/**
 * Property tests for money: random catalogs, quantities, adjustments and payments, including NaN,
 * negative, huge and fractional inputs. Whatever comes in, a bill is whole rupees that add up, and
 * anything it cannot price becomes an unresolved item, never a wrong number or a throw.
 */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 4_294_967_296);
}
const UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'packet', 'dozen'] as const;
const WILD = [Number.NaN, -1, 0, 0.0004, 0.5, 1.25, 1e6, 1e9, 1e15, 1e300, Number.POSITIVE_INFINITY];
const products: CatalogProduct[] = UNITS.map((unit, i) => ({ id: `p${i}`, name: `Cheez${'abcdefg'[i]}`, aliases: [], unit, pricePerUnit: [45, 1, 120, 2, 10, 14, 60][i]! }));

describe('money properties', () => {
  it('a bill is always whole, safe, non-negative rupees with paid + udhaar = total, and passes the draft schema', () => {
    for (let run = 0; run < 2000; run++) {
      const rand = prng(run + 7);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
      const num = () => (rand() < 0.3 ? pick(WILD) : Math.round(rand() * 5000) / (rand() < 0.5 ? 1 : 4));
      const parsedItems: ParsedItem[] = Array.from({ length: Math.floor(rand() * 6) }, () => ({
        name: pick(products).name,
        quantity: num(),
        unit: rand() < 0.3 ? null : pick(UNITS),
        ...(rand() < 0.2 ? { spokenPrice: { amount: num(), basis: pick(['line', 'unit'] as const), unit: rand() < 0.5 ? null : pick(UNITS) } } : {}),
      }));
      const { bill, unresolvedItems } = buildBill({
        parsedItems,
        products,
        ...(rand() < 0.5 ? { customerId: 'c1' } : {}),
        amountPaid: rand() < 0.5 ? num() : null,
        udhaarAmount: rand() < 0.3 ? num() : null,
        ...(rand() < 0.4 ? { adjust: { discountPercent: 10, gstPercent: 5, roundOff: rand() < 0.5 } } : {}),
      });
      const label = `run ${run}`;
      for (const n of [bill.total, bill.paid, bill.udhaar, ...bill.items.map((i) => i.lineTotal)]) {
        expect(Number.isSafeInteger(n) && n >= 0, `${label}: ${n}`).toBe(true);
      }
      expect(bill.paid + bill.udhaar, label).toBe(bill.total);
      const draft = { type: 'draft', turnId: 1, draftId: 'd', intent: 'create_bill', source: 'rules', confidence: 1, bill, unresolved: unresolvedItems.slice(0, 10), warnings: [], replyText: ['ok'] };
      expect(draftSchema.safeParse(draft).success, label).toBe(true);
    }
  });

  it('adjustments never go below zero, never exceed subtotal plus GST, and round off to the step', () => {
    for (let run = 0; run < 2000; run++) {
      const rand = prng(run + 99);
      const subtotal = Math.floor(rand() * 100_000);
      const adjust = {
        ...(rand() < 0.5 ? { discountAmount: Math.floor(rand() * 200_000) } : { discountPercent: 1 + Math.floor(rand() * 100) }),
        ...(rand() < 0.5 ? { gstPercent: 1 + Math.floor(rand() * 28) } : {}),
        roundOff: rand() < 0.5,
      };
      const t = computeTotals(subtotal, adjust);
      expect(t.total).toBeGreaterThanOrEqual(0);
      expect(t.total).toBe(t.subtotal - t.discount + t.gst + t.roundOff);
      expect(t.discount).toBeLessThanOrEqual(t.subtotal);
      if (adjust.roundOff) expect(t.total % 5).toBe(0);
      for (const n of Object.values(t)) expect(Number.isSafeInteger(n)).toBe(true);
    }
  });
});
