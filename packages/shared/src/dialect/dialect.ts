/**
 * Dialect support at the parser layer: regional words become canonical Hinglish before the rule
 * parser sees the transcript. Pure and synchronous (a map lookup per word), so it adds no latency
 * worth measuring and never calls a model.
 */
import type { Dialect } from '../protocol/common';
import { damerauLevenshtein } from '../domain/matching';
import { fold } from '../parser/extras';
import { DIALECT_LEXICON, type DialectEntry } from './lexicon';

export interface DialectSupport {
  /** full: Gnani's own Hindi model. lexicon: regional words mapped by us. none: not supported. */
  level: 'full' | 'lexicon' | 'none';
  label: string;
  note: string;
}

/** What each setting really gives the shopkeeper. Shown in Settings and in docs/DIALECTS.md. */
export const DIALECT_SUPPORT: Readonly<Record<Dialect, DialectSupport>> = {
  auto: { level: 'full', label: 'Auto', note: 'Hindi/Hinglish by Gnani Prisma. Only checked regional words are added.' },
  hinglish: { level: 'full', label: 'Hindi / Hinglish', note: 'Gnani Prisma Hindi. No regional word list.' },
  malwi: { level: 'lexicon', label: 'Malwi', note: 'Hindi model plus a small regional word list that is not yet checked by a native speaker.' },
  nimadi: { level: 'lexicon', label: 'Nimadi', note: 'Hindi model only for now: the word list is empty until native samples are added.' },
  bundeli: { level: 'lexicon', label: 'Bundeli', note: 'Hindi model plus a small regional word list that is not yet checked by a native speaker.' },
  bagheli: { level: 'lexicon', label: 'Bagheli', note: 'Hindi model plus a small regional word list that is not yet checked by a native speaker.' },
};

/** Bhili / Bhilodi: listed so the app can say so plainly. */
export const UNSUPPORTED_SPEECH = ['Bhili / Bhilodi'] as const;

/** One spelling slip is tolerated only in words this long, so short words never change meaning. */
const FUZZY_MIN_LENGTH = 4;

interface Table {
  exact: Map<string, string>;
  fuzzy: { word: string; canonical: string }[];
}

const cache = new Map<string, Table>();

function tableFor(dialect: Dialect, lexicon: readonly DialectEntry[]): Table {
  const key = lexicon === DIALECT_LEXICON ? dialect : '';
  const hit = key ? cache.get(key) : undefined;
  if (hit) return hit;
  const exact = new Map<string, string>();
  const fuzzy: Table['fuzzy'] = [];
  for (const entry of lexicon) {
    const applies = dialect === 'auto' ? entry.status === 'verified' : (entry.dialects as readonly string[]).includes(dialect);
    if (!applies) continue;
    for (const word of entry.words) {
      const folded = fold(word);
      exact.set(folded, entry.canonical);
      if (folded.length >= FUZZY_MIN_LENGTH) fuzzy.push({ word: folded, canonical: entry.canonical });
    }
  }
  const table = { exact, fuzzy };
  if (key) cache.set(key, table);
  return table;
}

/** Words the parser already knows are never rewritten, however close they are to a regional word. */
const KNOWN = new Set(['kitna', 'kitni', 'kitne', 'haan', 'nahi', 'aata', 'hai', 'hain'].map(fold));

/**
 * Rewrites regional words in a transcript to canonical Hinglish for the chosen dialect. Everything
 * else (punctuation, Devanagari, unknown words) is left exactly as it was.
 */
export function applyDialect(text: string, dialect: Dialect, lexicon: readonly DialectEntry[] = DIALECT_LEXICON): string {
  if (dialect === 'hinglish' || typeof text !== 'string' || text === '') return text;
  const table = tableFor(dialect, lexicon);
  if (table.exact.size === 0) return text;
  return text.replace(/[\p{L}\p{M}]+/gu, (word) => {
    const folded = fold(word);
    const exact = table.exact.get(folded);
    if (exact !== undefined) return exact;
    if (folded.length < FUZZY_MIN_LENGTH || KNOWN.has(folded)) return word;
    const near = table.fuzzy.find((f) => Math.abs(f.word.length - folded.length) <= 1 && damerauLevenshtein(f.word, folded) <= 1);
    return near ? near.canonical : word;
  });
}
