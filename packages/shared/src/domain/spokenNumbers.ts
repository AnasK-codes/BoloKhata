import { parseNumber, tokenizeSpeech } from './numberWords';

const MAX_WINDOW = 8;

/**
 * Every number a transcript says, as digits or Hindi/English words ("do sau pachas", "₹110", "१२०"),
 * so a number a model reports can be checked against what was actually said. A model may read an
 * amount, but it can never introduce one: an amount that is not in this set is rejected.
 */
export function spokenNumbers(transcript: string): ReadonlySet<number> {
  const out = new Set<number>();
  if (typeof transcript !== 'string') return out;
  const tokens = tokenizeSpeech(transcript.replace(/₹/g, ' rupaye '));
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j <= Math.min(tokens.length, i + MAX_WINDOW); j++) {
      const value = parseNumber(tokens.slice(i, j).join(' '));
      if (value !== null) out.add(value);
    }
  }
  return out;
}
