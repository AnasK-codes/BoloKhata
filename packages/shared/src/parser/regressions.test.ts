import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { extractQuantityAndUnit, tokenizeSpeech } from '../domain/numberWords';
import { parseUtterance } from './ruleBased';

/**
 * Regressions found while chasing the "keeps asking and forgets" loop. Each one used to drop part
 * of what the shopkeeper said without telling them, so the follow-up question had nothing to build on.
 */
const index = seedIndex();
const parse = (t: string) => parseUtterance(t, index);
const items = (t: string) => parse(t).items.map((i) => [i.name, i.quantity, i.unit]);
const qty = (t: string) => {
  const q = extractQuantityAndUnit(tokenizeSpeech(t));
  return q && [q.quantity, q.unit];
};

describe('no item is dropped silently', () => {
  it('keeps every listed item, with the add verb at the end', () => {
    expect(items('cheeni aur aata add kardo')).toEqual([['cheeni', 1, null], ['aata', 1, null]]);
    expect(items('ek kilo cheeni aur do kilo aata add kardo')).toEqual([['cheeni', 1, 'kg'], ['aata', 2, 'kg']]);
  });

  it('keeps an item the catalog does not know, so the gateway can ask about it', () => {
    expect(items('ek kilo cheeni aur kesar add kardo')).toEqual([['cheeni', 1, 'kg'], ['kesar', 1, null]]);
  });

  it('does not turn filler in the first position into an item', () => {
    expect(parse('acha suno').intent).toBe('unknown');
  });

  it('marks a vague amount instead of guessing it silently', () => {
    const r = parse('ek kilo cheeni aur thoda aata');
    expect(r.items.map((i) => [i.name, i.quantityUnclear === true])).toEqual([['cheeni', false], ['aata', true]]);
  });

  it('reports a quantity that has no item name', () => {
    const r = parse('ek kilo cheeni aur do kilo add kardo');
    expect(items('ek kilo cheeni aur do kilo add kardo')).toEqual([['cheeni', 1, 'kg']]);
    expect(r.missingItems).toEqual([{ quantity: 2, unit: 'kg' }]);
    expect(r.intent).toBe('create_bill');
  });

  it('a bare quantity on its own is still not a bill', () => {
    const r = parse('ek kilo');
    expect(r.intent).toBe('unknown');
    expect(r.missingItems).toEqual([{ quantity: 1, unit: 'kg' }]);
  });
});

describe('Hindi quantity words', () => {
  it.each([
    ['sava kilo', [1.25, 'kg']],
    ['sawa kilo', [1.25, 'kg']],
    ['sava do kilo', [2.25, 'kg']],
    ['paune do kilo', [1.75, 'kg']],
    ['saade teen kilo', [3.5, 'kg']],
    ['dedh kilo', [1.5, 'kg']],
    ['dhai kilo', [2.5, 'kg']],
    ['aadha kilo', [0.5, 'kg']],
    ['paav', [250, 'g']],
    ['ek paav', [250, 'g']],
    ['do paav', [500, 'g']],
    ['paav kilo', [0.25, 'kg']],
    ['ek pav', [250, 'g']],
    ['पाव', [250, 'g']],
    ['ek darjan', [1, 'dozen']],
    ['250 gram', [250, 'g']],
  ])('%s', (text, expected) => {
    expect(qty(text)).toEqual(expected);
  });

  it('reads them inside an order', () => {
    expect(items('sava kilo cheeni')).toEqual([['cheeni', 1.25, 'kg']]);
    expect(items('paav cheeni')).toEqual([['cheeni', 250, 'g']]);
    expect(items('ek paav jeera aur dhai kilo aata')).toEqual([['jeera', 250, 'g'], ['aata', 2.5, 'kg']]);
  });

  it('does not read pav as a quantity on its own (it is also bread)', () => {
    expect(qty('pav')).toBeNull();
  });
});

describe('confirmation words', () => {
  it.each(['haan', 'हाँ', 'हां', 'han', 'ha', 'haa', 'haan ji', 'theek hai', 'ho gaya', 'haan ho gaya', 'kar do', 'ok'])('%s confirms', (t) => {
    expect(parse(t).intent).toBe('confirm');
  });
  it.each(['nahi', 'नहीं', 'ruko', 'cancel', 'rehne do', 'nahi chahiye', 'mat karo'])('%s cancels', (t) => {
    expect(parse(t).intent).toBe('cancel');
  });
  it('"nahi do kilo" is a correction, not an item called "nahi"', () => {
    const r = parse('nahi do kilo');
    expect(r.items.map((i) => i.name)).not.toContain('nahi');
  });
});
