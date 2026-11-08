/**
 * Regional words from Madhya Pradesh speech, mapped to the canonical Hinglish the rule parser
 * already understands. This is DATA: add rows, do not add code.
 *
 * Gnani has no dialect models (Prisma and Timbre support Hindi and nine other languages; see
 * docs/DIALECTS.md), so this is the only dialect support we have, and it works at the word level.
 *
 * Rules for adding a row:
 *   - `status: 'unverified'` until a native speaker of that dialect has confirmed the word AND its
 *     meaning in a shop context. Unverified rows apply only when the shopkeeper picks that dialect
 *     in Settings, never on "Auto".
 *   - `note` says where the word came from (a recorded synthetic sample, a named speaker check,
 *     a reference). Never invent a word to fill a gap.
 *   - Spell `words` the way Gnani Prisma writes them (Latin, as heard in transcripts; add a
 *     Devanagari form too if Prisma returns one).
 */
import type { Dialect } from '../protocol/common';

export type RegionalDialect = Exclude<Dialect, 'auto' | 'hinglish'>;

export interface DialectEntry {
  /** Spoken forms, as they appear in transcripts. */
  words: string[];
  /** What the parser understands instead (one or more canonical words). */
  canonical: string;
  dialects: RegionalDialect[];
  meaning: string;
  status: 'verified' | 'unverified';
  note: string;
}

export const DIALECT_LEXICON: readonly DialectEntry[] = [
  {
    words: ['hau', 'hao', 'haau', 'हौ', 'हओ'],
    canonical: 'haan',
    dialects: ['bundeli', 'bagheli', 'malwi'],
    meaning: 'yes',
    status: 'unverified',
    note: 'Widely reported yes-word in Bundelkhand and Baghelkhand speech; not yet checked with a native speaker for shop use.',
  },
  {
    words: ['naiyan', 'naiya', 'naiyaa', 'नइयाँ', 'नैयां'],
    canonical: 'nahi',
    dialects: ['bundeli'],
    meaning: 'no / is not',
    status: 'unverified',
    note: 'Bundeli negative ("is not"); needs a native check that it is used as a plain "no" when answering a question.',
  },
];
