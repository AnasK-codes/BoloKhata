import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { buildBill } from '../domain/pricing';
import { parseUtterance } from './ruleBased';

const index = seedIndex();
const parse = (t: string) => parseUtterance(t, index);

describe('discount, GST and round-off', () => {
  it('reads a rupee discount after the order', () => {
    const r = parse('do kilo aata paanch rupaye kam');
    expect(r.intent).toBe('create_bill');
    expect(r.adjust).toEqual({ discountAmount: 5 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.spokenPrice).toBeUndefined();
  });

  it('reads a percent discount with the word or the sign', () => {
    expect(parse('do kilo aata 10 percent discount').adjust).toEqual({ discountPercent: 10 });
    expect(parse('do kilo aata 10% discount').adjust).toEqual({ discountPercent: 10 });
    expect(parse('do kilo aata das percent chhoot').adjust).toEqual({ discountPercent: 10 });
  });

  it('reads a discount said before the amount', () => {
    expect(parse('do kilo aata discount 20 rupaye').adjust).toEqual({ discountAmount: 20 });
  });

  it('reads GST with its rate, before or after the word', () => {
    expect(parse('do kilo aata 5 percent GST').adjust).toEqual({ gstPercent: 5 });
    expect(parse('do kilo aata GST 18 percent').adjust).toEqual({ gstPercent: 18 });
  });

  it('never guesses a GST rate', () => {
    const r = parse('do kilo aata GST ke saath');
    expect(r.adjust).toBeUndefined();
    expect(r.adjustWarnings?.[0]).toMatch(/GST/);
  });

  it('ignores an impossible GST rate', () => {
    expect(parse('do kilo aata 90 percent GST').adjust?.gstPercent).toBeUndefined();
  });

  it('reads round-off without leaving "off" for the discount', () => {
    expect(parse('do kilo aata round off kar do').adjust).toEqual({ roundOff: true });
  });

  it('combines them', () => {
    expect(parse('do kilo aata paanch rupaye kam 5 percent GST round off').adjust).toEqual({ discountAmount: 5, gstPercent: 5, roundOff: true });
  });

  it('leaves ordinary orders without an adjustment', () => {
    expect(parse('do kilo aata aur ek packet Maggi').adjust).toBeUndefined();
  });

  it('feeds the shared pricing so the total is payable after adjustments', () => {
    const r = parse('do kilo aata paanch rupaye kam');
    const built = buildBill({ parsedItems: r.items, products: index, ...(r.adjust ? { adjust: r.adjust } : {}) });
    const subtotal = built.bill.items.reduce((sum, i) => sum + i.lineTotal, 0);
    expect(subtotal).toBeGreaterThan(5);
    expect(built.bill.total).toBe(subtotal - 5);
    expect(built.bill.adjust).toEqual({ discountAmount: 5 });
    expect(built.bill.paid + built.bill.udhaar).toBe(built.bill.total);
  });
});

describe('stock out', () => {
  it('recognises "khatam ho gaya"', () => {
    const r = parse('aata khatam ho gaya');
    expect(r.intent).toBe('out_of_stock');
    expect(r.items).toHaveLength(1);
    expect(index.matchProduct(r.items[0]?.name ?? '').best?.id).toBe('p_aata');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('recognises other phrasings', () => {
    expect(parse('chini khatam hai').intent).toBe('out_of_stock');
    expect(parse('Maggi khatam kar do').intent).toBe('out_of_stock');
  });

  it('does not treat a customer as a product', () => {
    expect(parse('Sharma ji ka udhaar khatam').intent).not.toBe('out_of_stock');
  });

  it('does not fire on amounts', () => {
    expect(parse('500 rupaye khatam').intent).not.toBe('out_of_stock');
  });
});

describe('summary question', () => {
  it('recognises today\'s sales', () => {
    expect(parse('aaj kitni bikri hui').intent).toBe('query_summary');
    expect(parse('aaj ka hisab batao').intent).toBe('query_summary');
  });

  it('recognises the total udhaar with no customer', () => {
    expect(parse('kul udhaar kitna baaki hai').intent).toBe('query_summary');
  });

  it('still answers a named customer\'s balance', () => {
    expect(parse('Sharma ji ka kitna udhaar hai').intent).toBe('query_balance');
  });

  it('is not triggered by an order', () => {
    expect(parse('do kilo aata').intent).toBe('create_bill');
  });
});
