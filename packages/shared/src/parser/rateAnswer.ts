/**
 * A bare answer to "rate bolo": "120 rupaye kilo", "ek sau bees rupaye", "120". Nothing else is
 * accepted, so a sentence about anything else never gets mistaken for a price. Rules only: a
 * model never supplies a price.
 */
import type { Unit } from '../protocol/common';
import { normalizeUnit, parseNumber, tokenizeSpeech } from '../domain/numberWords';
import { isMoneyWord } from './pricedItems';
import { fold, foldSet } from './extras';

export interface RateAnswer {
  amount: number;
  unit: Unit | null;
}

const FILLER = foldSet(['per', 'prati', 'har', 'rate', 'daam', 'dam', 'bhav', 'bhaav', 'price', 'hai', 'ka', 'ke', 'ki', 'ko', 'karo', 'kar', 'rakho', 'ek', 'रेट', 'दाम', 'भाव', 'है', 'का', 'के', 'की']);
const MAX_RATE = 1_000_000_000;

export function parseRateAnswer(text: string): RateAnswer | null {
  if (typeof text !== 'string') return null;
  const tokens = tokenizeSpeech(text.slice(0, 200));
  if (tokens.length === 0 || tokens.length > 10) return null;

  // The longest run of number words, searched left to right.
  let run: { value: number; start: number; end: number } | null = null;
  for (let start = 0; start < tokens.length && !run; start++) {
    for (let end = Math.min(tokens.length, start + 4); end > start; end--) {
      const value = parseNumber(tokens.slice(start, end).join(' '));
      if (value !== null) {
        run = { value, start, end };
        break;
      }
    }
  }
  if (!run || !Number.isInteger(run.value) || run.value <= 0 || run.value > MAX_RATE) return null;

  let unit: Unit | null = null;
  let money = false;
  for (let i = 0; i < tokens.length; i++) {
    if (i >= run.start && i < run.end) continue;
    const token = tokens[i] ?? '';
    const asUnit = token.length > 1 ? normalizeUnit(token) : null;
    if (asUnit) {
      if (unit !== null && unit !== asUnit) return null;
      unit = asUnit;
    } else if (isMoneyWord(token)) money = true;
    else if (!FILLER.has(fold(token))) return null;
  }
  // "ek kilo" / "120 kilo" is an amount of goods, not a rate.
  if (unit !== null && !money) return null;
  // A lone "ek" is the number one only when it is the whole answer's number run.
  return { amount: run.value, unit };
}
