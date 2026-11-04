/**
 * Rule-based Hinglish parser: transcript -> structured intent. Runs first on every turn;
 * the gateway calls the LLM only when `confidence` is below CONFIDENCE_THRESHOLD.
 *
 * Order of work (each step marks the tokens it explains, so the unexplained share feeds
 * the confidence score):
 *   1. short whole-sentence answers: cancel, then confirm
 *   2. customer ("Sharma ji ko", "Sharma ji ne", "Sharma ji ka kitna udhaar")
 *   3. amounts next to udhaar / payment keywords ("teen sau ka udhaar", "do sau de diye")
 *   4. items as quantity + unit + name, either order ("do kilo aata", "aata do kilo")
 *   5. intent from what was found
 *
 * Keywords are compared after the same spelling folding the matcher uses, so udhaar /
 * udhar / uddhar and haan / han / haa are one word each. The transcript is untrusted: it is
 * length-limited, never executed, and instruction-like text yields `unknown` with zero
 * confidence. The parser never outputs prices.
 */
import { LIMITS } from '../protocol/constants';
import { normalize, type CatalogMatcher } from '../domain/matching';
import { extractQuantityAndUnit, normalizeUnit, parseNumber, tokenizeSpeech } from '../domain/numberWords';
import type { ParsedUtterance, ParsedItemOutput } from './schema';

/** Rules results at or above this are used directly; below it the LLM may be tried. */
export const CONFIDENCE_THRESHOLD = 0.7;

const fold = (s: string): string => normalize(s, { stripHonorifics: false });
const foldSet = (words: readonly string[]): ReadonlySet<string> => new Set(words.map(fold));

const NEGATIVE = foldSet(['hata', 'nahi', 'nahin', 'na', 'nai', 'nope', 'no', 'mat', 'cancel', 'rehne', 'rahne', 'hatao', 'ruko', 'galat', 'नहीं', 'नही', 'रहने']);
const CANCEL_VOCAB = foldSet([
  'hata', 'nahi', 'nahin', 'na', 'nai', 'nope', 'no', 'mat', 'cancel', 'rehne', 'rahne', 'hatao', 'ruko', 'do',
  'karo', 'kar', 'kardo', 'ji', 'bas', 'bilkul', 'abhi', 'hai', 'bhai', 'yaar', 'ye', 'wo', 'bill',
  'chhodo', 'chodo', 'dijiye', 'galat', 'नहीं', 'नही', 'रहने', 'दो',
]);
const CONFIRM_CORE = foldSet([
  'haan', 'ha', 'haa', 'han', 'theek', 'thik', 'save', 'confirm', 'ok', 'okay', 'yes', 'sahi', 'bilkul',
  'done', 'kardo', 'kar', 'karo', 'हाँ', 'हां', 'हा', 'ठीक',
]);
const CONFIRM_VOCAB = foldSet([
  'ji', 'hai', 'do', 'dijiye', 'dena', 'bhi', 'ye', 'wahi', 'sahi', 'ठीक', 'है', 'दो', 'कर',
  ...CONFIRM_CORE,
]);

const BALANCE_KW = foldSet(['kitna', 'kitni', 'kitne', 'hisab', 'balance', 'bakaya', 'outstanding', 'baki', 'pending']);
const UDHAAR_KW = foldSet(['udhaar', 'udhar', 'udhari', 'credit', 'baki', 'bakaya', 'khata', 'khate']);
const PAID_KW = foldSet(['diye', 'diya', 'dia', 'jama', 'mile', 'mila', 'paid', 'pay', 'payment', 'chukaye', 'chukaya', 'bhare', 'bhara', 'wapas']);
const MIL_GAYE = foldSet(['gaye', 'gaya', 'gae']);
const AMOUNT_FILLER = foldSet(['ka', 'ki', 'ke', 'ko', 'rupaye', 'rupaya', 'rupay', 'rupees', 'rupiya', 'rs', 'de', 'ne', 'hi', 'bhi', 'cash', 'nakad', 'abhi', 'aaj', 'mil', 'gaye', 'gaya', 'kar', 'kiye', 'kiya']);
const MARKER_ALWAYS = foldSet(['ko', 'ne', 'se']);
const MARKER_NEEDS_KEYWORD = foldSet(['ka', 'ki', 'ke']);
const AFTER_MARKER_KW = foldSet(['kitna', 'kitni', 'kitne', 'udhaar', 'udhar', 'udhari', 'baki', 'bakaya', 'hisab', 'balance', 'khata', 'khate', 'total', 'pending', 'liye']);
const CUSTOMER_FILLER = foldSet(['bill', 'bana', 'banao', 'likho', 'likh', 'naya', 'hisab', 'aaj', 'abhi', 'please', 'pls']);
/** Particles that follow a customer name at the end of an order: "... Sharma ji ke naam pe". */
const TRAILING_PARTICLES = foldSet(['ko', 'ke', 'ki', 'liye', 'naam', 'nam', 'pe', 'par', 'mein', 'me', 'mei']);
const SEPARATORS = foldSet(['aur', 'and', 'plus', 'tatha', 'saath']);
const NOISE = foldSet([
  'likh', 'likho', 'jod', 'jodo', 'kar', 'karo', 'dena', 'de', 'dijiye', 'chahiye', 'bill', 'bana', 'banao',
  'banado', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'ne', 'se', 'ye', 'wo', 'please', 'pls', 'bhi', 'bas',
  'aaj', 'abhi', 'wala', 'wali', 'wale', 'mein', 'me', 'mei', 'liye', 'uh', 'um', 'umm', 'hmm', 'matlab',
  'toh', 'acha', 'accha', 'yaar', 'dekho', 'suno',
]);
const BALANCE_FILLER = foldSet(['hai', 'hain', 'hua', 'hoga', 'batao', 'bataiye', 'bataye', 'dikhao', 'bolo', 'kya', 'total', 'abhi', 'ab', 'ho', 'gaya', 'gayi', 'gaye', 'tha', 'raha', 'rha']);
const DO_AFTER = foldSet(['likh', 'likho', 'jod', 'jodo', 'kar', 'de', 'rehne', 'rahne', 'bhi', 'dijiye']);

const INJECTION =
  /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:instruction|instructions|previous|above|prompt|system)\b|system prompt|you are now|jailbreak/i;

/** True for text that tries to instruct the system. Callers must not forward it to a model. */
export function isInstructionLike(transcript: string): boolean {
  return typeof transcript === 'string' && INJECTION.test(transcript.slice(0, LIMITS.maxTranscriptLength));
}

const MAX_AMOUNT_TOKENS = 8;

const EMPTY: ParsedUtterance = {
  intent: 'unknown',
  customer: null,
  items: [],
  amount_paid: null,
  udhaar_amount: null,
  confidence: 0,
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));

interface Working {
  raw: string[];
  f: string[];
  used: boolean[];
}

const isNumeric = (token: string): boolean => parseNumber(token) !== null;

function allUnused(w: Working, from: number, to: number): boolean {
  for (let i = from; i <= to; i++) if (w.used[i]) return false;
  return true;
}

function markRange(w: Working, from: number, to: number): void {
  for (let i = from; i <= to; i++) w.used[i] = true;
}

function titleCase(tokens: readonly string[]): string {
  return tokens
    .map((t) => (t === 'ji' ? t : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(' ')
    .slice(0, LIMITS.maxNameLength);
}

// --- Step 1: whole-sentence answers --------------------------------------------------------

function answerIntent(f: readonly string[]): 'confirm' | 'cancel' | null {
  if (f.length === 0 || f.length > 5) return null;
  if (f.some((t) => NEGATIVE.has(t)) && f.every((t) => CANCEL_VOCAB.has(t))) return 'cancel';
  if (f.some((t) => CONFIRM_CORE.has(t)) && f.every((t) => CONFIRM_VOCAB.has(t))) return 'confirm';
  return null;
}

// --- Step 2: customer ----------------------------------------------------------------------

function findCustomer(w: Working, matcher: CatalogMatcher | undefined): string | null {
  const { raw, f } = w;
  for (let m = 1; m < f.length; m++) {
    const marker = f[m] ?? '';
    const always = MARKER_ALWAYS.has(marker);
    let after = m + 1;
    if (!always) {
      if (!MARKER_NEEDS_KEYWORD.has(marker)) continue;
      while (after < f.length && AMOUNT_FILLER.has(f[after] ?? '') && !AFTER_MARKER_KW.has(f[after] ?? '')) after++;
      if (!AFTER_MARKER_KW.has(f[after] ?? '')) continue;
    }
    let start = 0;
    while (start < m && CUSTOMER_FILLER.has(f[start] ?? '')) start++;
    const nameTokens = raw.slice(start, m);
    if (nameTokens.length < 1 || nameTokens.length > 4) continue;
    if (nameTokens.some(isNumeric)) continue;
    const lead = nameTokens.map((_, i) => f[start + i] ?? '');
    if (lead.some((t) => PAID_KW.has(t) || UDHAAR_KW.has(t) || normalizeUnit(t) !== null)) continue;
    const name = nameTokens.join(' ');
    if (matcher && isProductNotCustomer(matcher, name)) continue;
    markRange(w, 0, m);
    if (marker === fold('ke') && f[m + 1] === fold('liye')) w.used[m + 1] = true;
    return titleCase(nameTokens);
  }
  if (!matcher) return null;
  return findCustomerWithoutMarker(w, matcher) ?? findTrailingCustomer(w, matcher);
}

function isProductNotCustomer(matcher: CatalogMatcher, name: string): boolean {
  const p = matcher.matchProduct(name).best;
  if (!p) return false;
  const c = matcher.matchCustomer(name).best;
  return !c || p.score > c.score;
}

/** "Sharma ji do kilo aata": no particle, but a leading run that is clearly a known customer. */
function findCustomerWithoutMarker(w: Working, matcher: CatalogMatcher): string | null {
  let end = 0;
  while (end < w.f.length && end < 3 && !isNumeric(w.raw[end] ?? '') && !NOISE.has(w.f[end] ?? '')) end++;
  for (let len = end; len >= 1; len--) {
    const name = w.raw.slice(0, len).join(' ');
    const c = matcher.matchCustomer(name);
    if (c.best && !c.ambiguous && !isProductNotCustomer(matcher, name)) {
      markRange(w, 0, len - 1);
      return titleCase(w.raw.slice(0, len));
    }
  }
  return null;
}

/**
 * "do kilo aata Sharma ji ko", "... aur ek Maggi Verma ji ke liye", "... Sharma ji ke naam pe": a KNOWN
 * customer at the end of the sentence. Only a catalog match counts, so an item name can never be
 * mistaken for a customer; a new customer must still be named first ("Naya ji ko ...").
 */
function findTrailingCustomer(w: Working, matcher: CatalogMatcher): string | null {
  const { f } = w;
  const skippable = (t: string) => NOISE.has(t) || UDHAAR_KW.has(t) || TRAILING_PARTICLES.has(t) || t === fold('do');
  let end = f.length;
  while (end > 0 && skippable(f[end - 1] ?? '')) end--;
  for (let len = Math.min(3, end); len >= 1; len--) {
    const start = end - len;
    if (!allUnused(w, start, end - 1) || w.raw.slice(start, end).some(isNumeric)) continue;
    const name = w.raw.slice(start, end).join(' ');
    const c = matcher.matchCustomer(name);
    if (!c.best || c.ambiguous || isProductNotCustomer(matcher, name)) continue;
    let last = end - 1;
    while (last + 1 < f.length && TRAILING_PARTICLES.has(f[last + 1] ?? '')) last++;
    markRange(w, start, last);
    return titleCase(w.raw.slice(start, end));
  }
  return null;
}

// --- Step 3: amounts -----------------------------------------------------------------------

function readNumberRun(w: Working, from: number, to: number, forward: boolean): { value: number; start: number; end: number } | null {
  const span = to - from + 1;
  for (let len = Math.min(MAX_AMOUNT_TOKENS, span); len >= 1; len--) {
    const start = forward ? from : to - len + 1;
    const end = start + len - 1;
    if (!allUnused(w, start, end)) continue;
    const value = parseNumber(w.raw.slice(start, end + 1).join(' '));
    if (value !== null && value >= 0) return { value: Math.round(value), start, end };
  }
  return null;
}

/** A whole-rupee amount adjacent to the keyword at `anchor` (before it first, else after it). */
function amountAround(w: Working, anchor: number): number | null {
  let j = anchor - 1;
  while (j >= 0 && !w.used[j] && AMOUNT_FILLER.has(w.f[j] ?? '')) j--;
  if (j >= 0 && !w.used[j]) {
    const run = readNumberRun(w, Math.max(0, j - MAX_AMOUNT_TOKENS + 1), j, false);
    if (run && run.end === j) {
      markRange(w, run.start, anchor);
      return run.value;
    }
  }
  let k = anchor + 1;
  while (k < w.f.length && !w.used[k] && AMOUNT_FILLER.has(w.f[k] ?? '')) k++;
  if (k < w.f.length && !w.used[k]) {
    const run = readNumberRun(w, k, Math.min(w.f.length - 1, k + MAX_AMOUNT_TOKENS - 1), true);
    if (run && run.start === k) {
      markRange(w, anchor, run.end);
      return run.value;
    }
  }
  return null;
}

interface Amounts {
  paid: number | null;
  udhaar: number | null;
  hasPaidKw: boolean;
  hasUdhaarKw: boolean;
}

function findAmounts(w: Working): Amounts {
  const out: Amounts = { paid: null, udhaar: null, hasPaidKw: false, hasUdhaarKw: false };
  for (let i = 0; i < w.f.length; i++) {
    if (w.used[i]) continue;
    const t = w.f[i] ?? '';
    const isPaid = PAID_KW.has(t) || (MIL_GAYE.has(t) && w.f[i - 1] === fold('mil'));
    if (isPaid && out.paid === null) {
      out.hasPaidKw = true;
      out.paid = amountAround(w, i);
      w.used[i] = true;
    } else if (UDHAAR_KW.has(t) && out.udhaar === null) {
      out.hasUdhaarKw = true;
      out.udhaar = amountAround(w, i);
      w.used[i] = true; // never let the keyword leak into an item name
    }
  }
  return out;
}

// --- Step 4: items -------------------------------------------------------------------------

interface Piece {
  raw: string;
  index: number;
}

function startsQuantity(pieces: readonly Piece[], at: number): boolean {
  return extractQuantityAndUnit(pieces.slice(at, at + MAX_AMOUNT_TOKENS + 1).map((p) => p.raw)) !== null;
}

function itemsInSegment(w: Working, pieces: readonly Piece[], matcher: CatalogMatcher | undefined, out: ParsedItemOutput[]): void {
  let pending: Piece[] = [];
  let i = 0;
  while (i < pieces.length) {
    const ext = extractQuantityAndUnit(pieces.slice(i, i + MAX_AMOUNT_TOKENS + 1).map((p) => p.raw));
    if (!ext) {
      const piece = pieces[i];
      if (piece) pending.push(piece);
      i++;
      continue;
    }
    const afterQuantity = i + ext.consumed;
    let k = afterQuantity;
    while (k < pieces.length && !startsQuantity(pieces, k)) k++;
    const follow = pieces.slice(afterQuantity, k);
    const nameParts = follow.length > 0 ? follow : pending;
    if (nameParts.length > 0 && ext.quantity > 0) {
      out.push({ name: nameParts.map((p) => p.raw).join(' ').slice(0, LIMITS.maxNameLength), quantity: ext.quantity, unit: ext.unit });
      for (let q = i; q < afterQuantity; q++) w.used[pieces[q]?.index ?? 0] = true;
      for (const p of nameParts) w.used[p.index] = true;
    }
    pending = [];
    i = k;
  }
  if (pending.length > 0 && matcher && out.length === 0) {
    // A bare product name with no number: "Maggi" means one.
    const name = pending.map((p) => p.raw).join(' ');
    if (matcher.matchProduct(name).best) {
      out.push({ name: name.slice(0, LIMITS.maxNameLength), quantity: 1, unit: null });
      for (const p of pending) w.used[p.index] = true;
    }
  }
}

function findItems(w: Working, matcher: CatalogMatcher | undefined): ParsedItemOutput[] {
  for (let i = 1; i < w.f.length; i++) {
    if (!w.used[i] && w.f[i] === fold('do') && DO_AFTER.has(w.f[i - 1] ?? '')) w.used[i] = true;
  }
  const items: ParsedItemOutput[] = [];
  let segment: Piece[] = [];
  const flush = (): void => {
    if (segment.length > 0) itemsInSegment(w, segment, matcher, items);
    segment = [];
  };
  for (let i = 0; i < w.raw.length; i++) {
    const t = w.f[i] ?? '';
    if (w.used[i]) {
      flush();
    } else if (SEPARATORS.has(t)) {
      w.used[i] = true;
      flush();
    } else if (NOISE.has(t)) {
      w.used[i] = true;
    } else {
      segment.push({ raw: w.raw[i] ?? '', index: i });
    }
  }
  flush();
  return items;
}

// --- Step 5: confidence --------------------------------------------------------------------

function itemFactor(items: readonly ParsedItemOutput[], matcher: CatalogMatcher | undefined): number {
  if (!matcher) return 0.85;
  let sum = 0;
  for (const item of items) {
    const m = matcher.matchProduct(item.name);
    if (m.best) sum += m.ambiguous ? Math.min(0.5, m.best.score) : m.best.score;
    else sum += (m.candidates[0]?.score ?? 0.3) * 0.6;
  }
  return items.length === 0 ? 0 : sum / items.length;
}

function customerFactor(customer: string | null, matcher: CatalogMatcher | undefined, whenMissing: number): number {
  if (customer === null) return whenMissing;
  if (!matcher) return 0.9;
  const m = matcher.matchCustomer(customer);
  if (m.best) return m.ambiguous ? 0.6 : Math.max(0.8, m.best.score);
  if (m.isNew) return 0.85;
  return 0.6;
}

export function parseUtterance(transcript: string, matcher?: CatalogMatcher): ParsedUtterance {
  if (typeof transcript !== 'string') return { ...EMPTY };
  const text = transcript.slice(0, LIMITS.maxTranscriptLength);
  if (isInstructionLike(text)) return { ...EMPTY };

  const raw = tokenizeSpeech(text);
  if (raw.length === 0) return { ...EMPTY };
  const f = raw.map(fold);

  const answer = answerIntent(f);
  if (answer) return { ...EMPTY, intent: answer, confidence: 0.95 };

  const w: Working = { raw, f, used: new Array<boolean>(raw.length).fill(false) };
  const customer = findCustomer(w, matcher);
  const amounts = findAmounts(w);
  const items = findItems(w, matcher);

  const hasBalanceKw = f.some((t) => BALANCE_KW.has(t));
  const isBalanceQuery =
    items.length === 0 && customer !== null && (hasBalanceKw || (amounts.hasUdhaarKw && amounts.udhaar === null));
  if (isBalanceQuery) {
    // "kitna udhaar hai": the question words are understood, so they are not "unexplained".
    for (let i = 0; i < f.length; i++) {
      const t = f[i] ?? '';
      if (BALANCE_KW.has(t) || UDHAAR_KW.has(t) || BALANCE_FILLER.has(t)) w.used[i] = true;
    }
  }
  const unexplained = w.used.filter((u) => !u).length / raw.length;
  const base = Math.max(0, 1 - 1.2 * unexplained);

  const result: ParsedUtterance = {
    ...EMPTY,
    customer,
    items,
    udhaar_amount: amounts.udhaar,
    amount_paid: amounts.paid,
  };

  if (items.length > 0) {
    result.intent = 'create_bill';
    const noCustomerWithCredit = customer === null && amounts.udhaar !== null && amounts.udhaar > 0;
    result.confidence = clamp01(base * itemFactor(items, matcher) * customerFactor(customer, matcher, noCustomerWithCredit ? 0.6 : 1));
    return result;
  }
  if (amounts.hasPaidKw && amounts.paid !== null && amounts.paid > 0) {
    result.intent = 'record_payment';
    result.udhaar_amount = null;
    result.confidence = clamp01(base * customerFactor(customer, matcher, 0.5));
    return result;
  }
  if (isBalanceQuery) {
    result.intent = 'query_balance';
    result.amount_paid = null;
    result.confidence = clamp01(base * customerFactor(customer, matcher, 0.4));
    return result;
  }
  if (customer !== null && amounts.udhaar !== null && amounts.udhaar > 0) {
    result.intent = 'create_bill';
    result.confidence = 0.35;
    return result;
  }
  return { ...EMPTY, confidence: 0.1 };
}
