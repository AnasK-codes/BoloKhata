import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { parseUtterance } from './ruleBased';

const parse = (t: string) => parseUtterance(t, seedIndex());
const list = (t: string) => {
  const r = parse(t);
  return { intent: r.intent, rows: r.items.map((i) => [i.name, i.unit, i.spokenPrice?.amount] as const) };
};

describe('add several products to Samaan in one sentence', () => {
  it('reads a comma-style list with units', () => {
    expect(list('samaan mein add karo aata 45 rupaye kilo, cheeni 50 rupaye kilo, Maggi 14 rupaye packet')).toEqual({
      intent: 'add_products',
      rows: [['Aata', 'kg', 45], ['Cheeni', 'kg', 50], ['Maggi', 'packet', 14]],
    });
  });

  it('reads a list without any punctuation or units (STT often drops both)', () => {
    expect(list('samaan mein jodo maida 35 sooji 52 besan 80')).toEqual({
      intent: 'add_products',
      rows: [['Maida', null, 35], ['Sooji', null, 52], ['Besan', null, 80]],
    });
  });

  it('reads Devanagari, including a price that is several words', () => {
    expect(list('सामान में जोड़ो मैदा पैंतीस रुपए किलो सूजी बावन रुपए किलो बेसन एक सौ बीस रुपए किलो')).toEqual({
      intent: 'add_products',
      rows: [['मैदा', 'kg', 35], ['सूजी', 'kg', 52], ['बेसन', 'kg', 120]],
    });
  });

  it('understands "ek kilo" before the name as the unit of that row', () => {
    expect(list('samaan mein ek kilo maida 35 rupaye aur ek packet Parle G 10 rupaye add karo')).toEqual({
      intent: 'add_products',
      rows: [['Maida', 'kg', 35], ['Parle G', 'packet', 10]],
    });
  });

  it('leaves a single product to add_product', () => {
    expect(parse('samaan mein maida add karo 35 rupaye kilo').intent).toBe('add_product');
  });

  it('refuses a list that ends with a name and no price, or repeats a name', () => {
    expect(parse('samaan mein jodo maida 35 sooji').intent).not.toBe('add_products');
    expect(parse('samaan mein jodo maida 35 maida 40').intent).not.toBe('add_products');
  });

  it('does not hijack a bill that lists several items', () => {
    expect(parse('do kilo aata 90 rupaye aur ek kilo cheeni 50 rupaye').intent).toBe('create_bill');
  });
});
