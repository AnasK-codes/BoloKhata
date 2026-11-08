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
 * confidence. Only this rules path may attach a literal spoken-price quote.
 */
import { LIMITS } from '../protocol/constants';
import type { Unit } from '../protocol/common';
import type { CatalogMatcher } from '../domain/matching';
import { extractQuantityAndUnit, normalizeUnit, parseNumber, tokenizeSpeech } from '../domain/numberWords';
import type { MissingItem, ParsedUtterance, ParsedItemOutput } from './schema';
import { pricedItems, hasMoneyTail, isMoneyWord } from './pricedItems';
import { extractAdjust, fold, foldSet, parseStockOut, parseSummaryQuery } from './extras';

/** Rules results at or above this are used directly; below it the LLM may be tried. */
export const CONFIDENCE_THRESHOLD = 0.7;


const NEGATIVE = foldSet(['hata', 'nahi', 'nahin', 'na', 'nai', 'nope', 'no', 'mat', 'cancel', 'rehne', 'rahne', 'hatao', 'ruko', 'galat', 'नहीं', 'नही', 'रहने']);
const CANCEL_VOCAB = foldSet([
  'hata', 'nahi', 'nahin', 'na', 'nai', 'nope', 'no', 'mat', 'cancel', 'rehne', 'rahne', 'hatao', 'ruko', 'do',
  'karo', 'kar', 'kardo', 'ji', 'bas', 'bilkul', 'abhi', 'hai', 'bhai', 'yaar', 'ye', 'wo', 'bill',
  'chhodo', 'chodo', 'dijiye', 'galat', 'chahiye', 'chaiye', 'नहीं', 'नही', 'रहने', 'दो', 'चाहिए',
]);
const CONFIRM_CORE = foldSet([
  'haan', 'ha', 'haa', 'han', 'theek', 'thik', 'save', 'confirm', 'ok', 'okay', 'yes', 'sahi', 'bilkul',
  'done', 'kardo', 'kar', 'karo', 'gaya', 'gya', 'हाँ', 'हां', 'हा', 'ठीक', 'गया',
]);
const CONFIRM_VOCAB = foldSet([
  'ji', 'hai', 'ho', 'हो', 'do', 'dijiye', 'dena', 'bhi', 'ye', 'wahi', 'sahi', 'ठीक', 'है', 'दो', 'कर',
  ...CONFIRM_CORE,
]);

const BALANCE_KW = foldSet(['kitna', 'kitni', 'kitne', 'hisab', 'balance', 'bakaya', 'outstanding', 'baki', 'pending']);
const UDHAAR_KW = foldSet(['udhaar', 'udhar', 'udhari', 'credit', 'baki', 'bakaya', 'khata', 'khate']);
const PAID_KW = foldSet(['diye', 'diya', 'dia', 'jama', 'mile', 'mila', 'paid', 'pay', 'payment', 'दिए', 'दिये', 'chukaye', 'chukaya', 'bhare', 'bhara', 'wapas']);
const MIL_GAYE = foldSet(['gaye', 'gaya', 'gae']);
const AMOUNT_FILLER = foldSet(['ka', 'ki', 'ke', 'ko', 'rupaye', 'rupaya', 'rupay', 'rupees', 'rupiya', 'rs', 'रुपये', 'रुपए', 'रुपया', 'de', 'ne', 'hi', 'bhi', 'cash', 'nakad', 'abhi', 'aaj', 'mil', 'gaye', 'gaya', 'kar', 'kiye', 'kiya']);
const MARKER_ALWAYS = foldSet(['ko', 'ne', 'se']);
const MARKER_NEEDS_KEYWORD = foldSet(['ka', 'ki', 'ke']);
const AFTER_MARKER_KW = foldSet(['kitna', 'kitni', 'kitne', 'udhaar', 'udhar', 'udhari', 'baki', 'bakaya', 'hisab', 'balance', 'khata', 'khate', 'total', 'pending', 'liye']);
const CUSTOMER_FILLER = foldSet(['bill', 'bana', 'banao', 'likho', 'likh', 'naya', 'hisab', 'aaj', 'abhi', 'please', 'pls', 'uh', 'um', 'umm', 'hmm', 'matlab', 'toh', 'haan']);
/** Particles that follow a customer name at the end of an order: "... Sharma ji ke naam pe". */
const TRAILING_PARTICLES = foldSet(['ko', 'ke', 'ki', 'liye', 'naam', 'nam', 'pe', 'par', 'mein', 'me', 'mei']);
const SEPARATORS = foldSet(['aur', 'and', 'plus', 'tatha', 'saath']);
const NOISE = foldSet([
  'likh', 'likho', 'jod', 'jodo', 'kar', 'karo', 'dena', 'de', 'dijiye', 'chahiye', 'bill', 'bana', 'banao',
  'banado', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'ne', 'se', 'ye', 'wo', 'please', 'pls', 'bhi', 'bas',
  'aaj', 'abhi', 'wala', 'wali', 'wale', 'mein', 'me', 'mei', 'liye', 'uh', 'um', 'umm', 'hmm', 'matlab', 'haan',
  'toh', 'acha', 'accha', 'yaar', 'dekho', 'suno', 'add', 'aid', 'kardo', 'kardijiye', 'daalo', 'dalo', 'dedo',
  'dijie', 'ऐड', 'एड', 'करो', 'कर', 'दीजिए', 'चाहिए',
]);
/** "aata do kilo, cheeni nahi": a negation drops the item just named, and is never an item itself. */
const ITEM_NEGATION = foldSet(['nahi', 'nahin', 'nai', 'नहीं', 'नही']);
/** "thoda aata": an amount that was not given. The item is kept and the amount is asked for. */
const VAGUE_AMOUNT = foldSet(['thoda', 'thodi', 'thode', 'thora', 'thori', 'kuch', 'kuchh', 'zara', 'jara', 'थोड़ा', 'थोड़ी', 'कुछ']);
/** A name heard after "aur" that the catalog does not know is kept (and asked about) only if it is this short. */
const MAX_UNKNOWN_NAME_TOKENS = 3;
const BALANCE_FILLER = foldSet(['hai', 'hain', 'hua', 'hoga', 'batao', 'bataiye', 'bataye', 'dikhao', 'bolo', 'kya', 'total', 'abhi', 'ab', 'ho', 'gaya', 'gayi', 'gaye', 'tha', 'raha', 'rha']);
/** "Anil Singh ko customer mein add karo": the words that make a sentence an add-customer request. */
const CUSTOMER_KW = foldSet(['customer', 'custumer', 'costumer', 'kastamar', 'kastmar', 'grahak', 'कस्टमर', 'कस्टमार', 'ग्राहक']);
const ADD_KW = foldSet([
  'add', 'aid', 'ad', 'ऐड', 'एड', 'jodo', 'jod', 'jodna', 'joden', 'जोड़ो', 'जोड़', 'जोड़ना', 'banao', 'bana', 'banado', 'banana',
  'naya', 'nayi', 'naye', 'नया', 'नई', 'new', 'register', 'darj', 'dalo', 'daalo', 'डालो', 'likho', 'likh', 'shamil',
]);
/** Words around the name that are not part of it. */
const ADD_PARTICLES = foldSet([
  'ka', 'ki', 'ke', 'ko', 'mein', 'men', 'me', 'mei', 'se', 'naam', 'nam', 'name', 'karo', 'kar', 'do', 'dijiye', 'kijiye',
  'dena', 'de', 'hai', 'please', 'pls', 'ek', 'mera', 'meri', 'ye', 'is', 'isko', 'bhi', 'list', 'mere', 'apne',
]);
const MAX_NAME_TOKENS = 4;
/** "kul udhaar kitna baaki hai" asks about the whole shop: these words never start a customer name. */
const SHOP_WIDE = foldSet(['kul', 'total', 'sab', 'saara', 'sara', 'poora', 'pura', 'tak', 'today', 'mera', 'hamara', 'sabka']);
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

// --- Add a customer ------------------------------------------------------------------------

/**
 * "Ramesh Kumar ko customer mein add karo", "naya customer Ramesh Kumar". Needs BOTH a customer word
 * and an add word, so ordinary bills, payments and balance questions never land here. Whatever is
 * left after those words and particles is the name; no name, or a number in it, is not understood.
 */
function parseAddCustomer(raw: readonly string[], f: readonly string[]): ParsedUtterance | null {
  if (!f.some((t) => CUSTOMER_KW.has(t)) || !f.some((t) => ADD_KW.has(t))) return null;
  if (f.some((t) => PAID_KW.has(t) || UDHAAR_KW.has(t) || BALANCE_KW.has(t))) return null;
  const name: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = f[i] ?? '';
    if (CUSTOMER_KW.has(t) || ADD_KW.has(t) || ADD_PARTICLES.has(t)) continue;
    const word = raw[i] ?? '';
    if (isNumeric(word)) return null;
    name.push(word);
  }
  if (name.length < 1 || name.length > MAX_NAME_TOKENS) return null;
  return { ...EMPTY, intent: 'add_customer', customer: titleCase(name), confidence: 0.9 };
}

// --- Add a product to Samaan ---------------------------------------------------------------

const SAMAAN_KW = foldSet(['samaan', 'saman', 'saaman', 'सामान', 'catalog', 'catalogue']);
/** "le lo" only means "add it" when the sentence starts with "samaan mein"; elsewhere it is an order. */
const TAKE_KW = foldSet(['le', 'lelo', 'lo']);
/** "do" is the number two in "do kilo" but the verb in "jod do"; it is a particle only after one of these. */
const GIVE_VERBS = foldSet(['karo', 'kar', 'jod', 'jodo', 'daal', 'daalo', 'dalo', 'add', 'aid', 'le', 'rakh', 'rakho', 'likh', 'likho', 'bana', 'banao']);
const PRODUCT_PARTICLES = foldSet(['rate', 'daam', 'bhav', 'bhaav', 'price', 'kimat', 'per', 'prati', 'har', 'wala', 'wali', 'list', 'लिस्ट', 'den', 'dein', 'दें', 'दीजिए']);

const MAX_PRODUCT_ROWS = 20;

/**
 * "Samaan mein jodo aata 45 rupaye kilo, cheeni 50 rupaye kilo, Maggi 14 packet": two or more
 * name + price rows. STT often drops commas and units, so a row ends at its price: words collect
 * as the name until a number run appears, then an optional "rupaye" and unit finish that row.
 * Any row without a price, a repeated name or a count above one makes the whole list ambiguous.
 * One row is left to parseAddProduct.
 */
function parseAddProducts(raw: readonly string[], f: readonly string[]): ParsedUtterance | null {
  if (!f.some((t) => SAMAAN_KW.has(t))) return null;
  if (!f.some((t) => ADD_KW.has(t)) && !(SAMAAN_KW.has(f[0] ?? '') && f.some((t) => TAKE_KW.has(t)))) return null;
  if (f.some((t) => CUSTOMER_KW.has(t) || PAID_KW.has(t) || UDHAAR_KW.has(t) || BALANCE_KW.has(t) || RATE_KW.has(t))) return null;

  const rows: ParsedItemOutput[] = [];
  const seen = new Set<string>();
  let words: string[] = [];
  let rowUnit: Unit | null = null;
  const finish = (price: number): boolean => {
    if (words.length < 1 || words.length > MAX_NAME_TOKENS || price <= 0 || !Number.isInteger(price)) return false;
    const key = words.join(' ').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    rows.push({ name: titleCase(words), quantity: 1, unit: rowUnit, spokenPrice: { amount: price, basis: 'unit', unit: rowUnit } });
    words = [];
    rowUnit = null;
    return true;
  };

  let i = 0;
  while (i < raw.length) {
    const t = f[i] ?? '';
    const word = raw[i] ?? '';
    if (SAMAAN_KW.has(t) || ADD_KW.has(t) || TAKE_KW.has(t) || PRODUCT_PARTICLES.has(t) || SEPARATORS.has(t)) { i++; continue; }
    const countWord = t === fold('ek') || t === fold('do');
    if (ADD_PARTICLES.has(t) && (!countWord || (t === fold('do') && GIVE_VERBS.has(f[i - 1] ?? '')))) { i++; continue; }
    // "ek kilo": a one-unit phrase belongs to the row it sits in.
    const qty = extractQuantityAndUnit(raw.slice(i));
    if (qty && qty.unit !== null) {
      if (qty.quantity !== 1) return null;
      rowUnit = qty.unit;
      i += qty.consumed;
      continue;
    }
    let price: { value: number; size: number } | null = null;
    for (let size = Math.min(4, raw.length - i); size >= 1 && !price; size--) {
      const value = parseNumber(raw.slice(i, i + size).join(' '));
      if (value !== null) price = { value, size };
    }
    if (price) {
      i += price.size;
      while (i < raw.length && (isMoneyWord(raw[i] ?? '') || PRODUCT_PARTICLES.has(f[i] ?? ''))) i++;
      const unitWord = raw[i] ?? '';
      const asUnit = unitWord.length > 1 ? normalizeUnit(unitWord) : null;
      if (asUnit) { rowUnit = rowUnit ?? asUnit; i++; }
      if (!finish(price.value)) return null;
      continue;
    }
    const asUnit = word.length > 1 ? normalizeUnit(word) : null;
    if (asUnit) { rowUnit = rowUnit ?? asUnit; i++; continue; }
    words.push(word);
    i++;
  }
  if (words.length > 0 || rows.length < 2 || rows.length > MAX_PRODUCT_ROWS) return null;
  return { ...EMPTY, intent: 'add_products', items: rows, confidence: 0.9 };
}

/** The longest number run ending right before, or starting right after, the money word. */
function priceAround(raw: readonly string[], money: number): { value: number; from: number; to: number } | null {
  for (let size = Math.min(4, money); size >= 1; size--) {
    const value = parseNumber(raw.slice(money - size, money).join(' '));
    if (value !== null) return { value, from: money - size, to: money - 1 };
  }
  for (let size = Math.min(4, raw.length - money - 1); size >= 1; size--) {
    const value = parseNumber(raw.slice(money + 1, money + 1 + size).join(' '));
    if (value !== null) return { value, from: money + 1, to: money + size };
  }
  return null;
}

/**
 * "Samaan mein chawal add karo 40 rupaye kilo", "सामान में एक किलो चावल ले लो, चालीस रुपए के एक किलो".
 * Needs a Samaan word and an add word. The price is per unit, so a count above one
 * ("do kilo chawal 80 rupaye") is ambiguous and not understood. With no unit spoken the unit stays
 * null and the gateway shows "piece". The user always confirms the card, so a wrong guess is visible.
 * With no price at all ("samaan mein rajma add karo") the result has no spokenPrice: the gateway asks
 * for the rate instead of guessing one. A spoken price that cannot be used is still not understood.
 */
function parseAddProduct(raw: readonly string[], f: readonly string[]): ParsedUtterance | null {
  if (!f.some((t) => SAMAAN_KW.has(t))) return null;
  const addWord = f.some((t) => ADD_KW.has(t)) || (SAMAAN_KW.has(f[0] ?? '') && f.some((t) => TAKE_KW.has(t)));
  if (!addWord) return null;
  if (f.some((t) => CUSTOMER_KW.has(t) || PAID_KW.has(t) || UDHAAR_KW.has(t) || BALANCE_KW.has(t))) return null;

  const money = raw.findIndex(isMoneyWord);
  const price = money < 0 ? null : priceAround(raw, money);
  if (money >= 0 && (!price || price.value <= 0 || !Number.isInteger(price.value))) return null;

  const left: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = f[i] ?? '';
    if (i === money || (price && i >= price.from && i <= price.to)) continue;
    if (SAMAAN_KW.has(t) || ADD_KW.has(t) || TAKE_KW.has(t) || PRODUCT_PARTICLES.has(t)) continue;
    // "ek" and "do" can be counts ("do kilo"), so they are only particles in "... kar do".
    const countWord = t === fold('ek') || t === fold('do');
    if (ADD_PARTICLES.has(t) && (!countWord || (t === fold('do') && GIVE_VERBS.has(f[i - 1] ?? '')))) continue;
    if (t === fold('ek') && !f.slice(i + 1).some((x) => normalizeUnit(x) !== null)) continue;
    left.push(raw[i] ?? '');
  }

  let unit: Unit | null = null;
  const name: string[] = [];
  for (let i = 0; i < left.length; i++) {
    const found = extractQuantityAndUnit(left.slice(i));
    if (found) {
      if (found.quantity !== 1 || (unit !== null && found.unit !== null && found.unit !== unit)) return null;
      unit = unit ?? found.unit;
      i += found.consumed - 1;
      continue;
    }
    const word = left[i] ?? '';
    // A lone "g" or "l" is part of a name ("Parle G"), not a unit: people say "gram" and "litre".
    const asUnit = word.length > 1 ? normalizeUnit(word) : null;
    if (asUnit) {
      if (unit !== null && unit !== asUnit) return null;
      unit = asUnit;
      continue;
    }
    if (isNumeric(word)) {
      if (parseNumber(word) === 1) continue;
      return null;
    }
    name.push(word);
  }
  if (name.length < 1 || name.length > MAX_NAME_TOKENS) return null;
  return {
    ...EMPTY,
    intent: 'add_product',
    items: [{ name: titleCase(name), quantity: 1, unit, ...(price ? { spokenPrice: { amount: price.value, basis: 'unit' as const, unit } } : {}) }],
    confidence: 0.9,
  };
}

// --- Change a product's rate ---------------------------------------------------------------

const RATE_KW = foldSet(['rate', 'daam', 'dam', 'bhav', 'bhaav', 'price', 'kimat', 'keemat', 'रेट', 'दाम', 'भाव', 'कीमत']);
const CHANGE_KW = foldSet(['karo', 'kar', 'kardo', 'badlo', 'badal', 'badalna', 'set', 'kijiye', 'kiye', 'ho', 'gaya', 'gayi', 'hua', 'rakho', 'rakh']);
const RATE_FILLER = foldSet(['ka', 'ki', 'ke', 'ko', 'ab', 'se', 'hai', 'mein', 'men', 'me', 'ek', 'do', 'bhi', 'naya', 'nayi', 'new', 'please', 'pls']);

/**
 * "chawal ka rate 45 karo", "चावल का रेट पैंतालीस रुपए कर दो". Needs a rate word, a change word and a
 * number right after the rate word. The product must already exist (the gateway checks), and the
 * price is per unit. A model never supplies this price: it is the number that was spoken.
 */
function parseUpdatePrice(raw: readonly string[], f: readonly string[]): ParsedUtterance | null {
  const rate = f.findIndex((t) => RATE_KW.has(t));
  if (rate < 0 || !f.some((t) => CHANGE_KW.has(t))) return null;
  if (f.some((t) => SAMAAN_KW.has(t) || ADD_KW.has(t) || CUSTOMER_KW.has(t) || PAID_KW.has(t) || UDHAAR_KW.has(t) || BALANCE_KW.has(t))) return null;

  let start = rate + 1;
  while (start < raw.length && RATE_FILLER.has(f[start] ?? '') && !isNumeric(raw[start] ?? '')) start++;
  let run: { value: number; end: number } | null = null;
  for (let size = Math.min(4, raw.length - start); size >= 1 && !run; size--) {
    const value = parseNumber(raw.slice(start, start + size).join(' '));
    if (value !== null) run = { value, end: start + size };
  }
  if (!run || run.value <= 0 || !Number.isInteger(run.value)) return null;

  let unit: Unit | null = null;
  const name: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (i === rate || (i >= start && i < run.end)) continue;
    const t = f[i] ?? '';
    if (RATE_FILLER.has(t) || CHANGE_KW.has(t) || isMoneyWord(raw[i] ?? '')) continue;
    const word = raw[i] ?? '';
    const asUnit = word.length > 1 ? normalizeUnit(word) : null;
    if (asUnit) { unit = asUnit; continue; }
    if (isNumeric(word)) return null;
    name.push(word);
  }
  if (name.length < 1 || name.length > MAX_NAME_TOKENS) return null;
  return {
    ...EMPTY,
    intent: 'update_price',
    items: [{ name: titleCase(name), quantity: 1, unit, spokenPrice: { amount: run.value, basis: 'unit', unit } }],
    confidence: 0.9,
  };
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
  if (!matcher) return findLeadingNameBeforeQuestion(w, undefined);
  return findCustomerWithoutMarker(w, matcher) ?? findTrailingCustomer(w, matcher) ?? findLeadingNameBeforeQuestion(w, matcher);
}

/**
 * "Mohan Lal ji kitna udhaar hai" / "मोहन लाल जी, क्या कितना उधार है?": no "ka" particle, and the
 * customer may not exist yet. Everything before the first question word is the name, but only
 * when the rest of the sentence is nothing but question words, so an item can never become a name.
 */
function findLeadingNameBeforeQuestion(w: Working, matcher: CatalogMatcher | undefined): string | null {
  const { raw, f } = w;
  const isQuestionWord = (t: string) => BALANCE_KW.has(t) || UDHAAR_KW.has(t) || BALANCE_FILLER.has(t);
  let first = 0;
  while (first < f.length && CUSTOMER_FILLER.has(f[first] ?? '')) first++;
  let end = first;
  while (end < f.length && !isQuestionWord(f[end] ?? '')) end++;
  if (end === f.length || end - first < 1 || end - first > MAX_NAME_TOKENS) return null;
  if (!f.slice(end).every(isQuestionWord) || !f.slice(end).some((t) => BALANCE_KW.has(t) || UDHAAR_KW.has(t))) return null;
  const name = raw.slice(first, end);
  const folded = f.slice(first, end);
  if (name.some(isNumeric) || folded.some((t) => SHOP_WIDE.has(t) || NOISE.has(t) || PAID_KW.has(t) || normalizeUnit(t) !== null)) return null;
  const joined = name.join(' ');
  if (matcher && matcher.matchProduct(joined).best && !matcher.matchCustomer(joined).best) return null;
  markRange(w, first, end - 1);
  return titleCase(name);
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

function itemsInSegment(
  w: Working,
  input: readonly Piece[],
  matcher: CatalogMatcher | undefined,
  out: ParsedItemOutput[],
  missing: MissingItem[],
  listed: boolean,
): void {
  // "thoda aata": drop the vague word, keep the item, and flag its amount for a question.
  let pieces = input.filter((p) => !VAGUE_AMOUNT.has(fold(p.raw)));
  const vague = pieces.length < input.length;
  for (const p of input) if (VAGUE_AMOUNT.has(fold(p.raw))) w.used[p.index] = true;
  const mark = (item: ParsedItemOutput): ParsedItemOutput => (vague ? { ...item, quantityUnclear: true } : item);
  const priced = pricedItems(pieces);
  if (priced.consumed > 0) {
    out.push(...priced.items);
    for (const piece of pieces.slice(0, priced.consumed)) w.used[piece.index] = true;
    pieces = pieces.slice(priced.consumed);
  }
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
    } else if (ext.quantity > 0) {
      // "... aur do kilo": the amount was heard but the item was not. Keep it so it can be asked for.
      missing.push({ quantity: ext.quantity, unit: ext.unit });
      for (let q = i; q < afterQuantity; q++) w.used[pieces[q]?.index ?? 0] = true;
    }
    pending = [];
    i = k;
  }
  if (pending.length === 0 || !matcher) return;
  // A bare product name with no number: "Maggi" means one. The first one must be in the catalog (so
  // filler never becomes an item); one listed after "aur" is kept even if unknown, so it is asked
  // about instead of disappearing.
  const name = pending.map((p) => p.raw).join(' ');
  const known = matcher.matchProduct(name).best !== null;
  const shortUnknown = listed && pending.length <= MAX_UNKNOWN_NAME_TOKENS && !pending.some((p) => isNumeric(p.raw));
  if ((out.length === 0 || listed) && (known || shortUnknown)) {
    out.push(mark({ name: name.slice(0, LIMITS.maxNameLength), quantity: 1, unit: null }));
    for (const p of pending) w.used[p.index] = true;
  }
}

function findItems(w: Working, matcher: CatalogMatcher | undefined, missing: MissingItem[]): ParsedItemOutput[] {
  for (let i = 1; i < w.f.length; i++) {
    if (!w.used[i] && w.f[i] === fold('do') && DO_AFTER.has(w.f[i - 1] ?? '')) w.used[i] = true;
  }
  const items: ParsedItemOutput[] = [];
  let segment: Piece[] = [];
  /** True for a segment that follows "aur": the speaker is listing items. */
  let listed = false;
  const flush = (): void => {
    if (segment.length > 0) itemsInSegment(w, segment, matcher, items, missing, listed);
    segment = [];
  };
  for (let i = 0; i < w.raw.length; i++) {
    const t = w.f[i] ?? '';
    if (w.used[i]) {
      flush();
      listed = false;
    } else if (SEPARATORS.has(t)) {
      w.used[i] = true;
      flush();
      listed = true;
    } else if (ITEM_NEGATION.has(t)) {
      // "cheeni nahi": whatever was just named is not wanted. "nahi, do kilo": a correction follows.
      w.used[i] = true;
      for (const p of segment) w.used[p.index] = true;
      segment = [];
    } else if (['ke', 'ka', 'ki', 'के', 'का', 'की'].includes(w.raw[i] ?? '') && parseNumber(w.raw[i - 1] ?? '') !== null && !hasMoneyTail(segment)) {
      segment.push({ raw: 'rupaye', index: i });
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
    if (item.spokenPrice) { sum += Number.isInteger(item.spokenPrice.amount) && item.spokenPrice.amount >= 0 ? 1 : 0.2; continue; }
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

/**
 * "haan" / "nahi" and a few polite variants, and nothing else: the whole sentence must be answer words.
 * The AI-only mode uses just this (no other rules), so a bare yes or no is instant and a model can
 * never save or cancel a bill by itself.
 */
export function shortAnswer(transcript: string): 'confirm' | 'cancel' | null {
  if (typeof transcript !== 'string') return null;
  const raw = tokenizeSpeech(transcript.slice(0, LIMITS.maxTranscriptLength));
  return answerIntent(raw.map(fold));
}

export function parseUtterance(transcript: string, matcher?: CatalogMatcher): ParsedUtterance {
  if (typeof transcript !== 'string') return { ...EMPTY };
  const text = transcript.slice(0, LIMITS.maxTranscriptLength);
  if (isInstructionLike(text)) return { ...EMPTY };

  const raw = tokenizeSpeech(text.replace(/[−-](?=\s*[\d०-९₹])/g, ' minus ').replace(/₹/g, ' rupaye ').replace(/%/g, ' percent '));
  if (raw.length === 0) return { ...EMPTY };
  const f = raw.map(fold);

  const answer = answerIntent(f);
  if (answer) return { ...EMPTY, intent: answer, confidence: 0.95 };

  const addCustomer = parseAddCustomer(raw, f);
  if (addCustomer) return addCustomer;

  const addProducts = parseAddProducts(raw, f);
  if (addProducts) return addProducts;

  const addProduct = parseAddProduct(raw, f);
  if (addProduct) return addProduct;

  const updatePrice = parseUpdatePrice(raw, f);
  if (updatePrice) return updatePrice;

  const stockOut = parseStockOut({ raw, f, used: [] }, matcher);
  if (stockOut) {
    return { ...EMPTY, intent: 'out_of_stock', items: [{ name: stockOut.name, quantity: 1, unit: null }], confidence: stockOut.confidence };
  }

  const w: Working = { raw, f, used: new Array<boolean>(raw.length).fill(false) };
  const customer = findCustomer(w, matcher);
  const { adjust, warnings: adjustWarnings } = extractAdjust(w);
  const amounts = findAmounts(w);
  const missingItems: MissingItem[] = [];
  const items = findItems(w, matcher, missingItems);

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

  if (adjust) result.adjust = adjust;
  if (adjustWarnings.length > 0) result.adjustWarnings = adjustWarnings;
  if (missingItems.length > 0) result.missingItems = missingItems.slice(0, LIMITS.maxUnresolved);

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
  const summary = customer === null && amounts.paid === null && amounts.udhaar === null ? parseSummaryQuery({ raw, f, used: [] }) : null;
  if (summary) {
    return { ...EMPTY, intent: 'query_summary', confidence: summary.confidence };
  }
  if (customer !== null && amounts.udhaar !== null && amounts.udhaar > 0) {
    result.intent = 'create_bill';
    result.confidence = 0.35;
    return result;
  }
  return { ...EMPTY, confidence: 0.1, ...(result.missingItems ? { missingItems: result.missingItems } : {}) };
}
