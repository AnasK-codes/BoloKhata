import { describe, expect, it } from 'vitest';
import { correctDraft } from './correction';
import { hasCreditDetails } from './customerDetails';
import { getBalance, reverseEntry } from './ledger';
import type { DraftMessage } from '../protocol/server';
import type { CatalogProduct } from '../protocol/client';

const products: CatalogProduct[] = [
  { id: 'a', name: 'Aata', aliases: ['atta', 'आटा'], unit: 'kg', pricePerUnit: 45 },
  { id: 'm', name: 'Maggi', aliases: ['मैगी'], unit: 'packet', pricePerUnit: 14 },
];
const base: DraftMessage = {
  type: 'draft', draftId: 'draft', turnId: 1, source: 'rules', confidence: 1, intent: 'create_bill',
  customer: { id: 'c', name: 'Synthetic Customer', isNew: false }, unresolved: [], warnings: [], replyText: ['Bill check karo.'],
  bill: { items: [{ productId: 'a', name: 'Aata', unit: 'kg', quantity: 2, unitPrice: 45, lineTotal: 90 },
    { productId: 'm', name: 'Maggi', unit: 'packet', quantity: 1, unitPrice: 14, lineTotal: 14 }], total: 104, paid: 0, udhaar: 104 },
};

describe('voice draft correction', () => {
  it.each(['Aata teen kilo karo', 'Aata do nahi teen kilo karo', 'Aata do kilo nahi teen kilo karo', 'आटा तीन किलो करो'])('sets quantity: %s', (text) => {
    const result = correctDraft(base, text, products);
    expect(result?.applied).toBe(true);
    expect(result?.draft.bill).toMatchObject({ total: 149, udhaar: 149 });
    expect(result?.draft.bill?.items[0]?.quantity).toBe(3);
    expect(result?.draft.draftId).toBe(base.draftId);
    expect(base.bill?.total).toBe(104);
  });
  it('removes one item and adds to existing quantities', () => {
    expect(correctDraft(base, 'Maggi hata do', products)?.draft.bill?.total).toBe(90);
    expect(correctDraft(base, 'Ek Maggi aur jodo', products)?.draft.bill?.total).toBe(118);
  });
  it('converts units and rounds in the shared pricing function', () => {
    expect(correctDraft(base, 'Aata 500 gram karo', products)?.draft.bill?.items[0]).toMatchObject({ quantity: 0.5, lineTotal: 23 });
  });
  it('keeps fully paid bills fully paid and preserves partial payments', () => {
    const paid = { ...base, bill: { ...base.bill!, paid: 104, udhaar: 0 } };
    expect(correctDraft(paid, 'Aata teen kilo karo', products)?.draft.bill).toMatchObject({ paid: 149, udhaar: 0 });
    const partial = { ...base, bill: { ...base.bill!, paid: 50, udhaar: 54 } };
    expect(correctDraft(partial, 'Maggi hata do', products)?.draft.bill).toMatchObject({ paid: 50, udhaar: 40 });
  });
  it.each(['Cheeni hata do', 'Aata zero kilo karo', 'Aata 3 litre karo', 'Aata teen kilo aur Maggi hata do', 'Aata karo', 'Maggi mat hatao', 'Maggi nahi hatao', 'Aata ek kilo kam karo'])('rejects unsafe edits without changing the bill: %s', (text) => {
    const result = correctDraft(base, text, products);
    expect(result?.applied).toBe(false);
    expect(result?.draft.bill).toEqual(base.bill);
  });
  it('does not reinterpret an ordinary new order as an edit', () => {
    expect(correctDraft(base, 'do kilo aata', products)).toBeNull();
    expect(correctDraft(base, 'nahi', products)).toBeNull();
    expect(correctDraft(base, 'cancel kar do', products)).toBeNull();
  });
  it('allows removal of the last item, leaving an empty unconfirmable draft', () => {
    const only = { ...base, bill: { ...base.bill!, items: [base.bill!.items[0]!], total: 90, udhaar: 90 } };
    expect(correctDraft(only, 'Aata hata do', products)?.draft.bill?.items).toEqual([]);
  });
});

describe('customer credit details', () => {
  const synthetic = { name: 'Synthetic Customer', mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar' };
  it('requires all three validated fields', () => {
    expect(hasCreditDetails(synthetic)).toBe(true);
    expect(hasCreditDetails({ name: 'Synthetic Customer' })).toBe(false);
    expect(hasCreditDetails({ ...synthetic, mobile: '123' })).toBe(false);
    expect(hasCreditDetails({ ...synthetic, address: '  ' })).toBe(false);
  });
});

describe('financial reversals', () => {
  const original = { id: 'e', customerId: 'c', type: 'payment' as const, amount: 50, createdAt: 1 };
  it('appends an opposite entry and preserves the original', () => {
    const result = reverseEntry(original, [original], { id: 'r', createdAt: 2, note: 'Synthetic mistake' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toMatchObject({ type: 'udhaar', reversesEntryId: 'e', amount: 50 });
    expect(getBalance('c', [original, result.entry])).toBe(0);
    expect(reverseEntry(original, [original, result.entry], { id: 'r2', createdAt: 3 }).ok).toBe(false);
    expect(reverseEntry(result.entry, [original, result.entry], { id: 'r3', createdAt: 3 }).ok).toBe(false);
    expect(reverseEntry({ ...original, amount: -1 }, [], { id: 'bad', createdAt: 3 }).ok).toBe(false);
  });
});
