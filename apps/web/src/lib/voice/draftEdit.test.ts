import { describe, expect, it } from 'vitest';
import type { CatalogCustomer, CatalogProduct } from '@bolbill/shared';
import { draftMessage } from '../turn/testing';
import { addProductToDraft, answerMissingItem, billFromProduct, dismissQuestion, draftFromTranscript, quantityChoices, removeItem, resolveItem, setAdjust, setCustomer, setItemQuantity, setPaid } from './draftEdit';

const products: CatalogProduct[] = [
  { id: 'p1', name: 'Aata', aliases: ['atta'], unit: 'kg', pricePerUnit: 45 },
  { id: 'p2', name: 'Cheeni', aliases: ['sugar'], unit: 'kg', pricePerUnit: 50 },
  { id: 'p3', name: 'Maggi', aliases: [], unit: 'packet', pricePerUnit: 14 },
];
const customers: CatalogCustomer[] = [{ id: 'c1', name: 'Sharma ji', aliases: [], balance: 0 }];

describe('quantity, removal and payment edits', () => {
  it('rebuilds the spoken-price example without any saved products', () => {
    const draft = draftFromTranscript(draftMessage(1), 'Do kilo chawal ₹110 ke, do Maggi ke packets ₹28 ke', [], []);
    expect(draft?.bill).toMatchObject({ total: 138, items: [{ lineTotal: 110 }, { lineTotal: 28 }] });
    expect(draft?.unresolved).toEqual([]);
  });
  it('keeps a fractional inferred unit rate exact when the quantity stepper is used', () => {
    const original = draftFromTranscript(draftMessage(1), 'Teen packet biscuit ₹50 ke', [], [])!;
    expect(original.bill?.items[0]?.unitPrice).toBeNull();
    expect(setItemQuantity(original, 0, 6).bill?.total).toBe(100);
    expect(original.bill?.total).toBe(50);
  });
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

describe('discount, GST and round-off edits', () => {
  it('applies a discount to the total and keeps a fully paid bill fully paid', () => {
    const base = setPaid(draftMessage(1), 90);
    expect(base.bill).toMatchObject({ total: 90, paid: 90, udhaar: 0 });
    const discounted = setAdjust(base, { discountAmount: 10 });
    expect(discounted.bill).toMatchObject({ total: 80, paid: 80, udhaar: 0, adjust: { discountAmount: 10 } });
  });

  it('keeps the amount already paid on a credit bill', () => {
    const credit = setPaid(draftMessage(1), 30);
    const discounted = setAdjust(credit, { discountAmount: 10 });
    expect(discounted.bill).toMatchObject({ total: 80, paid: 30, udhaar: 50 });
  });

  it('removes the adjustment when it is cleared and puts the total back', () => {
    const discounted = setAdjust(draftMessage(1), { discountAmount: 10 });
    const cleared = setAdjust(discounted, { roundOff: false });
    expect(cleared.bill?.adjust).toBeUndefined();
    expect(cleared.bill?.total).toBe(90);
  });

  it('keeps the adjustment through later quantity edits', () => {
    const discounted = setAdjust(draftMessage(1), { gstPercent: 5 });
    expect(setItemQuantity(discounted, 0, 4).bill).toMatchObject({ total: 189, adjust: { gstPercent: 5 } }); // 180 + 9
  });

  it('does nothing without a bill', () => {
    const noBill = { ...draftMessage(1) };
    delete noBill.bill;
    expect(setAdjust(noBill, { roundOff: true })).toBe(noBill);
  });

  it('reads a spoken adjustment when the transcript is corrected', () => {
    const draft = draftFromTranscript(draftMessage(1), 'do kilo aata paanch rupaye kam', products, customers);
    expect(draft?.bill).toMatchObject({ total: 85, adjust: { discountAmount: 5 } });
  });
});


describe('quick tiles: one tap adds a product', () => {
  const [aata, cheeni, maggi] = products as [CatalogProduct, CatalogProduct, CatalogProduct];

  it('starts a paid bill with one unit of the product at the catalog price', () => {
    const draft = billFromProduct(aata, 'new-id', 5);
    expect(draft).toMatchObject({ intent: 'create_bill', draftId: 'new-id', turnId: 5 });
    expect(draft.bill).toMatchObject({ total: 45, paid: 45, udhaar: 0 });
    expect(draft.bill?.items).toHaveLength(1);
    expect(draft.bill?.items[0]).toMatchObject({ productId: 'p1', quantity: 1, unit: 'kg', unitPrice: 45, lineTotal: 45 });
    expect(draft.unresolved).toEqual([]);
  });

  it('uses 100 for a gram or millilitre product, so one tap is a sensible amount', () => {
    const haldi: CatalogProduct = { id: 'p9', name: 'Haldi', aliases: [], unit: 'g', pricePerUnit: 1 };
    expect(billFromProduct(haldi, 'x', 0).bill?.items[0]).toMatchObject({ quantity: 100, lineTotal: 100 });
  });

  it('adds a different product as a new line and recomputes the total', () => {
    const next = addProductToDraft(billFromProduct(aata, 'd', 1), cheeni);
    expect(next.bill?.items.map((i) => i.productId)).toEqual(['p1', 'p2']);
    expect(next.bill).toMatchObject({ total: 95, paid: 95, udhaar: 0 });
  });

  it('raises the quantity when the same product is tapped again', () => {
    const twice = addProductToDraft(addProductToDraft(billFromProduct(maggi, 'd', 1), maggi), maggi);
    expect(twice.bill?.items).toHaveLength(1);
    expect(twice.bill?.items[0]).toMatchObject({ quantity: 3, lineTotal: 42 });
    expect(twice.bill?.total).toBe(42);
  });

  it('keeps udhaar and the customer when a tile is tapped on a credit bill', () => {
    const credit = draftMessage(1, { bill: { items: [{ productId: 'p1', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 }], total: 90, paid: 0, udhaar: 90 } });
    const next = addProductToDraft(credit, cheeni);
    expect(next.customer).toEqual(credit.customer);
    expect(next.bill).toMatchObject({ total: 140, paid: 0, udhaar: 140 });
  });

  it('does nothing to a draft that is not a bill', () => {
    const payment = draftMessage(1, { intent: 'record_payment', bill: undefined, payment: { amount: 100 } });
    expect(addProductToDraft(payment, aata)).toBe(payment);
  });
});

describe('answering the open question by tap', () => {
  const twoLines = () => addProductToDraft(draftMessage(1, { bill: { items: [], total: 0, paid: 0, udhaar: 0 } }), products[1]!);
  const askQty = { slot: 'quantity', itemIndex: 0, attempts: 1, fallback: false, transcript: 'thoda cheeni' } as const;

  it('a quantity chip on the line in question answers it', () => {
    const d = { ...twoLines(), clarification: askQty };
    const edited = setItemQuantity(d, 0, 2);
    expect(edited.clarification).toBeUndefined();
    expect(edited.bill?.items[0]?.quantity).toBe(2);
  });

  it('editing another line leaves the question open', () => {
    const d = addProductToDraft({ ...twoLines(), clarification: askQty }, products[0]!);
    expect(setItemQuantity(d, 1, 3).clarification).toEqual(askQty);
  });

  it('removing a line above the one in question keeps pointing at the right line', () => {
    const d = addProductToDraft(addProductToDraft(draftMessage(1, { bill: { items: [], total: 0, paid: 0, udhaar: 0 } }), products[0]!), products[1]!);
    const asked = { ...d, clarification: { ...askQty, itemIndex: 1 } };
    expect(removeItem(asked, 0).clarification).toMatchObject({ itemIndex: 0 });
    expect(removeItem(asked, 1).clarification).toBeUndefined();
  });

  it('picking a product for an unknown item answers it', () => {
    const d = draftMessage(1, {
      unresolved: [{ kind: 'item', spoken: 'kesar', quantity: 1, candidates: [] }],
      clarification: { slot: 'item', spoken: 'kesar', attempts: 2, fallback: true, transcript: 'kesar' },
    });
    expect(resolveItem(d, 0, products[2]!).clarification).toBeUndefined();
  });

  it('picking a product for a missing item adds it with the amount already heard', () => {
    const d = { ...twoLines(), clarification: { slot: 'item', quantity: 2, unit: 'kg', attempts: 1, fallback: false, transcript: 'do kilo' } as const };
    const answered = answerMissingItem(d, products[0]!);
    expect(answered.clarification).toBeUndefined();
    expect(answered.bill?.items.map((i) => [i.name, i.quantity])).toEqual([['Cheeni', 1], ['Aata', 2]]);
  });

  it('dismissing the question drops a missing item and an unknown one, keeping the rest', () => {
    const missing = { ...twoLines(), clarification: { slot: 'item', quantity: 2, unit: 'kg', attempts: 1, fallback: false, transcript: 'do kilo' } as const };
    expect(dismissQuestion(missing)).toMatchObject({ bill: { items: [{ name: 'Cheeni' }] } });
    expect(dismissQuestion(missing).clarification).toBeUndefined();
    const unknown = draftMessage(1, {
      unresolved: [{ kind: 'item', spoken: 'kesar', quantity: 1, candidates: [] }],
      clarification: { slot: 'item', spoken: 'kesar', attempts: 1, fallback: false, transcript: 'kesar' },
    });
    expect(dismissQuestion(unknown).unresolved).toEqual([]);
  });

  it('quantityChoices suits the unit', () => {
    expect(quantityChoices('kg')).toEqual([0.25, 0.5, 1, 2, 5]);
    expect(quantityChoices('g')).toEqual([100, 250, 500]);
    expect(quantityChoices('piece')).toEqual([1, 2, 5, 10]);
  });
});
