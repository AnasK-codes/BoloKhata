import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { parseUtterance } from './ruleBased';

const parse = (t: string) => parseUtterance(t, seedIndex());
const change = (t: string) => {
  const r = parse(t);
  const item = r.items[0];
  return { intent: r.intent, name: item?.name, price: item?.spokenPrice?.amount, unit: item?.unit ?? null, count: r.items.length };
};

describe('change a product rate by voice', () => {
  it.each([
    ['chawal ka rate 45 karo', 'Chawal', 45],
    ['chawal ka rate pachas rupaye kar do', 'Chawal', 50],
    ['aata ka bhav 48 rupaye karo', 'Aata', 48],
    ['cheeni ka daam ek sau paanch kar do', 'Cheeni', 105],
    ['चावल का रेट पैंतालीस रुपए कर दो', 'चावल', 45],
    ['आटे का दाम अड़तालीस कर दो', 'आटे', 48],
    ['Maggi ka rate ab 15 rupaye ho gaya', 'Maggi', 15],
  ])('%s', (text, name, price) => {
    expect(change(text)).toMatchObject({ intent: 'update_price', name, price, count: 1 });
  });

  it('keeps a spoken unit so the gateway can compare it with the product', () => {
    expect(change('chawal ka rate 45 rupaye kilo karo')).toMatchObject({ intent: 'update_price', price: 45, unit: 'kg' });
  });

  it('needs a rate word, a change word and a number', () => {
    expect(parse('chawal ka rate kya hai').intent).not.toBe('update_price');
    expect(parse('chawal ka rate karo').intent).not.toBe('update_price');
    expect(parse('chawal 45 karo').intent).not.toBe('update_price');
  });

  it('does not hijack bills, adds, balances or payments', () => {
    expect(parse('do kilo chawal 110 rupaye').intent).toBe('create_bill');
    expect(parse('samaan mein Maida add karo 35 rupaye kilo').intent).toBe('add_product');
    expect(parse('Sharma ji ka kitna udhaar hai').intent).toBe('query_balance');
    expect(parse('Verma ji ne do sau de diye').intent).toBe('record_payment');
  });
});
