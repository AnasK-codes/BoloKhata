import { describe, expect, it } from 'vitest';
import {
  NUMBER_TABLE_CONFLICTS,
  extractQuantityAndUnit,
  normalizeUnit,
  parseNumber,
} from './numberWords';

describe('parseNumber: digits', () => {
  it.each([
    ['2', 2],
    ['250', 250],
    ['2.5', 2.5],
    ['0.75', 0.75],
    ['1,500', 1500],
    ['  7 ', 7],
    ['१२', 12],
    ['२.५', 2.5],
    ['2 sau', 200],
    ['2 hazaar', 2000],
    ['1.5 lakh', 150000],
    ['1.1 sau', 110],
  ])('%s -> %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parseNumber: Roman-script words', () => {
  it.each([
    ['ek', 1],
    ['do', 2],
    ['teen', 3],
    ['tin', 3],
    ['char', 4],
    ['chaar', 4],
    ['panch', 5],
    ['paanch', 5],
    ['chhe', 6],
    ['chhah', 6],
    ['saat', 7],
    ['aath', 8],
    ['nau', 9],
    ['das', 10],
    ['gyarah', 11],
    ['pandrah', 15],
    ['unnis', 19],
    ['bees', 20],
    ['ikkis', 21],
    ['pachchis', 25],
    ['bayalis', 42],
    ['pachas', 50],
    ['nabbe', 90],
    ['ninyanve', 99],
    ['sifar', 0],
    ['Do Sau Pachas', 250],
    ['do, sau pachas.', 250],
  ])('%s -> %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parseNumber: compounds', () => {
  it.each([
    ['sau', 100],
    ['hazaar', 1000],
    ['ek sau', 100],
    ['ek sau ek', 101],
    ['paanch sau', 500],
    ['do sau pachas', 250],
    ['pachas sau', 5000],
    ['do hazaar', 2000],
    ['teen hazaar paanch sau', 3500],
    ['ek lakh', 100000],
    ['do lakh pachas hazaar', 250000],
    ['ek crore', 10000000],
    ['ek lakh pachas hazaar do sau pachas', 150250],
  ])('%s -> %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parseNumber: fractions', () => {
  it.each([
    ['aadha', 0.5],
    ['adha', 0.5],
    ['dedh', 1.5],
    ['dhai', 2.5],
    ['sawa', 1.25],
    ['paune', 0.75],
    ['saade teen', 3.5],
    ['sawa do', 2.25],
    ['paune do', 1.75],
    ['dedh sau', 150],
    ['dhai sau', 250],
    ['sawa sau', 125],
    ['paune do sau', 175],
    ['saade teen sau', 350],
    ['saade teen hazaar', 3500],
    ['dedh hazaar', 1500],
  ])('%s -> %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parseNumber: English number words from mixed speech', () => {
  it.each([
    ['one', 1],
    ['two', 2],
    ['ten', 10],
    ['half', 0.5],
    ['two hundred', 200],
    ['five hundred fifty', null],
  ])('%s -> %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parseNumber: Devanagari', () => {
  it.each([
    ['एक', 1],
    ['दो', 2],
    ['तीन', 3],
    ['बयालीस', 42],
    ['दो सौ पचास', 250],
    ['डेढ़ सौ', 150],
    ['ढाई सौ', 250],
    ['सवा सौ', 125],
    ['तीन हज़ार पाँच सौ', 3500],
    ['तीन हजार पांच सौ', 3500],
    ['आधा', 0.5],
    ['एक लाख', 100000],
    ['साढ़े तीन', 3.5],
    ['पौने दो', 1.75],
  ])('%s -> %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('parseNumber: rejects what it cannot understand', () => {
  it.each([
    '',
    '   ',
    'abc',
    'do abc',
    'do teen',
    'ek ek',
    'sau sau',
    'do sau teen sau',
    'aadha aadha',
    'sawa sawa',
    'hazaar lakh',
    'kilo',
    'NaN',
    '-',
    '99999999999999999999',
  ])('"%s" -> null', (text) => {
    expect(parseNumber(text)).toBeNull();
  });
  it('returns null for a non-string instead of throwing', () => {
    expect(parseNumber(undefined as unknown as string)).toBeNull();
    expect(parseNumber(5 as unknown as string)).toBeNull();
  });
});

describe('number table integrity', () => {
  it('has no word mapped to two different values', () => {
    expect(NUMBER_TABLE_CONFLICTS).toEqual([]);
  });
});

describe('normalizeUnit', () => {
  it.each([
    ['kg', 'kg'],
    ['kilo', 'kg'],
    ['kilogram', 'kg'],
    ['किलो', 'kg'],
    ['g', 'g'],
    ['gm', 'g'],
    ['gram', 'g'],
    ['ग्राम', 'g'],
    ['l', 'l'],
    ['ltr', 'l'],
    ['litre', 'l'],
    ['liter', 'l'],
    ['लीटर', 'l'],
    ['ml', 'ml'],
    ['piece', 'piece'],
    ['pcs', 'piece'],
    ['पीस', 'piece'],
    ['packet', 'packet'],
    ['pkt', 'packet'],
    ['पैकेट', 'packet'],
    ['dozen', 'dozen'],
    ['darjan', 'dozen'],
    ['दर्जन', 'dozen'],
  ])('%s -> %s', (alias, unit) => {
    expect(normalizeUnit(alias)).toBe(unit);
  });
  it('returns null for words that are not units', () => {
    expect(normalizeUnit('aata')).toBeNull();
    expect(normalizeUnit('')).toBeNull();
  });
});

describe('extractQuantityAndUnit', () => {
  it.each([
    [['do', 'kilo', 'aata'], 2, 'kg', 2],
    [['aadha', 'kilo', 'cheeni'], 0.5, 'kg', 2],
    [['dedh', 'kilo'], 1.5, 'kg', 2],
    [['do', 'packet', 'maggi'], 2, 'packet', 2],
    [['paanch', 'sau', 'gram', 'dal'], 500, 'g', 3],
    [['dhai', 'sau', 'ml'], 250, 'ml', 3],
    [['ek', 'litre', 'doodh'], 1, 'l', 2],
    [['teen', 'pcs'], 3, 'piece', 2],
    [['ek', 'darjan', 'ande'], 1, 'dozen', 2],
    [['2', 'pkt'], 2, 'packet', 2],
    [['2kg', 'aata'], 2, 'kg', 1],
    [['500gm'], 500, 'g', 1],
    [['1.5ltr'], 1.5, 'l', 1],
    [['दो', 'किलो', 'आटा'], 2, 'kg', 2],
    [['Do', 'KILO'], 2, 'kg', 2],
  ])('%j', (tokens, quantity, unit, consumed) => {
    expect(extractQuantityAndUnit(tokens)).toEqual({ quantity, unit, consumed });
  });

  it('returns a null unit when none follows (caller decides the default)', () => {
    expect(extractQuantityAndUnit(['do', 'maggi'])).toEqual({
      quantity: 2,
      unit: null,
      consumed: 1,
    });
  });
  it('stops at the longest valid number prefix', () => {
    expect(extractQuantityAndUnit(['do', 'teen', 'kilo'])).toEqual({
      quantity: 2,
      unit: null,
      consumed: 1,
    });
  });
  it.each([[[]], [['kilo', 'aata']], [['aata']], [['']]])('%j -> null', (tokens) => {
    expect(extractQuantityAndUnit(tokens)).toBeNull();
  });
});
