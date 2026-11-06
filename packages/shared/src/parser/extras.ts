/**
 * Rules-only extras of the Hinglish parser: bill adjustments ("paanch rupaye kam", "18 percent GST",
 * "round off"), "ye khatam ho gaya" (stock out) and "aaj kitni bikri hui" (summary). They share the
 * parser's spelling folding and token marking: every token an extra explains is marked used, so it
 * can never leak into an item or customer name, and it counts toward confidence.
 *
 * These come from rules only. A model never supplies a discount, a tax rate or a stock change.
 */
import { LIMITS } from '../protocol/constants';
import { MAX_GST_PERCENT, type BillAdjust } from '../domain/adjustments';
import { normalize, type CatalogMatcher } from '../domain/matching';
import { parseNumber } from '../domain/numberWords';

/**
 * Devanagari transliteration only drops a word-final schwa, so कितना becomes "kitana" while the
 * keyword lists say "kitna". Dropping a schwa that sits between two consonant clusters, after an
 * earlier vowel, folds both spellings to the same key. Every keyword and every token goes through
 * this, so the comparison stays consistent; the first and last syllable are never touched.
 */
const MEDIAL_SCHWA = /(?<=[aeiou][^aeiou\s]+)a(?=[^aeiou\s]+[aeiou])/g;

export const fold = (s: string): string => normalize(s, { stripHonorifics: false }).replace(MEDIAL_SCHWA, '');
export const foldSet = (words: readonly string[]): ReadonlySet<string> => new Set(words.map(fold));

/** The parser's working copy of one utterance. */
export interface Tokens {
  raw: string[];
  f: string[];
  used: boolean[];
}

const MAX_NUMBER_TOKENS = 4;
const DISCOUNT_KW = foldSet(['discount', 'chhoot', 'chhut', 'chut', 'kam', 'off', 'छूट', 'डिस्काउंट']);
const PERCENT_KW = foldSet(['percent', 'percentage', 'pratishat', 'fisadi', 'pc', 'प्रतिशत', 'परसेंट', 'पर्सेंट']);
const MONEY_KW = foldSet(['rupaye', 'rupaya', 'rupay', 'rupees', 'rupiya', 'rs', 'रुपये', 'रुपए']);
const GST_KW = foldSet(['gst', 'जीएसटी']);
const ROUND_KW = foldSet(['roundoff', 'round']);
const AFTER_FILLER = foldSet(['ke', 'ka', 'ki', 'lagao', 'laga', 'lagana', 'jodo', 'jod']);

interface Found {
  value: number;
  percent: boolean;
  from: number;
  to: number;
}

const free = (w: Tokens, from: number, to: number): boolean => {
  for (let i = from; i <= to; i++) if (w.used[i]) return false;
  return true;
};

function wholeNumber(w: Tokens, from: number, to: number): number | null {
  const value = parseNumber(w.raw.slice(from, to + 1).join(' '));
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A whole number next to the keyword at `at`: before it first ("10 percent kam"), else after it ("GST 5 percent"). */
function numberAround(w: Tokens, at: number): Found | null {
  let end = at - 1;
  let percent = false;
  while (end >= 0 && !w.used[end] && (PERCENT_KW.has(w.f[end] ?? '') || MONEY_KW.has(w.f[end] ?? ''))) {
    if (PERCENT_KW.has(w.f[end] ?? '')) percent = true;
    end--;
  }
  for (let len = MAX_NUMBER_TOKENS; len >= 1; len--) {
    const start = end - len + 1;
    if (start < 0 || !free(w, start, end)) continue;
    const value = wholeNumber(w, start, end);
    if (value !== null) return { value, percent, from: start, to: at };
  }
  let begin = at + 1;
  while (begin < w.f.length && !w.used[begin] && AFTER_FILLER.has(w.f[begin] ?? '')) begin++;
  for (let len = MAX_NUMBER_TOKENS; len >= 1; len--) {
    const last = begin + len - 1;
    if (last >= w.f.length || !free(w, begin, last)) continue;
    const value = wholeNumber(w, begin, last);
    if (value === null) continue;
    let to = last;
    let after = false;
    while (to + 1 < w.f.length && !w.used[to + 1] && (PERCENT_KW.has(w.f[to + 1] ?? '') || MONEY_KW.has(w.f[to + 1] ?? ''))) {
      if (PERCENT_KW.has(w.f[to + 1] ?? '')) after = true;
      to++;
    }
    return { value, percent: after, from: at, to };
  }
  return null;
}

function mark(w: Tokens, from: number, to: number): void {
  for (let i = from; i <= to; i++) w.used[i] = true;
}

export interface AdjustResult {
  adjust?: BillAdjust;
  warnings: string[];
}

/** Round-off, GST and discount, in that order so "round off" never leaves a stray "off" for the discount. */
export function extractAdjust(w: Tokens): AdjustResult {
  const adjust: BillAdjust = {};
  const warnings: string[] = [];

  for (let i = 0; i < w.f.length; i++) {
    if (w.used[i] || !ROUND_KW.has(w.f[i] ?? '')) continue;
    adjust.roundOff = true;
    w.used[i] = true;
    if (w.f[i + 1] === fold('off')) w.used[i + 1] = true;
  }

  for (let i = 0; i < w.f.length; i++) {
    if (w.used[i] || !GST_KW.has(w.f[i] ?? '')) continue;
    const found = numberAround(w, i);
    if (found && found.value >= 1 && found.value <= MAX_GST_PERCENT) {
      adjust.gstPercent = found.value;
      mark(w, found.from, found.to);
      continue;
    }
    // GST was asked for but the rate was not: never guess a tax rate.
    warnings.push('GST kitna percent? Bolo: "5 percent GST".');
    w.used[i] = true;
  }

  for (let i = 0; i < w.f.length; i++) {
    if (w.used[i] || !DISCOUNT_KW.has(w.f[i] ?? '')) continue;
    const found = numberAround(w, i);
    if (!found || found.value <= 0) continue;
    if (found.percent) {
      if (found.value > 100) continue;
      adjust.discountPercent = found.value;
    } else {
      adjust.discountAmount = found.value;
    }
    mark(w, found.from, found.to);
  }

  return Object.keys(adjust).length > 0 ? { adjust, warnings } : { warnings };
}

// --- Stock out: "aata khatam ho gaya" -------------------------------------------------------------

const STOCK_OUT_KW = foldSet(['khatam', 'khatm', 'finish', 'finished', 'khalas', 'खत्म']);
const STOCK_FILLER = foldSet([
  'ho', 'gaya', 'gayi', 'gaye', 'hai', 'hain', 'hua', 'hui', 'hue', 'ka', 'ki', 'ke', 'stock', 'abhi', 'toh', 'to',
  'bhi', 'ye', 'wo', 'ab', 'mera', 'hamara', 'humara', 'sab', 'poora', 'pura', 'bilkul', 'kar', 'karo', 'do', 'de', 'dena', 'likh', 'likho',
]);

export interface StockOutResult {
  name: string;
  /** 0..1: how sure the product match is. */
  confidence: number;
}

/**
 * "Maggi khatam ho gaya", "chini khatam hai". Only when the rest of the sentence names a product (or
 * nothing in the catalog could be a customer), so "Sharma ji ka udhaar khatam" is left to the other
 * rules. Returns null when this is not a stock-out sentence.
 */
export function parseStockOut(w: Tokens, matcher: CatalogMatcher | undefined): StockOutResult | null {
  if (!w.f.some((t) => STOCK_OUT_KW.has(t))) return null;
  const nameTokens = w.raw.filter((_, i) => !STOCK_OUT_KW.has(w.f[i] ?? '') && !STOCK_FILLER.has(w.f[i] ?? ''));
  if (nameTokens.length === 0 || nameTokens.length > 4 || nameTokens.some((t) => parseNumber(t) !== null)) return null;
  // Debt words mean a ledger sentence ("udhaar khatam"), never a product.
  if (nameTokens.some((t) => OUTSTANDING_KW.has(fold(t)) || fold(t) === fold('khata'))) return null;
  const name = nameTokens.join(' ').slice(0, LIMITS.maxNameLength);
  if (!matcher) return { name, confidence: 0.85 };
  const product = matcher.matchProduct(name);
  const customer = matcher.matchCustomer(name);
  if (customer.best && (!product.best || customer.best.score > product.best.score)) return null;
  const score = product.best ? (product.ambiguous ? Math.min(0.5, product.best.score) : product.best.score) : (product.candidates[0]?.score ?? 0.3) * 0.6;
  return { name, confidence: Math.round(Math.min(0.95, score) * 1000) / 1000 };
}

// --- Summary: "aaj kitni bikri hui", "kul udhaar kitna baaki hai" ---------------------------------------

const SALE_KW = foldSet(['bikri', 'bikree', 'sale', 'sales', 'kamai', 'kamayi', 'collection', 'becha', 'bika', 'vyapar', 'dhandha']);
const SUMMARY_FILLER = foldSet([
  'aaj', 'abhi', 'ab', 'tak', 'kul', 'total', 'sab', 'saara', 'sara', 'poora', 'pura', 'ka', 'ki', 'ke', 'kya', 'kitna',
  'kitni', 'kitne', 'hui', 'hua', 'hue', 'hai', 'hain', 'ho', 'gayi', 'gaya', 'batao', 'bataiye', 'bolo', 'dikhao',
  'today', 'hisab', 'din', 'ye', 'mera', 'hamara', 'mein', 'me', 'bhi',
]);
const OUTSTANDING_KW = foldSet(['udhaar', 'udhar', 'udhari', 'baki', 'bakaya', 'baaki', 'pending', 'outstanding']);

/** True for a shop-wide question: sales today or the total udhaar. Call only when no customer or item was found. */
export function parseSummaryQuery(w: Tokens): { confidence: number } | null {
  const hasSale = w.f.some((t) => SALE_KW.has(t));
  const hasToday = w.f.some((t) => t === fold('aaj') || t === fold('today'));
  const asksHisab = hasToday && w.f.some((t) => t === fold('hisab'));
  const asksOutstanding = w.f.some((t) => OUTSTANDING_KW.has(t)) && w.f.some((t) => SUMMARY_FILLER.has(t) && (t === fold('kitna') || t === fold('kitni') || t === fold('kul') || t === fold('total')));
  if (!hasSale && !asksHisab && !asksOutstanding) return null;
  let explained = 0;
  for (let i = 0; i < w.f.length; i++) {
    const t = w.f[i] ?? '';
    if (SALE_KW.has(t) || OUTSTANDING_KW.has(t) || SUMMARY_FILLER.has(t)) explained++;
  }
  const unexplained = (w.f.length - explained) / w.f.length;
  return { confidence: Math.round(Math.max(0, 1 - 1.2 * unexplained) * 1000) / 1000 };
}
