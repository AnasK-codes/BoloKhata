import { describe, expect, it } from 'vitest';
import type { CatalogCustomer, CatalogProduct } from '@bolbill/shared';
import { draftMessage } from '../turn/testing';
import { draftFromTranscript, removeItem, resolveItem, setCustomer, setItemQuantity, setPaid } from './draftEdit';

const products: CatalogProduct[] = [
  { id: 'p1', name: 'Aata', aliases: ['atta'], unit: 'kg', pricePerUnit: 45 },
  { id: 'p2', name: 'Cheeni', aliases: ['sugar'], unit: 'kg', pricePerUnit: 50 },
  { id: 'p3', name: 'Maggi', aliases: [], unit: 'packet', pricePerUnit: 14 },
];
const customers: CatalogCustomer[] = [{ id: 'c1', name: 'Sharma ji', aliases: [], balance: 0 }];

describe('quantity, removal and payment edits', () => {
  it('reprices a line and the total with the shared rounding', () => {
    const edited = setItemQuantity(draftMessage(1), 0, 3);
    expect(edited.bill).toMatchObject({ total: 135, udhaar: 135 });
    expect(edited.bill?.items[0]).toMatchObject({ quantity: 3, lineTotal: 135 });
    expect(setItemQuantity(draftMessage(1), 0, 1.5).bill?.total).toBe(68); // 67.5 rounds half up
  });

  it('ignores impossible quantities and indexes', () => {
    const d = draftMessage(1);
    expect(setItemQuantity(d, 0, 0)).toBe(d);
    expect(setItemQuantity(d, 5, 2)).toBe(d);
    expect(removeItem(d, 9)).toBe(d);
  });

  it('removing the last item leaves an empty, unconfirmable bill', () => {
    expect(removeItem(draftMessage(1), 0).bill).toMatchObject({ items: [], total: 0, udhaar: 0 });
  });

  it('splits paid and udhaar, clamped to the total', () => {
    expect(setPaid(draftMessage(1), 40).bill).toMatchObject({ paid: 40, udhaar: 50 });
    expect(setPaid(draftMessage(1), 999).bill).toMatchObject({ paid: 90, udhaar: 0 });
    expect(setPaid(draftMessage(1), -5).bill).toMatchObject({ paid: 0, udhaar: 90 });
  });

  it('keeps paid when the total changes', () => {
    const edited = setItemQuantity(setPaid(draftMessage(1), 40), 0, 3);
    expect(edited.bill).toMatchObject({ total: 135, paid: 40, udhaar: 95 });
  });

  it('updates the readback sentence with the new numbers and never mutates the original', () => {
    const d = draftMessage(1);
    const before = JSON.stringify(d);
    const edited = setItemQuantity(d, 0, 3);
    expect(JSON.stringify(d)).toBe(before);
    expect(edited.replyText).not.toEqual(d.replyText);
    expect(edited.replyText.length).toBeGreaterThan(0);
  });
});

describe('resolving unresolved items', () => {
  const unresolved = { kind: 'item' as const, spoken: 'chini', quantity: 2, unit: 'kg' as const, candidates: [{ id: 'p2', name: 'Cheeni', score: 0.8 }] };

  it('adds the chosen product with the spoken quantity and clears the entry', () => {
    const draft = draftMessage(1, { unresolved: [unresolved] });
    const fixed = resolveItem(draft, 0, products[1]!);
    expect(fixed.unresolved).toEqual([]);
    expect(fixed.bill?.items.map((i) => i.name)).toEqual(['Aata', 'Cheeni']);
    expect(fixed.bill?.total).toBe(90 + 100);
  });

  it('builds a bill from nothing when every item was unresolved', () => {
    const draft = draftMessage(1, { bill: { items: [], total: 0, paid: 0, udhaar: 0 }, unresolved: [unresolved], warnings: ['The bill has no items.'] });
    const fixed = resolveItem(draft, 0, products[1]!);
    expect(fixed.bill).toMatchObject({ total: 100, udhaar: 100 });
    expect(fixed.warnings).toEqual([]);
  });

  it('converts units (grams to kilos) through shared code', () => {
    const grams = { ...unresolved, quantity: 500, unit: 'g' as const };
    const fixed = resolveItem(draftMessage(1, { unresolved: [grams] }), 0, products[1]!);
    expect(fixed.bill?.items[1]).toMatchObject({ quantity: 0.5, lineTotal: 25 });
  });

  it('leaves the draft alone for a bad index', () => {
    const d = draftMessage(1);
    expect(resolveItem(d, 3, products[0]!)).toBe(d);
  });
});

describe('customer edits', () => {
  it('sets an existing or new customer', () => {
    expect(setCustomer(draftMessage(1), { id: 'c1', name: 'Sharma ji', isNew: false }).customer).toEqual({ id: 'c1', name: 'Sharma ji', isNew: false });
    expect(setCustomer(draftMessage(1), { name: 'Naya', isNew: true }).customer).toEqual({ name: 'Naya', isNew: true });
  });
});

describe('draftFromTranscript', () => {
  it('re-parses corrected text with the shared parser and prices it from the catalog', () => {
    const base = draftMessage(4);
    const d = draftFromTranscript(base, 'Sharma ji ko do kilo cheeni udhaar likh do', products, customers);
    expect(d).toMatchObject({ intent: 'create_bill', draftId: base.draftId, turnId: 4, customer: { id: 'c1' } });
    expect(d?.bill?.items[0]).toMatchObject({ name: 'Cheeni', lineTotal: 100 });
    expect(d?.replyText.length).toBeGreaterThan(0);
  });

  it('reports a spoken name that matches nothing as unresolved, not invented', () => {
    const d = draftFromTranscript(draftMessage(4), 'Sharma ji ko do kilo xyzzy', products, customers);
    expect(d?.unresolved.some((u) => u.kind === 'item')).toBe(true);
    expect(d?.bill?.items).toEqual([]);
  });

  it('rebuilds a payment', () => {
    const d = draftFromTranscript(draftMessage(4, { intent: 'record_payment' }), 'Sharma ji ne do sau de diye', products, customers);
    expect(d).toMatchObject({ intent: 'record_payment', payment: { amount: 200 }, customer: { id: 'c1' } });
  });

  it('returns null for text that is neither', () => {
    expect(draftFromTranscript(draftMessage(4), 'haan', products, customers)).toBeNull();
    expect(draftFromTranscript(draftMessage(4), '', products, customers)).toBeNull();
  });
});
