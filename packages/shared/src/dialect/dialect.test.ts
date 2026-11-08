import { describe, expect, it } from 'vitest';
import { DIALECTS } from '../protocol/common';
import { parseUtterance } from '../parser/ruleBased';
import { seedIndex } from '../testing/seed';
import { DIALECT_LEXICON, type DialectEntry } from './lexicon';
import { DIALECT_SUPPORT, applyDialect } from './dialect';

const verified: DialectEntry = { words: ['kitto'], canonical: 'kitna', dialects: ['malwi'], meaning: 'how much', status: 'verified', note: 'test entry' };
const unverified: DialectEntry = { words: ['hau'], canonical: 'haan', dialects: ['bundeli'], meaning: 'yes', status: 'unverified', note: 'test entry' };
const lexicon = [verified, unverified];

describe('applyDialect', () => {
  it('maps a regional word to its canonical form for the chosen dialect', () => {
    expect(applyDialect('Sharma ji ka kitto udhaar hai', 'malwi', lexicon)).toBe('Sharma ji ka kitna udhaar hai');
    expect(applyDialect('hau', 'bundeli', lexicon)).toBe('haan');
  });

  it('applies nothing for Hindi/Hinglish, and only that dialect\'s words otherwise', () => {
    expect(applyDialect('kitto hau', 'hinglish', lexicon)).toBe('kitto hau');
    expect(applyDialect('kitto hau', 'bundeli', lexicon)).toBe('kitto haan');
  });

  it('on auto, uses only verified words: an unchecked word must never turn into "haan" by itself', () => {
    expect(applyDialect('kitto hau', 'auto', lexicon)).toBe('kitna hau');
  });

  it('tolerates one STT slip in words of four letters or more, never in short ones', () => {
    expect(applyDialect('kito', 'malwi', lexicon)).toBe('kitna');
    expect(applyDialect('kitttoo', 'malwi', lexicon)).toBe('kitna'); // repeated letters fold away first
    expect(applyDialect('kitab', 'malwi', lexicon)).toBe('kitab'); // two edits away: a different word
    expect(applyDialect('hai', 'bundeli', lexicon)).toBe('hai');
  });

  it('never rewrites a common Hindi word, however close it is to a regional one', () => {
    expect(applyDialect('kitna aata', 'malwi', lexicon)).toBe('kitna aata');
  });

  it('keeps punctuation and Devanagari intact', () => {
    expect(applyDialect('हाँ, kitto?', 'malwi', lexicon)).toBe('हाँ, kitna?');
  });

  it('feeds the normal parser: a mapped "yes" confirms', () => {
    expect(parseUtterance(applyDialect('hau', 'bundeli', lexicon), seedIndex()).intent).toBe('confirm');
  });
});

describe('the shipped lexicon and support labels', () => {
  it('every entry names its dialects, a status and a note on where it came from', () => {
    for (const e of DIALECT_LEXICON) {
      expect(e.words.length, e.canonical).toBeGreaterThan(0);
      expect(e.dialects.length, e.canonical).toBeGreaterThan(0);
      expect(e.note.length, e.canonical).toBeGreaterThan(10);
    }
  });

  it('nothing is marked verified until a native speaker has checked it', () => {
    expect(DIALECT_LEXICON.filter((e) => e.status === 'verified')).toEqual([]);
  });

  it('labels every dialect honestly: only Hindi/Hinglish is fully supported', () => {
    for (const d of DIALECTS) expect(DIALECT_SUPPORT[d]).toBeDefined();
    expect(DIALECTS.filter((d) => DIALECT_SUPPORT[d].level === 'full')).toEqual(['auto', 'hinglish']);
  });
});
