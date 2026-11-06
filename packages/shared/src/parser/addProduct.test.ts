import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { parseUtterance } from './ruleBased';

const parse = (t: string) => parseUtterance(t, seedIndex());

/** The one item of an add_product result: name, unit and the price per unit that was spoken. */
const product = (t: string) => {
  const r = parse(t);
  const item = r.items[0];
  return { intent: r.intent, name: item?.name, unit: item?.unit, price: item?.spokenPrice?.amount, count: r.items.length };
};

describe('add a product to Samaan by voice', () => {
  it('understands the real Devanagari transcript', () => {
    expect(product('सामान में। एक किलो चावल ले लो। चालीस रुपए के एक किलो।')).toEqual({
      intent: 'add_product', name: 'चावल', unit: 'kg', price: 40, count: 1,
    });
  });

  it.each([
    ['samaan mein chawal add karo 40 rupaye kilo', 'Chawal', 'kg', 40],
    ['naya samaan Maida 35 rupaye kilo', 'Maida', 'kg', 35],
    ['samaan mein Parle G jodo 10 rupaye packet', 'Parle G', 'packet', 10],
    ['Sooji 52 rupaye kilo samaan mein add karo', 'Sooji', 'kg', 52],
    ['सामान में मैदा जोड़ो पैंतीस रुपए किलो', 'मैदा', 'kg', 35],
    ['samaan mein ek litre tel 180 rupaye add karo', 'Tel', 'l', 180],
  ])('%s', (text, name, unit, price) => {
    expect(product(text)).toEqual({ intent: 'add_product', name, unit, price, count: 1 });
  });

  it('uses piece when no unit was spoken, so the card can show it', () => {
    expect(product('samaan mein Rusk add karo 20 rupaye')).toMatchObject({ intent: 'add_product', name: 'Rusk', unit: null, price: 20 });
  });

  it('needs a price', () => {
    expect(parse('samaan mein chawal add karo').intent).not.toBe('add_product');
  });

  it('needs a name', () => {
    expect(parse('samaan mein add karo 40 rupaye kilo').intent).not.toBe('add_product');
  });

  it('rejects a price for more than one unit, which would be ambiguous', () => {
    expect(parse('samaan mein do kilo chawal add karo 80 rupaye').intent).not.toBe('add_product');
  });

  it('does not hijack bills, customers, balances or payments', () => {
    expect(parse('do kilo chawal 110 rupaye').intent).toBe('create_bill');
    expect(parse('Sharma ji ka kitna udhaar hai').intent).toBe('query_balance');
    expect(parse('Verma ji ne do sau de diye').intent).toBe('record_payment');
    expect(parse('Ramesh Kumar ko customer mein add karo').intent).toBe('add_customer');
    expect(parse('aata khatam ho gaya').intent).toBe('out_of_stock');
  });
});
