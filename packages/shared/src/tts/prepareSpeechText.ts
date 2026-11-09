/**
 * The ONLY place that decides what text goes to Gnani Timbre. The gateway's TTS link runs every
 * sentence through this function, and a test fails if any other code builds a synthesis request.
 *
 * It does two things:
 *   1. Sanitises untrusted text: NFC, no control characters, no markup (so a name can never inject
 *      an audio tag such as <laugh>), collapsed spaces, length limit.
 *   2. Applies per-word pronunciation overrides: our canonical readback spelling -> the spelling
 *      Timbre pronounces correctly.
 *
 * Overrides are added ONLY from listening results recorded in docs/TTS-TUNING.md. Nobody picks a
 * winning spelling by guessing: the trailing-"n" problem (haan heard as "हान", kar dun heard as
 * "kardunn") was confirmed by ear, and its fix must be confirmed the same way.
 */
import { LIMITS } from '../protocol/constants';

export interface PronunciationOverride {
  /** The canonical spelling in our templates (a word or short phrase, matched case-insensitively). */
  from: string;
  /** What Timbre is sent instead. */
  to: string;
  /** Where the decision is recorded, e.g. "TTS-TUNING.md #2". */
  evidence: string;
}

/**
 * Winners from listening, in the order they are applied (longer phrases first). Empty until the
 * listening sheet from `pnpm spike --only P` has been judged by a person.
 */
export const PRONUNCIATION_OVERRIDES: readonly PronunciationOverride[] = [
  // Reported by a person on 2026-11-09 with the spelling they expect to hear. The Devanagari form
  // names the exact sounds (जोड़ूँ ends in a nasal vowel; दबाओ starts with a dental द, not ड).
  // Applied on their report; the clips that confirm it by ear are in docs/TTS-TUNING.md.
  { from: 'jodun', to: 'जोड़ूँ', evidence: 'TTS-TUNING.md "Reported 2026-11-09": jodun' },
  { from: 'dabao', to: 'दबाओ', evidence: 'TTS-TUNING.md "Reported 2026-11-09": dabao' },
  // Still heard as हान after the first round; the person said it should be हाँ (a soft nasal vowel).
  { from: 'haan', to: 'हाँ', evidence: 'TTS-TUNING.md "Reported 2026-11-09": haan' },
];

/**
 * Spellings a person has heard Timbre mispronounce, as sent today. Each must either get an
 * override above or stay in AWAITING_LISTENING; a test enforces that.
 */
export const KNOWN_BAD_SPELLINGS: readonly { spelling: string; heard: string }[] = [
  { spelling: 'kar dun', heard: 'kardunn: an extra hard "n" at the end (should be a soft nasal "kar dū̃")' },
  { spelling: 'haan', heard: 'हान: a hard "n" consonant instead of the nasal vowel हाँ' },
  { spelling: 'jodun', heard: 'जोडून: a hard n and a retroflex ड (should be जोड़ूँ)' },
  { spelling: 'dabao', heard: 'डबाओ: a retroflex ड (should be a dental द: दबाओ)' },
];

/** Known-bad spellings whose fix is waiting for a person to judge the A/B clips. */
export const AWAITING_LISTENING: readonly string[] = ['kar dun'];

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;
const LETTER = '[\\p{L}\\p{M}]';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(overrides: readonly PronunciationOverride[]): { re: RegExp; to: string }[] {
  return [...overrides]
    .sort((a, b) => b.from.length - a.from.length)
    .map((o) => ({ re: new RegExp(`(?<!${LETTER})${escapeRegExp(o.from.normalize('NFC'))}(?!${LETTER})`, 'giu'), to: o.to.normalize('NFC') }));
}

const COMPILED = compile(PRONUNCIATION_OVERRIDES);

/** Sanitised, pronunciation-corrected text for Timbre, or null when nothing speakable is left. */
export function prepareSpeechText(raw: string, overrides?: readonly PronunciationOverride[]): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  for (const { re, to } of overrides ? compile(overrides) : COMPILED) text = text.replace(re, to);
  return text.slice(0, LIMITS.maxSpeakTextLength);
}
