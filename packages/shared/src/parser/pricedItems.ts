import { LIMITS } from '../protocol/constants';
import { normalizeUnit, extractQuantityAndUnit, parseNumber } from '../domain/numberWords';
import type { Unit } from '../protocol/common';
import type { ParsedItemOutput } from './schema';

export interface PricePiece { raw: string; index: number }
const MONEY = new Set(['rupaye', 'rupay', 'rupaya', 'rupiya', 'rupees', 'rupee', 'rs', 'रुपये', 'रुपए', 'रुपया']);
const PER = new Set(['per', 'prati', 'each', 'हर', 'प्रति']);
export const isMoneyWord = (word: string): boolean => MONEY.has(word.toLowerCase());
export function hasMoneyTail(pieces: readonly PricePiece[]): boolean {
  let anchor = -1;
  for (let i = pieces.length - 1; i >= 0; i--) if (isMoneyWord(pieces[i]?.raw ?? '')) { anchor = i; break; }
  return anchor >= 0 && parseNumber(pieces.slice(anchor + 1).map((p) => p.raw).join(' ')) !== null;
}

function numberRun(pieces: readonly PricePiece[], from: number, to: number, forward: boolean) {
  for (let size = Math.min(8, to - from); size > 0; size--) {
    const start = forward ? from : to - size;
    const value = parseNumber(pieces.slice(start, start + size).map((p) => p.raw).join(' '));
    if (value !== null) return { value, start, end: start + size };
  }
  return null;
}

function itemFrom(pieces: readonly PricePiece[], amount: number, basis: 'line' | 'unit', rateUnit: Unit | null): ParsedItemOutput | null {
  let quantity = 1;
  let unit: Unit | null = null;
  let words = pieces.map((p) => p.raw);
  // "do Maggi ke packets" and "Maggi do packets" both keep the spoken count.
  for (let i = 0; i < words.length; i++) {
    const found = extractQuantityAndUnit(words.slice(i));
    if (!found) continue;
    quantity = found.quantity; unit = found.unit;
    words = [...words.slice(0, i), ...words.slice(i + found.consumed)];
    break;
  }
  const names: string[] = [];
  for (const word of words) {
    const trailingUnit = normalizeUnit(word);
    if (trailingUnit && !unit) { unit = trailingUnit; continue; }
    if (PER.has(word.toLowerCase())) continue;
    names.push(word);
  }
  const name = names.join(' ').trim().slice(0, LIMITS.maxNameLength);
  if (!name) return null;
  // A second unexplained quantity is ambiguous; never distribute one price across two items.
  if (names.some((word) => parseNumber(word) !== null)) amount = -1;
  return { name, quantity, unit, spokenPrice: { amount, basis, unit: rateUnit } };
}

/** Consume one or more item+price clauses, even when STT omits comma punctuation. */
export function pricedItems(pieces: readonly PricePiece[]): { items: ParsedItemOutput[]; consumed: number } {
  const items: ParsedItemOutput[] = [];
  let cursor = 0;
  for (let anchor = 0; anchor < pieces.length; anchor++) {
    if (!isMoneyWord(pieces[anchor]?.raw ?? '')) continue;
    let run = numberRun(pieces, cursor, anchor, false);
    if (!run) run = numberRun(pieces, anchor + 1, pieces.length, true);
    let amount = run?.value ?? -1;
    let start = run ? Math.min(anchor, run.start) : anchor;
    let end = run ? Math.max(anchor + 1, run.end) : anchor + 1;
    if (pieces[start - 1]?.raw === 'minus') { amount = -1; start--; }
    if (pieces[anchor + 1]?.raw === 'minus') {
      const negative = numberRun(pieces, anchor + 2, pieces.length, true);
      amount = -1; end = negative?.end ?? anchor + 2;
    }
    let basis: 'line' | 'unit' = 'line';
    let rateUnit: Unit | null = null;
    if (PER.has(pieces[end]?.raw.toLowerCase() ?? '')) {
      const indicator = pieces[end]?.raw.toLowerCase();
      basis = 'unit'; rateUnit = normalizeUnit(pieces[end + 1]?.raw ?? ''); end += rateUnit ? 2 : 1;
      if (!rateUnit && indicator !== 'each') amount = -1;
    } else {
      const followingUnit = normalizeUnit(pieces[end]?.raw ?? '');
      if (followingUnit) { basis = 'unit'; rateUnit = followingUnit; end++; }
    }
    let chunk = pieces.slice(cursor, start);
    const per = chunk.findIndex((p) => PER.has(p.raw.toLowerCase()));
    if (per >= 0) {
      basis = 'unit'; rateUnit = normalizeUnit(chunk[per + 1]?.raw ?? '');
      if (!rateUnit && chunk[per]?.raw.toLowerCase() !== 'each') amount = -1;
      chunk = chunk.slice(0, per);
    }
    const item = itemFrom(chunk, amount, basis, rateUnit);
    if (!item) continue;
    items.push(item); cursor = end; anchor = end - 1;
  }
  return { items, consumed: cursor };
}
