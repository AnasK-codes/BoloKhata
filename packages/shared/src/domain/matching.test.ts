import { describe, expect, it } from 'vitest';
import { loadSeed, seedIndex } from '../testing/seed';
import { extractKeyterms, keytermsHeaderValue, MAX_KEYTERMS } from './keyterms';
import { CatalogIndex, damerauLevenshtein, devanagariToLatin, normalize } from './matching';

const index = seedIndex();

describe('seed catalog', () => {
  const seed = loadSeed();
  it('has about 40 products and 8 customers, all with unique ids', () => {
    expect(seed.products.length).toBeGreaterThanOrEqual(38);
    expect(seed.customers).toHaveLength(8);
    expect(new Set(seed.products.map((p) => p.id)).size).toBe(seed.products.length);
    expect(new Set(seed.customers.map((c) => c.id)).size).toBe(seed.customers.length);
  });
  it('uses integer rupee prices', () => {
    expect(seed.products.every((p) => Number.isInteger(p.pricePerUnit) && p.pricePerUnit > 0)).toBe(true);
  });
});

describe('normalize', () => {
  it.each([
    ['Aata', 'ata'],
    ['atta', 'ata'],
    ['aate', 'ate'],
    ['Cheeni', 'chini'],
    ['chini', 'chini'],
    ['Doodh', 'dudh'],
    ['dudh', 'dudh'],
    ['chawal', 'chaval'],
    ['Maggi!', 'magi'],
    ['  toor   dal ', 'tur dal'],
    ['Sharma ji', 'sharma'],
    ['Sharma uncle', 'sharma'],
    ['Gupta Sahab', 'gupta'],
    ['aloo', 'alu'],
    ['paneer', 'panir'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
  it('can keep honorifics', () => {
    expect(normalize('Sharma ji', { stripHonorifics: false })).toBe('sharma ji');
  });
  it('is safe for non-strings', () => {
    expect(normalize(undefined as unknown as string)).toBe('');
  });
});

describe('devanagariToLatin', () => {
  it.each([
    ['आटा', 'ata'],
    ['नमक', 'namak'],
    ['दूध', 'dudh'],
    ['चावल', 'chaval'],
    ['घी', 'ghi'],
    ['शर्मा', 'sharma'],
    ['तेल', 'tel'],
  ])('%s -> %s', (input, expected) => {
    expect(devanagariToLatin(input)).toBe(expected);
  });
  it('leaves Roman text alone', () => {
    expect(devanagariToLatin('aata')).toBe('aata');
  });
});

describe('damerauLevenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['abc', '', 3],
    ['namak', 'namka', 1],
    ['kitten', 'sitting', 3],
    ['ca', 'abc', 3],
  ])('%j vs %j = %i', (a, b, d) => {
    expect(damerauLevenshtein(a, b)).toBe(d);
  });
});

describe('matchProduct: should match', () => {
  it.each([
    ['aata', 'p_aata'],
    ['atta', 'p_aata'],
    ['aate', 'p_aata'],
    ['आटा', 'p_aata'],
    ['chawal', 'p_chawal'],
    ['chaval', 'p_chawal'],
    ['चावल', 'p_chawal'],
    ['chawal ka packet', 'p_chawal'],
    ['basmati', 'p_basmati'],
    ['basmati chawal', 'p_basmati'],
    ['cheeni', 'p_cheeni'],
    ['chini', 'p_cheeni'],
    ['sugar', 'p_cheeni'],
    ['maggi', 'p_maggi'],
    ['magi', 'p_maggi'],
    ['maggi noodles', 'p_maggi'],
    ['मैगी', 'p_maggi'],
    ['doodh', 'p_doodh'],
    ['dudh', 'p_doodh'],
    ['doodh ka packet', 'p_doodh'],
    ['toor dal', 'p_toor_dal'],
    ['tuvar dal', 'p_toor_dal'],
    ['arhar dal', 'p_toor_dal'],
    ['moong dal', 'p_moong_dal'],
    ['mung dal', 'p_moong_dal'],
    ['namak', 'p_namak'],
    ['namka', 'p_namak'],
    ['nimak', 'p_namak'],
    ['ghee', 'p_ghee'],
    ['ghi', 'p_ghee'],
    ['mirch', 'p_lal_mirch'],
    ['haldi', 'p_haldi'],
    ['aloo', 'p_aloo'],
    ['alu', 'p_aloo'],
    ['pyaz', 'p_pyaaz'],
    ['anda', 'p_ande'],
    ['sabun', 'p_nahane_sabun'],
    ['sarson ka tel', 'p_sarson_tel'],
    ['mustard oil', 'p_sarson_tel'],
  ])('%s -> %s', (query, id) => {
    const r = index.matchProduct(query);
    expect(r.best?.id).toBe(id);
    expect(r.ambiguous).toBe(false);
  });
});

describe('matchProduct: must NOT match', () => {
  it.each(['soda', 'telephone', 'laptop', 'xyz', 'ok', 'a', '12345', 'kal', 'rocket', 'ice cream'])(
    '%s has no confident match',
    (query) => {
      expect(index.matchProduct(query).best).toBeNull();
    },
  );
  it('does not mistake namkeen for namak', () => {
    expect(index.matchProduct('namkeen').best?.id).toBe('p_namkeen');
  });
  it('does not confuse short words (tel / dal)', () => {
    expect(index.matchProduct('tel').best?.id).not.toBe('p_toor_dal');
  });
});

describe('matchProduct: ambiguity and empty input', () => {
  it('flags several equally good candidates', () => {
    const r = index.matchProduct('dal');
    expect(r.ambiguous).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(2);
  });
  it('does not auto-pick for "tel"', () => {
    const r = index.matchProduct('tel');
    expect(r.ambiguous).toBe(true);
    expect(r.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(['p_sarson_tel', 'p_refined_tel']));
  });
  it.each(['', '   ', '...', undefined as unknown as string])('empty-ish input %j gives no candidates', (q) => {
    expect(index.matchProduct(q)).toEqual({ candidates: [], best: null, ambiguous: false });
  });
  it('sorts candidates best first and caps them at five', () => {
    const r = index.matchProduct('dal');
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    const scores = r.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

describe('matchCustomer', () => {
  it.each([
    ['Sharma ji', 'c_ramesh_sharma'],
    ['sharma', 'c_ramesh_sharma'],
    ['Sharma uncle', 'c_ramesh_sharma'],
    ['शर्मा जी', 'c_ramesh_sharma'],
    ['Ramesh Sharma', 'c_ramesh_sharma'],
    ['Verma ji', 'c_suresh_verma'],
    ['varma', 'c_suresh_verma'],
    ['Sunita aunty', 'c_sunita_devi'],
    ['sunita', 'c_sunita_devi'],
    ['Singh sahab', 'c_anil_singh'],
    ['joshi', 'c_kiran_joshi'],
    ['Pooja', 'c_pooja_nair'],
    ['Meena ji', 'c_meena_patel'],
  ])('%s -> %s', (query, id) => {
    const r = index.matchCustomer(query);
    expect(r.best?.id).toBe(id);
    expect(r.isNew).toBe(false);
  });
  it('flags a shared first name as ambiguous', () => {
    const r = index.matchCustomer('Ramesh');
    expect(r.ambiguous).toBe(true);
    expect(r.isNew).toBe(false);
    expect(r.candidates.map((c) => c.id)).toEqual(
      expect.arrayContaining(['c_ramesh_sharma', 'c_ramesh_gupta']),
    );
  });
  it.each(['Rajesh Khanna', 'Tiwari ji', 'Bholu'])('%s is a new customer', (name) => {
    const r = index.matchCustomer(name);
    expect(r.best).toBeNull();
    expect(r.isNew).toBe(true);
  });
  it('does not call an empty name a new customer', () => {
    expect(index.matchCustomer('').isNew).toBe(false);
    expect(index.matchCustomer('ji').isNew).toBe(false);
  });
});

describe('extra words around a real name', () => {
  it('filler words cost a little score, not the match', () => {
    expect(index.matchProduct('namkeen wala').best?.id).toBe('p_namkeen');
    expect(index.matchProduct('ek namkeen ka packet').best?.id).toBe('p_namkeen');
  });
  it('a real extra word means a different product: candidate only, never auto-picked', () => {
    const r = index.matchProduct('hari mirch');
    expect(r.best).toBeNull();
    expect(r.candidates[0]?.id).toBe('p_lal_mirch');
  });
});

describe('CatalogIndex', () => {
  it('looks products up by id', () => {
    expect(index.getProduct('p_aata')?.pricePerUnit).toBe(45);
    expect(index.getProduct('nope')).toBeUndefined();
  });
  it('works with an empty catalog', () => {
    const empty = new CatalogIndex([]);
    expect(empty.matchProduct('aata').best).toBeNull();
    expect(empty.matchCustomer('Sharma').isNew).toBe(true);
  });
});

describe('performance sanity', () => {
  it('1,000 varied lookups finish well under 50 ms (best of three runs)', () => {
    const queries = ['aata', 'chawal ka packet', 'toor dal', 'sharma ji', 'maggi', 'xyzzy', 'namak', 'doodh', 'kuch nahi', 'dal'];
    for (const q of queries) index.matchProduct(`${q} warm`); // JIT warm-up
    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const q = queries[i % queries.length] ?? '';
        index.matchProduct(`${q} ${i}`);
        if (i % 5 === 0) index.matchCustomer(`${q} ${i}`);
      }
      runs.push(performance.now() - start);
    }
    expect(Math.min(...runs)).toBeLessThan(50);
  });
});

describe('keyterms', () => {
  const seed = loadSeed();
  it('extracts deduplicated terms from names and aliases', () => {
    const terms = extractKeyterms(seed.products, seed.customers);
    expect(terms).toContain('Aata');
    expect(terms).toContain('आटा');
    expect(terms).toContain('Sharma ji');
    expect(new Set(terms.map((t) => t.toLowerCase())).size).toBe(terms.length);
  });
  it('caps the list at 200 by default and at a custom max', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ name: `Item${i}`, aliases: [] }));
    expect(extractKeyterms(many)).toHaveLength(MAX_KEYTERMS);
    expect(extractKeyterms(many, [], 5)).toHaveLength(5);
  });
  it('drops too-short and too-long terms', () => {
    const terms = extractKeyterms([{ name: 'a', aliases: ['x'.repeat(41), 'ok'] }]);
    expect(terms).toEqual(['ok']);
  });
  it('produces ASCII-only JSON with \\u escapes for Devanagari', () => {
    const value = keytermsHeaderValue(['आटा', 'aata']);
    expect(/^[\x20-\x7e]*$/.test(value)).toBe(true);
    expect(value).toContain('\\u0906');
    expect(JSON.parse(value)).toEqual(['आटा', 'aata']);
  });
});
