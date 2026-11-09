import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { parseRateAnswer } from './rateAnswer';
import { parseUtterance } from './ruleBased';

const parse = (t: string) => parseUtterance(t, seedIndex());
const rows = (t: string) => {
  const r = parse(t);
  return { intent: r.intent, rows: r.items.map((i) => [i.name, i.stock ?? null, i.unit, i.spokenPrice?.amount ?? null] as const) };
};

describe('add items with quantity and price to Samaan by voice', () => {
  it.each([
    ['samaan mein jodo chawal 10 kilo 40 rupaye kilo', 'Chawal', 10, 'kg', 40],
    ['naya item samaan mein jodo chawal 10 kilo 40 rupaye kilo', 'Chawal', 10, 'kg', 40],
    ['naya item samaan mai jodo rajma 5 kilo 120 rupaye kilo', 'Rajma', 5, 'kg', 120],
    ['samaan mein rajma 5 kilo 120 rupaye per kilo jodo', 'Rajma', 5, 'kg', 120],
    ['samaan mein jodo rajma 120 rupaye kilo 5 kilo', 'Rajma', 5, 'kg', 120],
    ['samaan mein Maggi 24 packet 14 rupaye packet jodo', 'Maggi', 24, 'packet', 14],
    ['samaan mein jodo tel 20 litre 180 rupaye litre', 'Tel', 20, 'l', 180],
    ['सामान में नया आइटम जोड़ो राजमा पाँच किलो एक सौ बीस रुपए किलो', 'राजमा', 5, 'kg', 120],
  ])('%s', (text, name, stock, unit, price) => {
    expect(rows(text)).toEqual({ intent: 'add_product', rows: [[name, stock, unit, price]] });
  });

  it('reads several items, each with its own quantity and rate', () => {
    expect(rows('naya item samaan mai jodo maida 20 kilo 35 rupaye kilo aur besan 10 kilo 80 rupaye kilo')).toEqual({
      intent: 'add_products',
      rows: [['Maida', 20, 'kg', 35], ['Besan', 10, 'kg', 80]],
    });
    expect(rows('samaan mein jodo sooji 15 kilo 52 rupaye kilo, rajma 5 kilo 120 rupaye kilo, Maggi 24 packet 14 rupaye packet')).toEqual({
      intent: 'add_products',
      rows: [['Sooji', 15, 'kg', 52], ['Rajma', 5, 'kg', 120], ['Maggi', 24, 'packet', 14]],
    });
  });

  it('a quantity of one is just the unit, not a stock count (as before)', () => {
    expect(rows('samaan mein ek litre tel 180 rupaye add karo')).toEqual({ intent: 'add_product', rows: [['Tel', null, 'l', 180]] });
  });

  it('keeps the old rule: a count with a price that has no unit of its own is ambiguous', () => {
    expect(parse('samaan mein do kilo chawal add karo 80 rupaye').intent).not.toBe('add_product');
  });

  it('a quantity without a rate is still an add request, so the rate can be asked for', () => {
    const r = parse('samaan mein rajma 5 kilo jodo');
    expect(r.intent).toBe('add_product');
    expect(r.items[0]).toMatchObject({ name: 'Rajma', stock: 5, unit: 'kg' });
    expect(r.items[0]?.spokenPrice).toBeUndefined();
  });

  it('a list where one item has no rate keeps the others and names the one to ask about', () => {
    const r = parse('samaan mein jodo maida 20 kilo 35 rupaye kilo aur sooji 10 kilo');
    expect(r.intent).toBe('add_products');
    expect(r.items.map((i) => i.name)).toEqual(['Maida']);
    expect(r.missingRate).toEqual([{ name: 'Sooji', unit: 'kg', stock: 10 }]);
  });

  it('does not hijack bills that name a price and a quantity', () => {
    expect(parse('do kilo chawal 110 rupaye').intent).toBe('create_bill');
    expect(parse('do kilo aata 90 rupaye aur ek kilo cheeni 50 rupaye').intent).toBe('create_bill');
  });
});

describe('khata means unpaid', () => {
  it.each([
    'khate mein do kilo aata jodo',
    'khate main jodo do kilo aata',
    'khate me jodo do kilo aata',
    'khata mein do kilo aata likho',
    'do kilo aata khate mein',
    'Sharma ji ke khate mein jodo do kilo cheeni',
    'Sharma ji ke khate main do kilo cheeni jodo',
  ])('%s', (text) => {
    const r = parse(text);
    expect(r.intent).toBe('create_bill');
    expect(r.creditAll).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('keeps the quantity when "do" comes right after jodo', () => {
    expect(parse('khate main jodo do kilo aata').items.map((i) => [i.name, i.quantity, i.unit])).toEqual([['aata', 2, 'kg']]);
    expect(parse('Sharma ji ke khate main jodo do kilo cheeni').customer).toBe('Sharma ji');
  });

  it('still reads "jod do" as the verb', () => {
    expect(parse('aata jod do').items.map((i) => [i.name, i.quantity])).toEqual([['aata', 1]]);
  });
});

describe('change a rate by voice', () => {
  it.each([
    ['chawal ka rate 45 karo', 'Chawal', 45],
    ['chawal ka rate badal ke 50 kar do', 'Chawal', 50],
    ['aata ka daam 50 rupaye kilo kar do', 'Aata', 50],
    ['aata ka rate ab 48 rupaye kilo ho gaya', 'Aata', 48],
    ['cheeni ke daam 52 rupaye kar do', 'Cheeni', 52],
    ['chawal ki kimat badal kar 55 rupaye kilo karo', 'Chawal', 55],
    ['चावल का रेट पैंतालीस रुपए कर दो', 'चावल', 45],
  ])('%s', (text, name, price) => {
    const r = parse(text);
    expect(r.intent).toBe('update_price');
    expect([r.items[0]?.name, r.items[0]?.spokenPrice?.amount]).toEqual([name, price]);
  });
});

describe('an answer to "rate bolo"', () => {
  it.each([
    ['120 rupaye kilo', 120, 'kg'],
    ['120 rupaye', 120, null],
    ['120', 120, null],
    ['ek sau bees rupaye kilo', 120, 'kg'],
    ['rate 120 rupaye per kilo hai', 120, 'kg'],
    ['40 rupaye packet', 40, 'packet'],
  ])('%s', (text, amount, unit) => {
    expect(parseRateAnswer(text)).toEqual({ amount, unit });
  });

  it.each(['aata do kilo', 'haan', 'cancel', '', 'ek kilo', 'Sharma ji ka udhaar'])('%s is not a rate', (text) => {
    expect(parseRateAnswer(text)).toBeNull();
  });
});
