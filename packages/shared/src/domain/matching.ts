/**
 * Fuzzy matching of spoken product and customer names against a catalog snapshot.
 *
 * Pipeline per lookup: normalize (spelling-variant folding, Devanagari -> Roman,
 * honorific stripping for customers) -> exact alias hit (O(1)) -> token overlap with
 * per-token fuzziness (Damerau-Levenshtein) -> ranked candidates.
 *
 * Decisions:
 * - Near-misses must not match: fuzzy token matching needs >= 5 letters and at most one
 *   edit (two edits from 8 letters), so "soda" never matches "soap" and "namkeen" never
 *   matches "namak".
 * - A query that covers only some of a multi-word name ("dal" for "toor dal") scores
 *   about 0.7: shown as a candidate, never auto-picked. Several equal candidates set
 *   `ambiguous`, so the caller asks instead of guessing.
 * - Extra words in the query ("chawal ka packet") cost a small penalty, not a miss.
 */
import type { CatalogCustomer, CatalogProduct } from '../protocol/client';

export interface Candidate {
  id: string;
  name: string;
  /** 0..1 */
  score: number;
}

export interface MatchResult {
  /** Ranked best first, at most MAX_CANDIDATES, all scoring at least CANDIDATE_MIN_SCORE. */
  candidates: Candidate[];
  /** Top candidate when it is confident enough to use, else null. */
  best: Candidate | null;
  /** The top two are too close to tell apart; the caller should ask. */
  ambiguous: boolean;
}

export interface CustomerMatchResult extends MatchResult {
  /** No confident match and no ambiguity: treat the spoken name as a new customer. */
  isNew: boolean;
}

export const MATCH_MIN_SCORE = 0.72;
export const CANDIDATE_MIN_SCORE = 0.5;
export const AMBIGUITY_GAP = 0.08;
/** Below this a top candidate is noise, not a partial match worth asking about. */
export const PARTIAL_MATCH_MIN = 0.65;
const MAX_CANDIDATES = 5;
const TOKEN_MATCH_MIN = 0.8;

// --- Devanagari -> Roman -------------------------------------------------------------

const CONSONANTS: Readonly<Record<string, string>> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'f', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh',
  ष: 'sh', स: 's', ह: 'h',
};
const VOWELS: Readonly<Record<string, string>> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
};
const MATRAS: Readonly<Record<string, string>> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};
const VIRAMA = '्';
const NUKTA = '़';
const NASALS = new Set(['ं', 'ँ']);
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/** Approximate transliteration with word-final schwa deletion (आटा -> ata, नमक -> namak). */
export function devanagariToLatin(text: string): string {
  if (!DEVANAGARI_RANGE.test(text)) return text;
  let out = '';
  let pendingA = false; // the last consonant still carries its inherent "a"
  for (const ch of text.normalize('NFC')) {
    const cons = CONSONANTS[ch];
    if (cons !== undefined) {
      if (pendingA) out += 'a';
      out += cons;
      pendingA = true;
      continue;
    }
    const matra = MATRAS[ch];
    if (matra !== undefined) {
      out += matra;
      pendingA = false;
      continue;
    }
    if (ch === VIRAMA) {
      pendingA = false;
      continue;
    }
    if (ch === NUKTA) continue;
    if (NASALS.has(ch)) {
      if (pendingA) out += 'a';
      out += 'n';
      pendingA = false;
      continue;
    }
    const vowel = VOWELS[ch];
    if (vowel !== undefined) {
      if (pendingA) out += 'a';
      out += vowel;
      pendingA = false;
      continue;
    }
    // Any other character ends the word: a trailing consonant drops its inherent "a".
    pendingA = false;
    out += ch;
  }
  return out;
}

// --- Normalisation ---------------------------------------------------------------------

/** Folds Roman spelling variants: aa/a, ee/i, oo/u, v/w, ph/f and doubled letters. */
function unify(token: string): string {
  return token
    .replace(/aa+/g, 'a')
    .replace(/ee+/g, 'i')
    .replace(/oo+/g, 'u')
    .replace(/w/g, 'v')
    .replace(/ph/g, 'f')
    .replace(/(.)\1+/g, '$1');
}

const HONORIFICS = new Set(
  [
    'ji', 'jee', 'uncle', 'ankal', 'aunty', 'auntie', 'bhaiya', 'bhai', 'bhaiyya', 'sir', 'madam',
    'mam', 'didi', 'behen', 'behan', 'sahab', 'sahib', 'saab', 'shri', 'shree', 'mr', 'mrs', 'ms',
    'bhabhi', 'babu', 'dada', 'chacha', 'mama',
  ].map(unify),
);

/** Words around a product name that carry no product information (already unify()-folded). */
const FILLER_WORDS: ReadonlySet<string> = new Set(
  ['ka', 'ki', 'ke', 'ko', 'ek', 'wala', 'wali', 'wale', 'packet', 'pkt', 'pack', 'aur', 'de', 'dena', 'chahiye', 'bhi', 'please', 'mujhe', 'wo', 'ye', 'uh', 'um', 'umm', 'hmm', 'matlab', 'toh', 'acha', 'accha', 'yaar'].map(unify),
);

const SPLIT = /[^\p{L}\p{N}]+/gu;

export interface NormalizeOptions {
  /** Drop "ji", "uncle", "sahab" ... Used for customer names. Default true. */
  stripHonorifics?: boolean;
}

export function normalize(text: string, options: NormalizeOptions = {}): string {
  if (typeof text !== 'string') return '';
  const strip = options.stripHonorifics ?? true;
  const latin = devanagariToLatin(text.normalize('NFC')).toLowerCase();
  const out: string[] = [];
  for (const raw of latin.split(SPLIT)) {
    if (raw === '') continue;
    const token = unify(raw);
    if (strip && HONORIFICS.has(token)) continue;
    out.push(token);
  }
  return out.join(' ');
}

// --- Damerau-Levenshtein (optimal string alignment) -----------------------------------

export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev2 = new Array<number>(lb + 1).fill(0);
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
      }
      cur[j] = v;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb] ?? Math.max(la, lb);
}

/**
 * Edit distance capped at `max` (returns max + 1 when it is larger). Trims the shared
 * prefix and suffix first, which leaves a tiny remainder for almost every comparison.
 */
function boundedDistance(a: string, b: string, max: number): number {
  let start = 0;
  let endA = a.length;
  let endB = b.length;
  while (start < endA && start < endB && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  const lenA = endA - start;
  const lenB = endB - start;
  if (Math.max(lenA, lenB) > 2 * max) return max + 1;
  const d = damerauLevenshtein(a.slice(start, endA), b.slice(start, endB));
  return d > max ? max + 1 : d;
}

// --- Scoring --------------------------------------------------------------------------

/** Longer queries are cut here: bounds the work a hostile transcript can cause. */
const MAX_QUERY_TOKENS = 32;
const VOWEL_END = /[aeiou]$/;
const stem = (t: string): string => (t.length >= 3 && VOWEL_END.test(t) ? t.slice(0, -1) : t);

interface Token {
  text: string;
  stem: string;
}
interface Form {
  text: string;
  tokens: Token[];
}
interface Entry {
  id: string;
  name: string;
  forms: Form[];
}

function toTokens(normalized: string): Token[] {
  return normalized === ''
    ? []
    : normalized.split(' ', MAX_QUERY_TOKENS).map((text) => ({ text, stem: stem(text) }));
}

function tokenSim(a: Token, b: Token): number {
  if (a.text === b.text) return 1;
  if (a.stem === b.stem && a.stem.length >= 2) return 0.92;
  const shorter = Math.min(a.text.length, b.text.length);
  if (shorter < 5) return 0;
  const allowed = shorter >= 8 ? 2 : 1;
  if (Math.abs(a.text.length - b.text.length) > allowed) return 0;
  const d = boundedDistance(a.text, b.text, allowed);
  if (d > allowed) return 0;
  return 1 - d / Math.max(a.text.length, b.text.length);
}

function bestSim(t: Token, others: readonly Token[]): number {
  let best = 0;
  for (const o of others) {
    const s = tokenSim(t, o);
    if (s > best) best = s;
  }
  return best >= TOKEN_MATCH_MIN ? best : 0;
}

/** Cheap test that skips forms sharing nothing with the query (no allocation). */
function mayMatch(query: readonly Token[], form: Form): boolean {
  for (const q of query) {
    for (const f of form.tokens) {
      if (q.stem === f.stem) return true;
      if (q.text.length >= 5 && f.text.length >= 5 && q.text.charCodeAt(0) === f.text.charCodeAt(0)) return true;
    }
  }
  return false;
}

function scoreForm(query: readonly Token[], form: Form): number {
  let formSum = 0;
  let allFormMatched = true;
  for (const t of form.tokens) {
    const s = bestSim(t, query);
    if (s === 0) allFormMatched = false;
    formSum += s;
  }
  const formCov = formSum / form.tokens.length;

  let qSum = 0;
  let filler = 0;
  let content = 0;
  for (let i = 0; i < query.length; i++) {
    const q = query[i];
    if (!q) continue;
    const s = bestSim(q, form.tokens);
    qSum += s;
    if (s > 0) continue;
    if (FILLER_WORDS.has(q.text)) filler++;
    else content++;
  }

  if (allFormMatched) {
    // Unmatched query words: harmless filler ("ka", "packet") costs a little; a real extra
    // word ("hari" in "hari mirch") says it is a different product.
    return formCov * (1 - Math.min(0.2, 0.04 * filler) - Math.min(0.6, 0.4 * content));
  }
  const qCov = qSum / query.length;
  if (qCov >= 0.99) return 0.55 + 0.3 * formCov; // query is a part of a longer name
  return 0.5 * qCov * formCov;
}

interface Nameable {
  id: string;
  name: string;
  aliases: readonly string[];
}

class NameIndex {
  private readonly entries: Entry[] = [];
  private readonly exact = new Map<string, Entry[]>();
  /** Inverted indexes: only entries sharing a stem (or a long-word first letter) are scored. */
  private readonly byStem = new Map<string, Entry[]>();
  private readonly byFirst = new Map<number, Entry[]>();

  constructor(
    items: readonly Nameable[],
    private readonly stripHonorifics: boolean,
  ) {
    for (const item of items) {
      const seen = new Set<string>();
      const forms: Form[] = [];
      for (const raw of [item.name, ...item.aliases]) {
        const text = normalize(raw, { stripHonorifics });
        if (text === '' || seen.has(text)) continue;
        seen.add(text);
        forms.push({ text, tokens: toTokens(text) });
      }
      const entry: Entry = { id: item.id, name: item.name, forms };
      this.entries.push(entry);
      for (const f of forms) {
        const list = this.exact.get(f.text);
        if (list) list.push(entry);
        else this.exact.set(f.text, [entry]);
        for (const t of f.tokens) {
          addOnce(this.byStem, t.stem, entry);
          if (t.text.length >= 5) addOnce(this.byFirst, t.text.charCodeAt(0), entry);
        }
      }
    }
  }

  private candidatesFor(query: readonly Token[]): Set<Entry> {
    const found = new Set<Entry>();
    for (const q of query) {
      for (const e of this.byStem.get(q.stem) ?? []) found.add(e);
      if (q.text.length >= 5) for (const e of this.byFirst.get(q.text.charCodeAt(0)) ?? []) found.add(e);
    }
    return found;
  }

  match(query: string): MatchResult {
    const q = normalize(query, { stripHonorifics: this.stripHonorifics });
    if (q === '') return { candidates: [], best: null, ambiguous: false };

    const hits = this.exact.get(q);
    if (hits) {
      const candidates = hits.slice(0, MAX_CANDIDATES).map((e) => ({ id: e.id, name: e.name, score: 1 }));
      return { candidates, best: candidates[0] ?? null, ambiguous: candidates.length > 1 };
    }

    const qTokens = toTokens(q);
    const scored: Candidate[] = [];
    for (const e of this.candidatesFor(qTokens)) {
      let top = 0;
      for (const f of e.forms) {
        if (!mayMatch(qTokens, f)) continue;
        const s = scoreForm(qTokens, f);
        if (s > top) top = s;
      }
      if (top >= CANDIDATE_MIN_SCORE) scored.push({ id: e.id, name: e.name, score: round3(top) });
    }
    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, MAX_CANDIDATES);
    const first = candidates[0];
    const second = candidates[1];
    // A lone partial match ("Kiran" when only Kiran Joshi exists) is good enough to use;
    // several partial matches are not, and are reported as ambiguous instead.
    const best =
      first &&
      (first.score >= MATCH_MIN_SCORE ||
        (first.score >= PARTIAL_MATCH_MIN && (!second || second.score < CANDIDATE_MIN_SCORE)))
        ? first
        : null;
    const ambiguous =
      first !== undefined &&
      second !== undefined &&
      first.score >= PARTIAL_MATCH_MIN &&
      second.score >= PARTIAL_MATCH_MIN &&
      first.score - second.score < AMBIGUITY_GAP;
    return { candidates, best, ambiguous };
  }
}

function addOnce<K>(map: Map<K, Entry[]>, key: K, entry: Entry): void {
  const list = map.get(key);
  if (!list) map.set(key, [entry]);
  else if (!list.includes(entry)) list.push(entry);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export type MatchableCustomer = Pick<CatalogCustomer, 'id' | 'name' | 'aliases'>;

/** Anything the parser and billing need from a catalog; CatalogIndex implements it. */
export interface CatalogMatcher {
  matchProduct(query: string): MatchResult;
  matchCustomer(query: string): CustomerMatchResult;
}

/** Built once per catalog snapshot; lookups are then cheap. */
export class CatalogIndex implements CatalogMatcher {
  private readonly products: NameIndex;
  private readonly customers: NameIndex;
  private readonly byId = new Map<string, CatalogProduct>();

  constructor(products: readonly CatalogProduct[], customers: readonly MatchableCustomer[] = []) {
    this.products = new NameIndex(products, false);
    this.customers = new NameIndex(customers, true);
    for (const p of products) this.byId.set(p.id, p);
  }

  matchProduct(query: string): MatchResult {
    return this.products.match(query);
  }

  matchCustomer(query: string): CustomerMatchResult {
    const result = this.customers.match(query);
    const top = result.candidates[0];
    const isNew =
      result.best === null &&
      !result.ambiguous &&
      normalize(query) !== '' &&
      (top === undefined || top.score < PARTIAL_MATCH_MIN);
    return { ...result, isNew };
  }

  getProduct(id: string): CatalogProduct | undefined {
    return this.byId.get(id);
  }
}
