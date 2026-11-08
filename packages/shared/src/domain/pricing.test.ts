import { describe, expect, it } from 'vitest';
import { loadSeed, seedIndex } from '../testing/seed';
import { buildBill, convertToMilli, lineTotal, type ParsedItem } from './pricing';

const seed = loadSeed();
const index = seedIndex();

const bill = (
  parsedItems: ParsedItem[],
  extra: { customerId?: string; amountPaid?: number | null; udhaarAmount?: number | null } = {},
) => buildBill({ parsedItems, products: index, ...extra });

const item = (name: string, quantity: number, unit: ParsedItem['unit']): ParsedItem => ({ name, quantity, unit });

describe('lineTotal (half up, integer maths)', () => {
  it.each([
    [500, 45, 23], // 22.5 -> 23
    [1000, 45, 45],
    [333, 45, 15], // 14.985 -> 15
    [1, 48, 0], // 0.048 -> 0
    [10, 50, 1], // 0.5 -> 1
    [9, 50, 0], // 0.45 -> 0
    [2000, 45, 90],
    [1500, 48, 72],
    [0, 45, 0],
  ])('%i milli x Rs %i = %i', (milli, price, expected) => {
    expect(lineTotal(milli, price)).toBe(expected);
  });
});

describe('convertToMilli', () => {
  it.each([
    [2, 'kg', 'kg', 2000],
    [500, 'g', 'kg', 500],
    [1.5, 'kg', 'g', 1_500_000],
    [750, 'ml', 'l', 750],
    [2, 'l', 'ml', 2_000_000],
    [1, 'dozen', 'piece', 12_000],
    [6, 'piece', 'dozen', 500],
    [3, 'packet', 'packet', 3000],
  ] as const)('%d %s -> %s = %d milli', (q, from, to, expected) => {
    expect(convertToMilli(q, from, to)).toBe(expected);
  });
  it.each([
    [1, 'kg', 'packet'],
    [1, 'l', 'piece'],
    [1, 'packet', 'piece'],
    [1, 'g', 'ml'],
  ] as const)('%d %s -> %s is impossible', (q, from, to) => {
    expect(convertToMilli(q, from, to)).toBeNull();
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects quantity %s', (q) => {
    expect(convertToMilli(q, 'kg', 'kg')).toBeNull();
  });
});

describe('buildBill: pricing and conversion', () => {
  it('prices a simple item', () => {
    const r = bill([item('aata', 2, 'kg')]);
    expect(r.bill.items).toEqual([
      { productId: 'p_aata', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 },
    ]);
    expect(r.bill.total).toBe(90);
    expect(r.unresolvedItems).toEqual([]);
    expect(r.needsReview).toBe(false);
  });
  it('uses the catalog unit when none was spoken', () => {
    expect(bill([item('aata', 3, null)]).bill.total).toBe(135);
  });
  it('converts grams to kilos and rounds the line half up', () => {
    const r = bill([item('aata', 500, 'g')]);
    expect(r.bill.items[0]?.quantity).toBe(0.5);
    expect(r.bill.total).toBe(23);
  });
  it('converts 250 g of ghee', () => {
    expect(bill([item('ghee', 250, 'g')]).bill.total).toBe(155);
  });
  it('handles half and decimal kilos', () => {
    expect(bill([item('cheeni', 1.5, 'kg')]).bill.total).toBe(72);
  });
  it('converts ml to litres', () => {
    expect(bill([item('doodh', 750, 'ml')]).bill.total).toBe(42);
  });
  it('converts pieces to dozens for eggs', () => {
    const r = bill([item('ande', 6, 'piece')]);
    expect(r.bill.items[0]).toMatchObject({ quantity: 0.5, unit: 'dozen', lineTotal: 42 });
  });
  it('converts dozens to pieces for piece-priced items', () => {
    expect(bill([item('sabun', 1, 'dozen')]).bill.total).toBe(456);
  });
  it('sums several lines', () => {
    const r = bill([item('aata', 2, 'kg'), item('maggi', 3, 'packet'), item('doodh', 1, 'l')]);
    expect(r.bill.total).toBe(90 + 42 + 56);
    expect(r.bill.items).toHaveLength(3);
  });
  it('rounds each line, not the sum', () => {
    const r = bill([item('aata', 333, 'g'), item('aata', 333, 'g')]);
    expect(r.bill.total).toBe(30);
  });
  it('may produce a zero-rupee line for a tiny quantity', () => {
    const r = bill([item('cheeni', 1, 'g')]);
    expect(r.bill.items[0]?.lineTotal).toBe(0);
    expect(r.bill.total).toBe(0);
  });
  it('handles large amounts without float drift', () => {
    const r = bill([item('ghee', 1000, 'kg')]);
    expect(r.bill.total).toBe(620_000);
  });
  it('accepts a plain product list as well as an index', () => {
    const r = buildBill({ parsedItems: [item('aata', 1, 'kg')], products: seed.products });
    expect(r.bill.total).toBe(45);
  });
});

describe('buildBill: things that cannot be priced', () => {
  it('sends impossible conversions to review with a warning', () => {
    const r = bill([item('maggi', 1, 'kg')]);
    expect(r.bill.items).toEqual([]);
    expect(r.unresolvedItems).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('cannot be converted');
    expect(r.needsReview).toBe(true);
  });
  it('does not guess unknown items', () => {
    const r = bill([item('laptop', 1, null)]);
    expect(r.unresolvedItems[0]).toMatchObject({ kind: 'item', spoken: 'laptop', quantity: 1, candidates: [] });
    expect(r.needsReview).toBe(true);
  });
  it('returns candidates for ambiguous items instead of picking one', () => {
    const r = bill([item('dal', 1, 'kg')]);
    expect(r.bill.items).toEqual([]);
    expect(r.unresolvedItems[0]?.candidates.length).toBeGreaterThan(1);
  });
  it.each([0, -2, Number.NaN])('rejects quantity %s', (q) => {
    const r = bill([item('aata', q, 'kg')]);
    expect(r.bill.items).toEqual([]);
    expect(r.unresolvedItems).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('not valid');
  });
  it('keeps resolved items and reports the rest', () => {
    const r = bill([item('aata', 1, 'kg'), item('laptop', 1, null)]);
    expect(r.bill.total).toBe(45);
    expect(r.unresolvedItems).toHaveLength(1);
  });
  it('warns on an empty bill', () => {
    const r = bill([]);
    expect(r.bill).toEqual({ items: [], total: 0, paid: 0, udhaar: 0 });
    expect(r.warnings).toContain('The bill has no items.');
  });
  it('limits the number of items', () => {
    const many = Array.from({ length: 45 }, () => item('aata', 1, 'kg'));
    const r = bill(many);
    // Only the first 40 spoken items are used (the same product merges into one line).
    expect(r.bill.items).toHaveLength(1);
    expect(r.bill.items[0]?.quantity).toBe(40);
    expect(r.needsReview).toBe(true);
  });
  it('limits the spoken text echoed back', () => {
    const r = bill([item('x'.repeat(500), 1, null)]);
    expect(r.unresolvedItems[0]?.spoken.length).toBeLessThanOrEqual(80);
  });
});

describe('buildBill: paid and udhaar reconciliation (total = 90)', () => {
  const base = [item('aata', 2, 'kg')];
  const cust = { customerId: 'c_ramesh_sharma' };

  it('assumes fully paid when neither is given', () => {
    expect(bill(base).bill).toMatchObject({ paid: 90, udhaar: 0 });
  });
  it('derives paid from udhaar', () => {
    expect(bill(base, { ...cust, udhaarAmount: 40 }).bill).toMatchObject({ paid: 50, udhaar: 40 });
  });
  it('derives udhaar from paid', () => {
    expect(bill(base, { ...cust, amountPaid: 50 }).bill).toMatchObject({ paid: 50, udhaar: 40 });
  });
  it('accepts consistent paid and udhaar silently', () => {
    const r = bill(base, { ...cust, amountPaid: 50, udhaarAmount: 40 });
    expect(r.bill).toMatchObject({ paid: 50, udhaar: 40 });
    expect(r.warnings).toEqual([]);
  });
  it('warns when paid and udhaar disagree and keeps udhaar', () => {
    const r = bill(base, { ...cust, amountPaid: 20, udhaarAmount: 40 });
    expect(r.bill).toMatchObject({ paid: 50, udhaar: 40 });
    expect(r.warnings.join(' ')).toContain('do not add up');
    expect(r.needsReview).toBe(true);
  });
  it('caps udhaar above the total', () => {
    const r = bill(base, { ...cust, udhaarAmount: 200 });
    expect(r.bill).toMatchObject({ paid: 0, udhaar: 90 });
    expect(r.warnings.join(' ')).toContain('reduced');
  });
  it('caps paid above the total', () => {
    const r = bill(base, { ...cust, amountPaid: 200 });
    expect(r.bill).toMatchObject({ paid: 90, udhaar: 0 });
    expect(r.needsReview).toBe(true);
  });
  it('allows zero udhaar and zero paid', () => {
    expect(bill(base, { ...cust, udhaarAmount: 0 }).bill).toMatchObject({ paid: 90, udhaar: 0 });
    expect(bill(base, { ...cust, amountPaid: 0 }).bill).toMatchObject({ paid: 0, udhaar: 90 });
  });
  it('needs a customer for udhaar', () => {
    const r = bill(base, { udhaarAmount: 40 });
    expect(r.warnings).toContain('Udhaar needs a customer.');
    expect(r.needsReview).toBe(true);
  });
  it.each([-5, Number.NaN, Number.POSITIVE_INFINITY])('ignores invalid udhaar %s', (bad) => {
    const r = bill(base, { ...cust, udhaarAmount: bad });
    expect(r.bill).toMatchObject({ paid: 90, udhaar: 0 });
    expect(r.warnings.join(' ')).toContain('not valid');
  });
  it('rounds a fractional amount to whole rupees', () => {
    expect(bill(base, { ...cust, udhaarAmount: 40.4 }).bill.udhaar).toBe(40);
  });
  it('paid + udhaar always equals the total', () => {
    for (const udhaar of [0, 1, 45, 89, 90, 91, 1000]) {
      const b = bill(base, { ...cust, udhaarAmount: udhaar }).bill;
      expect(b.paid + b.udhaar).toBe(b.total);
    }
  });
});

describe('vague amounts', () => {
  it('reports which bill lines had a vague amount, by their index in the bill', () => {
    const r = buildBill({
      parsedItems: [{ name: 'kesar', quantity: 1, unit: null }, { name: 'cheeni', quantity: 1, unit: 'kg' }, { name: 'aata', quantity: 1, unit: null, quantityUnclear: true }],
      products: seedIndex(),
    });
    expect(r.bill.items.map((i) => i.name)).toEqual(['Cheeni', 'Aata']);
    expect(r.unclearQuantity).toEqual([1]);
  });
});

describe('the same product said twice', () => {
  it('becomes one line with the quantities added, not two lines with the same product', () => {
    const r = buildBill({ parsedItems: [{ name: 'aata', quantity: 2, unit: 'kg' }, { name: 'cheeni', quantity: 1, unit: null }, { name: 'atta', quantity: 500, unit: 'g' }], products: seedIndex() });
    expect(r.bill.items.map((i) => [i.name, i.quantity])).toEqual([['Aata', 2.5], ['Cheeni', 1]]);
    expect(r.bill.total).toBe(Math.round(2.5 * 45) + 48);
  });
  it('a vague amount on a merged line is still flagged at the merged index', () => {
    const r = buildBill({ parsedItems: [{ name: 'cheeni', quantity: 1, unit: 'kg' }, { name: 'aata', quantity: 1, unit: null, quantityUnclear: true }, { name: 'aata', quantity: 1, unit: null }], products: seedIndex() });
    expect(r.bill.items).toHaveLength(2);
    expect(r.unclearQuantity).toEqual([1]);
  });
});

describe('whole bill on credit', () => {
  const items = [{ name: 'aata', quantity: 2, unit: 'kg' as const }];
  it('puts the whole total on udhaar when no amounts were said', () => {
    expect(buildBill({ parsedItems: items, products: seedIndex(), creditAll: true }).bill).toMatchObject({ total: 90, paid: 0, udhaar: 90 });
  });
  it('a paid amount still wins: "sau diye, baaki udhaar"', () => {
    expect(buildBill({ parsedItems: items, products: seedIndex(), creditAll: true, amountPaid: 40 }).bill).toMatchObject({ paid: 40, udhaar: 50 });
  });
  it('without the flag a bill with no amounts is cash, as before', () => {
    expect(buildBill({ parsedItems: items, products: seedIndex() }).bill).toMatchObject({ paid: 90, udhaar: 0 });
  });
});
