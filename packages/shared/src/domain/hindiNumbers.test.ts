import { describe, expect, it } from 'vitest';
import { parseNumber } from './numberWords';
import {
  DEVANAGARI_0_99,
  LATIN_0_99,
  VALUES_TO_REVIEW,
  amountToSpokenRupees,
  numberToHindiWords,
} from './hindiNumbers';

/**
 * Hand-checked table. Entries marked `review` are ones the author is less sure of
 * (spelling of the Roman form); they are also listed in VALUES_TO_REVIEW.
 */
const TABLE: ReadonlyArray<readonly [number, string]> = [
  [0, 'sifar'],
  [1, 'ek'],
  [2, 'do'],
  [5, 'paanch'],
  [6, 'chhah'],
  [9, 'nau'],
  [10, 'das'],
  [11, 'gyarah'],
  [14, 'chaudah'],
  [15, 'pandrah'],
  [18, 'atharah'],
  [19, 'unnis'],
  [20, 'bees'],
  [21, 'ikkis'],
  [22, 'baais'], // review
  [25, 'pachchis'],
  [28, 'atthais'],
  [29, 'untis'],
  [30, 'tees'],
  [32, 'battis'],
  [37, 'saintis'], // review
  [38, 'adtis'], // review
  [42, 'bayalis'],
  [45, 'paintalis'],
  [49, 'unchas'],
  [50, 'pachas'],
  [51, 'ikyavan'],
  [55, 'pachpan'],
  [59, 'unsath'],
  [60, 'saath'],
  [64, 'chaunsath'],
  [69, 'unhattar'],
  [70, 'sattar'],
  [75, 'pachhattar'],
  [79, 'unyasi'], // review
  [80, 'assi'],
  [85, 'pachasi'],
  [90, 'nabbe'],
  [91, 'ikyanve'],
  [99, 'ninyanve'], // review
  [100, 'ek sau'],
  [101, 'ek sau ek'],
  [110, 'ek sau das'],
  [250, 'do sau pachas'],
  [342, 'teen sau bayalis'],
  [500, 'paanch sau'],
  [999, 'nau sau ninyanve'],
  [1000, 'ek hazaar'],
  [1001, 'ek hazaar ek'],
  [1500, 'ek hazaar paanch sau'],
  [2000, 'do hazaar'],
  [3500, 'teen hazaar paanch sau'],
  [10000, 'das hazaar'],
  [12345, 'barah hazaar teen sau paintalis'],
  [99999, 'ninyanve hazaar nau sau ninyanve'],
  [100000, 'ek lakh'],
  [150000, 'ek lakh pachas hazaar'],
  [999999, 'nau lakh ninyanve hazaar nau sau ninyanve'],
  [1000000, 'das lakh'],
  [9999999, 'ninyanve lakh ninyanve hazaar nau sau ninyanve'],
  [10000000, 'ek crore'],
];

describe('numberToHindiWords (hand-checked table, Roman script)', () => {
  it('has at least 60 table entries', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
  });
  it.each(TABLE)('%i -> %s', (n, words) => {
    expect(numberToHindiWords(n, { script: 'latin' })).toBe(words);
  });
});

describe('numberToHindiWords (Devanagari)', () => {
  it.each([
    [0, 'शून्य'],
    [1, 'एक'],
    [42, 'बयालीस'],
    [100, 'एक सौ'],
    [342, 'तीन सौ बयालीस'],
    [1500, 'एक हज़ार पाँच सौ'],
    [100000, 'एक लाख'],
  ] as const)('%i -> %s', (n, words) => {
    const out = numberToHindiWords(n, { script: 'devanagari' });
    expect(out.normalize('NFC')).toBe(words.normalize('NFC'));
  });
});

describe('numberToHindiWords (defaults and invalid input)', () => {
  it('defaults to Roman script', () => {
    expect(numberToHindiWords(25)).toBe('pachchis');
  });
  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 1e12, 100 * 10_000_000])(
    'returns an empty string for %s instead of throwing',
    (bad) => {
      expect(numberToHindiWords(bad)).toBe('');
    },
  );
  it('returns an empty string for a non-number', () => {
    expect(numberToHindiWords('5' as unknown as number)).toBe('');
  });
});

describe('canonical tables', () => {
  it('have exactly 100 entries each, all non-empty and unique', () => {
    for (const table of [LATIN_0_99, DEVANAGARI_0_99]) {
      expect(table).toHaveLength(100);
      expect(new Set(table).size).toBe(100);
      expect(table.every((w) => w.length > 0)).toBe(true);
    }
  });
  it('list review values inside 0..99 and without duplicates', () => {
    expect(VALUES_TO_REVIEW.every((n) => n >= 0 && n <= 99)).toBe(true);
    expect(new Set(VALUES_TO_REVIEW).size).toBe(VALUES_TO_REVIEW.length);
  });
});

describe('round trip through parseNumber', () => {
  it('Roman script, 0..2000', () => {
    const failures: number[] = [];
    for (let n = 0; n <= 2000; n++) {
      if (parseNumber(numberToHindiWords(n, { script: 'latin' })) !== n) failures.push(n);
    }
    expect(failures).toEqual([]);
  });
  it('Devanagari, 0..2000', () => {
    const failures: number[] = [];
    for (let n = 0; n <= 2000; n++) {
      if (parseNumber(numberToHindiWords(n, { script: 'devanagari' })) !== n) failures.push(n);
    }
    expect(failures).toEqual([]);
  });
  it.each([2500, 12345, 99999, 100000, 123456, 999999, 1000000, 9999999, 10000000, 99999999])(
    'large value %i',
    (n) => {
      expect(parseNumber(numberToHindiWords(n))).toBe(n);
    },
  );
});

describe('amountToSpokenRupees', () => {
  it.each([
    [0, 'sifar rupaye'],
    [1, 'ek rupaya'],
    [2, 'do rupaye'],
    [11, 'gyarah rupaye'],
    [342, 'teen sau bayalis rupaye'],
    [100000, 'ek lakh rupaye'],
  ] as const)('%i -> %s', (n, spoken) => {
    expect(amountToSpokenRupees(n)).toBe(spoken);
  });
  it('supports Devanagari', () => {
    expect(amountToSpokenRupees(1, { script: 'devanagari' }).normalize('NFC')).toBe('एक रुपया');
    expect(amountToSpokenRupees(342, { script: 'devanagari' }).normalize('NFC')).toBe(
      'तीन सौ बयालीस रुपये',
    );
  });
  it.each([Number.NaN, -5, 2.5, Number.POSITIVE_INFINITY])('returns "" for %s', (bad) => {
    expect(amountToSpokenRupees(bad)).toBe('');
  });
});
