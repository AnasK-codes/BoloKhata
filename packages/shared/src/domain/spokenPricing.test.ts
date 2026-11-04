import { describe, expect, it } from 'vitest';
import { parseUtterance } from '../parser/ruleBased';
import { buildBill, repriceBillItem } from './pricing';
import { CatalogIndex } from './matching';
import type { CatalogProduct } from '../protocol/client';
import { correctDraft } from './correction';
import type { DraftMessage } from '../protocol/server';

const catalog: CatalogProduct[] = [{ id: 'rice', name: 'Chawal', aliases: ['rice'], unit: 'kg', pricePerUnit: 60 }];
function bill(text: string, products: CatalogProduct[] = []) {
  const parsed = parseUtterance(text, new CatalogIndex(products));
  return { parsed, ...buildBill({ parsedItems: parsed.items, products }) };
}

describe('spoken prices without a predefined catalog', () => {
  it.each([
    'Do kilo chawal ₹110 ke, do Maggi ke packets ₹28 ke.',
    'Do kilo chawal 110 rupaye aur do Maggi packets 28 rupaye',
    'Do kilo chawal ek sau das rupaye aur do packet Maggi athais rupaye',
    'दो किलो चावल ११० रुपये और दो मैगी के पैकेट २८ रुपये',
    'Do kilo chawal 110 ke aur do Maggi packets 28 ke',
  ])('prices the entire example deterministically: %s', (text) => {
    const result = bill(text);
    expect(result.parsed.intent).toBe('create_bill');
    expect(result.bill.items).toHaveLength(2);
    expect(result.bill.items.map((i) => [i.quantity, i.unit, i.lineTotal])).toEqual([[2, 'kg', 110], [2, 'packet', 28]]);
    expect(result.bill).toMatchObject({ total: 138, paid: 138, udhaar: 0 });
    expect(result.unresolvedItems).toEqual([]);
    expect(result.parsed.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it.each(['Do kilo chawal ₹55 per kilo', 'Do kilo chawal 55 rupaye kilo', 'Do kilo chawal per kilo 55 rupaye'])('distinguishes a unit rate from line total: %s', (text) => {
    expect(bill(text).bill).toMatchObject({ total: 110, items: [{ unitPrice: 55, spokenPrice: { basis: 'unit', amount: 55 } }] });
  });
  it('handles gram-to-kilo rates and shared whole-rupee rounding', () => {
    expect(bill('500 gram chawal ₹55 per kilo').bill.total).toBe(28);
  });
  it('uses a spoken override for this bill without mutating saved catalog rates', () => {
    const result = bill('Do kilo chawal ₹110 ke', catalog);
    expect(result.bill.items[0]).toMatchObject({ productId: 'rice', lineTotal: 110 });
    expect(catalog[0]?.pricePerUnit).toBe(60);
    expect(bill('Do kilo chawal', catalog).bill.total).toBe(120);
  });
  it('does not invent a rate for a new item with no spoken price', () => {
    expect(bill('Do kilo chawal').unresolvedItems).toHaveLength(1);
  });
  it('keeps a bundle total exact even when the unit rate is fractional', () => {
    const result = bill('Teen packet biscuit ₹50 ke');
    const item = result.bill.items[0]!;
    expect(item).toMatchObject({ quantity: 3, lineTotal: 50, unitPrice: null });
    expect(repriceBillItem(item, 6)?.lineTotal).toBe(100);
    expect(repriceBillItem(item, 1)?.lineTotal).toBe(17);
  });
  it('preserves explicit prices while correcting an item missing from the catalog', () => {
    const result = bill('Do kilo chawal ₹110 ke');
    const draft: DraftMessage = { type: 'draft', turnId: 1, draftId: 'd', intent: 'create_bill', source: 'rules', confidence: 1, bill: result.bill, unresolved: [], warnings: [], replyText: ['Check bill'] };
    expect(correctDraft(draft, 'Chawal teen kilo karo', [])?.draft.bill?.total).toBe(165);
    expect(correctDraft(draft, 'Chawal hata do', [])?.draft.bill?.items).toEqual([]);
  });
  it.each(['Do kilo chawal ₹27.50 ke', 'Do kilo chawal ₹-10 ke', 'Do kilo chawal -₹10 ke', 'Do kilo chawal ₹55 per', 'Do kilo chawal ₹55 per packet'])('flags invalid amounts or incompatible rate units: %s', (text) => {
    const result = bill(text);
    expect(result.needsReview).toBe(true);
    expect(result.bill.items).toHaveLength(0);
  });
  it('keeps paid/credit amounts separate from item prices', () => {
    const parsed = parseUtterance('Do kilo chawal ₹110 ke aur do Maggi packets ₹28 ke, 100 paid');
    const result = buildBill({ parsedItems: parsed.items, products: [], amountPaid: parsed.amount_paid });
    expect(result.bill).toMatchObject({ total: 138, paid: 100, udhaar: 38 });
  });
});
