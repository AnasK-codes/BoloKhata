import { describe, expect, it } from 'vitest';
import { AWAITING_LISTENING, KNOWN_BAD_SPELLINGS, PRONUNCIATION_OVERRIDES, prepareSpeechText } from './prepareSpeechText';
import { COVERED_BY, PRONUNCIATION_CORPUS, REAL_CONSONANT_TOKENS } from './pronunciationCorpus';
import { allSpokenStrings } from './spokenStrings';

describe('prepareSpeechText: sanitising', () => {
  it('normalises, strips control characters and markup, collapses spaces, limits length', () => {
    expect(prepareSpeechText('  Bill\u0007  <laugh>ready</laugh> [pause] ')).toBe('Bill ready');
    expect(prepareSpeechText('<x>')).toBeNull();
    expect(prepareSpeechText('a'.repeat(500))?.length).toBe(200);
    expect(prepareSpeechText('हाँ')).toBe('हाँ'.normalize('NFC'));
  });
});

describe('prepareSpeechText: pronunciation overrides', () => {
  const table = [
    { from: 'kar dun', to: 'कर दूँ', evidence: 'test' },
    { from: 'haan', to: 'हाँ', evidence: 'test' },
  ];
  it('replaces whole words and phrases, case-insensitively, keeping punctuation', () => {
    expect(prepareSpeechText('Save kar dun?', table)).toBe('Save कर दूँ?');
    expect(prepareSpeechText('Haan bolo ya confirm dabao.', table)).toBe('हाँ bolo ya confirm dabao.');
  });
  it('never touches a word that merely contains the spelling', () => {
    expect(prepareSpeechText('Unhe chhod dunga. Shaana haanji', table)).toBe('Unhe chhod dunga. Shaana haanji');
  });
  it('applies longer phrases before shorter ones', () => {
    const t = [{ from: 'dun', to: 'X', evidence: 'test' }, { from: 'kar dun', to: 'Y', evidence: 'test' }];
    expect(prepareSpeechText('kar dun, dun', t)).toBe('Y, X');
  });
});

describe('known-bad spellings are never forgotten', () => {
  it('each one is either fixed by a listened-to override or explicitly waiting for listening', () => {
    for (const bad of KNOWN_BAD_SPELLINGS) {
      const fixed = PRONUNCIATION_OVERRIDES.some((o) => o.from.toLowerCase() === bad.spelling);
      expect(fixed || AWAITING_LISTENING.includes(bad.spelling), bad.spelling).toBe(true);
    }
  });
  it('once fixed, no reply sends the bad spelling any more', () => {
    const fixed = KNOWN_BAD_SPELLINGS.filter((b) => !AWAITING_LISTENING.includes(b.spelling));
    for (const sentence of allSpokenStrings()) {
      const sent = (prepareSpeechText(sentence) ?? '').toLowerCase();
      for (const bad of fixed) expect(sent.includes(bad.spelling), `${sentence} -> ${sent}`).toBe(false);
    }
  });
  it('every override records where its listening result is written down', () => {
    for (const o of PRONUNCIATION_OVERRIDES) expect(o.evidence).toMatch(/TTS-TUNING\.md/);
  });
});

describe('the pronunciation sweep over every spoken string', () => {
  const tokens = new Set(allSpokenStrings().flatMap((s) => s.toLowerCase().split(/[^\p{L}\p{M}]+/u)).filter(Boolean));
  const looksNasal = (t: string) => /[ँं]/.test(t) || /[aeiou]n$/.test(t) || /n[bcdfghjklpqrstvwxz]/.test(t) || /[aeiou]m$/.test(t);
  const corpusWords = new Set(PRONUNCIATION_CORPUS.flatMap((e) => e.word.toLowerCase().split(' ')));

  it('finds no nasal-looking word that nobody has checked (add it to the corpus or the consonant list)', () => {
    const unchecked = [...tokens].filter(looksNasal).filter((t) => !corpusWords.has(t) && !REAL_CONSONANT_TOKENS.includes(t) && !(t in COVERED_BY));
    expect(unchecked).toEqual([]);
  });

  it('every corpus entry has today\'s spelling first and distinct candidates', () => {
    for (const e of PRONUNCIATION_CORPUS) {
      expect(new Set(e.candidates).size, e.id).toBe(e.candidates.length);
      expect(e.candidates.length, e.id).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(PRONUNCIATION_CORPUS.map((e) => e.id)).size).toBe(PRONUNCIATION_CORPUS.length);
  });

  it('every COVERED_BY points at a real corpus entry', () => {
    const ids = new Set(PRONUNCIATION_CORPUS.map((e) => e.id));
    for (const target of Object.values(COVERED_BY)) expect(ids.has(target), target).toBe(true);
  });

  it('the whole A/B fits in a small TTS budget', () => {
    const chars = PRONUNCIATION_CORPUS.flatMap((e) => e.candidates).reduce((n, c) => n + c.length, 0);
    expect(chars).toBeLessThan(1500);
  });
});
