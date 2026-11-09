/**
 * Speech -> number, for Hinglish (Roman script and Devanagari) as a speech recogniser
 * would write it.
 *
 * Ambiguity decisions (kept here so the behaviour is explainable):
 * - Spoken fractions: aadha 0.5, dedh 1.5, dhai 2.5 are plain numbers. sawa (+0.25),
 *   saade (+0.5) and paune (-0.25) shift the NEXT number: "saade teen" = 3.5,
 *   "paune do" = 1.75. Directly before a multiplier the base is 1: "sawa sau" = 125,
 *   "paune sau" = 75. On their own they stand for 1.25 / 1.5 / 0.75.
 * - Multipliers must descend (crore > lakh > hazaar > sau), and "sau" may appear once per
 *   group: "do sau teen sau" is rejected, not guessed.
 * - "pachas sau" is 5000 (fifty hundreds), as people say it.
 * - Two bare numbers side by side ("do teen") are ambiguous and give null.
 * - Anything not understood gives null; the function never throws and never returns NaN.
 * - Roman spelling variants are a dictionary, not a phonetic guess. Add to VARIANTS when
 *   real transcripts show a new spelling.
 */
import type { Unit } from '../protocol/common';
import { DEVANAGARI_0_99, LATIN_0_99 } from './hindiNumbers';

const MAX_VALUE = 9_999_999_999;
const MAX_NUMBER_TOKENS = 8;

/** Extra Roman spellings per value (index = value). The canonical spelling is in LATIN_0_99. */
const VARIANTS: Readonly<Record<number, readonly string[]>> = {
  0: ['shunya', 'zero', 'jero'],
  3: ['tin'],
  4: ['char'],
  5: ['panch', 'paach'],
  6: ['chhe', 'chah', 'chhey', 'chhay'],
  7: ['sat'],
  8: ['ath'],
  9: ['nao'],
  10: ['dus'],
  11: ['gyaarah', 'giyarah'],
  12: ['baarah', 'bara'],
  13: ['tera', 'terha'],
  14: ['chaudaha', 'chodah', 'chaudha'],
  15: ['pandra', 'pandrha'],
  16: ['sola'],
  17: ['satra'],
  18: ['athara', 'athaarah', 'atthara'],
  19: ['unis', 'unnees'],
  20: ['bis'],
  21: ['ikkees', 'ekkis', 'ikis'],
  22: ['bais', 'bayis', 'baaees', 'bayees', 'baees'],
  23: ['teeis'],
  24: ['chaubees', 'chaubbis', 'chobis'],
  25: ['pachis', 'pachees', 'pacchis', 'pachchees'],
  26: ['chhabis', 'chabbis', 'chhabees'],
  27: ['sataees', 'satais', 'sattaees', 'sattaais', 'sataais', 'sattais'],
  28: ['athais', 'atthaees', 'athaees', 'attaais', 'atthais', 'athaais', 'atthaais', 'attais'],
  29: ['unatees', 'untees', 'unatis'],
  30: ['tis'],
  31: ['iktis', 'ikatis', 'ikattees'],
  32: ['batees', 'battees'],
  33: ['tentis', 'tetis', 'taintees'],
  34: ['chauntees', 'chaunties', 'chautis'],
  35: ['paintees', 'paitis', 'paentis'],
  36: ['chhattees', 'chattis', 'chhatis'],
  37: ['saintees', 'saitis', 'saentis'],
  38: ['adtees', 'artis', 'adatis'],
  39: ['untalis', 'unatalis', 'unataalis'],
  40: ['chaalis', 'chalees'],
  41: ['ikatalis', 'iktaalis', 'ektalis'],
  42: ['byalis', 'bayaalis', 'biyalis', 'bayalees'],
  43: ['tentalis', 'taitalis'],
  44: ['chavalis', 'chauwalis', 'chauvaalis'],
  45: ['paitalis', 'paentalis', 'paintaalis'],
  46: ['chhyalis', 'chiyalis', 'chhiyaalis'],
  47: ['saitalis', 'sadtalis', 'saintaalis'],
  48: ['artalis', 'adtaalis'],
  49: ['unanchas', 'unas', 'unchaas'],
  50: ['pachaas', 'pacchas'],
  51: ['ikawan', 'ekyavan', 'ikyawan', 'ikyaavan'],
  52: ['baavan', 'bawan'],
  53: ['trepan', 'tirepan', 'tirpun'],
  54: ['chauwan', 'chavan'],
  55: ['pachpun', 'pachapan'],
  56: ['chhapan', 'chappan'],
  57: ['satavan', 'sattawan', 'satawan'],
  58: ['athavan', 'atthawan', 'athawan'],
  59: ['unasath', 'unsaath'],
  60: ['sath'],
  61: ['iksaath', 'ekshath'],
  62: ['basath', 'bayasath'],
  63: ['tresath', 'tirsaath'],
  64: ['chausath', 'chaunsaath'],
  65: ['paintsath', 'painsat', 'painsaath'],
  66: ['chhesath', 'chiyasath'],
  67: ['sarsath', 'sadsat', 'sadsaath'],
  68: ['arsath', 'adsaath', 'adsat'],
  69: ['unahattar', 'unhatar'],
  70: ['satar'],
  71: ['ikahattar', 'ekhattar'],
  72: ['bahatar', 'bahuttar'],
  73: ['tihatar'],
  74: ['chauhatar'],
  75: ['pachattar', 'pachhatar'],
  76: ['chihattar', 'chhihatar'],
  77: ['sathattar', 'satahattar'],
  78: ['athhattar', 'athahattar'],
  79: ['unasi', 'unnasi'],
  80: ['asi'],
  81: ['ekyasi', 'ikiyasi'],
  82: ['biyasi', 'bayaasi'],
  83: ['tiraasi'],
  84: ['chaurasee'],
  85: ['pachaasi'],
  86: ['chiyasi'],
  87: ['satasi'],
  88: ['athasi'],
  89: ['nawasi'],
  90: ['nabbay', 'nabbey'],
  91: ['ikyanbe', 'ekyanve'],
  92: ['baanve', 'banve'],
  93: ['tiranbe'],
  94: ['churanve'],
  95: ['pachaanve'],
  96: ['chiyanve'],
  97: ['satanve'],
  98: ['athanve'],
  99: ['ninaanve', 'ninanve', 'ninnanve'],
};

/** Devanagari spellings that differ from the canonical table. */
const DEVANAGARI_EXTRA: ReadonlyArray<readonly [string, number]> = [
  ['पांच', 5],
  ['छः', 6],
  ['छे', 6],
  ['पन्द्रह', 15],
  ['सिफर', 0],
];

/** Speech recognisers often write mixed-language numbers in English. */
const ENGLISH_NUMBERS: ReadonlyArray<readonly [string, number]> = [
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7],
  ['eight', 8], ['nine', 9], ['ten', 10], ['half', 0.5], ['hundred', 100],
];

const MULTIPLIERS: ReadonlyArray<readonly [string, number]> = [
  ['sau', 100],
  ['so', 100],
  ['सौ', 100],
  ['hundred', 100],
  ['hazaar', 1000],
  ['hazar', 1000],
  ['hajar', 1000],
  ['hajaar', 1000],
  ['हज़ार', 1000],
  ['हजार', 1000],
  ['lakh', 100_000],
  ['lac', 100_000],
  ['lakhs', 100_000],
  ['लाख', 100_000],
  ['crore', 10_000_000],
  ['karod', 10_000_000],
  ['kror', 10_000_000],
  ['करोड़', 10_000_000],
  ['करोड', 10_000_000],
];

const FRACTION_NUMBERS: ReadonlyArray<readonly [string, number]> = [
  ['aadha', 0.5],
  ['adha', 0.5],
  ['aadhi', 0.5],
  ['adhi', 0.5],
  ['आधा', 0.5],
  ['आधी', 0.5],
  ['आधे', 0.5],
  ['dedh', 1.5],
  ['डेढ़', 1.5],
  ['डेढ', 1.5],
  ['dhai', 2.5],
  ['dhaai', 2.5],
  ['ढाई', 2.5],
  ['अढाई', 2.5],
];

/** Offsets applied to the next number. */
const FRACTION_OFFSETS: ReadonlyArray<readonly [string, number]> = [
  ['sawa', 0.25],
  ['sava', 0.25],
  ['savaa', 0.25],
  ['sawaa', 0.25],
  ['सवा', 0.25],
  ['saade', 0.5],
  ['sade', 0.5],
  ['साढ़े', 0.5],
  ['साढे', 0.5],
  ['paune', -0.25],
  ['paune', -0.25],
  ['पौने', -0.25],
  ['पौना', -0.25],
];

const nfc = (s: string): string => s.normalize('NFC');

function buildTables(): {
  atoms: Map<string, number>;
  conflicts: string[];
} {
  const atoms = new Map<string, number>();
  const conflicts: string[] = [];
  const add = (word: string, value: number): void => {
    const key = nfc(word);
    const existing = atoms.get(key);
    if (existing !== undefined && existing !== value) {
      conflicts.push(`${key}: ${existing} vs ${value}`);
      return;
    }
    atoms.set(key, value);
  };
  for (let n = 0; n < 100; n++) {
    add(LATIN_0_99[n] ?? '', n);
    add(DEVANAGARI_0_99[n] ?? '', n);
    for (const v of VARIANTS[n] ?? []) add(v, n);
  }
  for (const [w, n] of DEVANAGARI_EXTRA) add(w, n);
  for (const [w, v] of FRACTION_NUMBERS) add(w, v);
  for (const [w, v] of ENGLISH_NUMBERS) if (v < 100) add(w, v);
  return { atoms, conflicts };
}

const { atoms: ATOMS, conflicts } = buildTables();

/** Words mapped to two different values. Must be empty; checked by a test. */
export const NUMBER_TABLE_CONFLICTS: readonly string[] = conflicts;

const MULTIPLIER_MAP = new Map<string, number>(MULTIPLIERS.map(([w, v]) => [nfc(w), v]));
const OFFSET_MAP = new Map<string, number>(FRACTION_OFFSETS.map(([w, v]) => [nfc(w), v]));

const DEVANAGARI_DIGITS = /[०-९]/g;
const NUMERIC_TOKEN = /^\d+(?:\.\d+)?$/;
const THOUSANDS_COMMA = /(?<=\d),(?=\d{3}(?!\d))/g;
const NON_WORD = /[^\p{L}\p{M}\p{N}.]+/gu;
const EDGE_DOTS = /^\.+|\.+$/g;

function normalizeText(text: string): string {
  return nfc(text)
    .toLowerCase()
    .replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(THOUSANDS_COMMA, '');
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeText(text).replace(NON_WORD, ' ').split(' ')) {
    const token = raw.replace(EDGE_DOTS, '');
    if (token !== '') out.push(token);
  }
  return out;
}

/** Normalises one already-split token the same way tokenize does. */
function normalizeToken(token: string): string {
  return normalizeText(token).replace(NON_WORD, '').replace(EDGE_DOTS, '');
}

function atomValue(token: string): number | undefined {
  if (NUMERIC_TOKEN.test(token)) return Number.parseFloat(token);
  return ATOMS.get(token);
}

/** Parses a list of normalised tokens. Returns null unless EVERY token is understood. */
function parseTokens(tokens: readonly string[]): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  let segment = 0; // value inside the current group, below the next multiplier
  let atom: number | null = null; // a number waiting to be consumed
  let offset: number | null = null; // pending sawa / saade / paune
  let hasHundred = false;
  let lastMultiplier = Number.POSITIVE_INFINITY;

  for (const token of tokens) {
    const value = atomValue(token);
    if (value !== undefined) {
      if (atom !== null) return null;
      if (offset !== null && !Number.isInteger(value)) return null;
      atom = value + (offset ?? 0);
      offset = null;
      continue;
    }

    const shift = OFFSET_MAP.get(token);
    if (shift !== undefined) {
      if (atom !== null || offset !== null) return null;
      offset = shift;
      continue;
    }

    const multiplier = MULTIPLIER_MAP.get(token);
    if (multiplier === undefined) return null;

    const base: number | null = atom ?? (offset !== null ? 1 + offset : null);
    atom = null;
    offset = null;
    if (multiplier === 100) {
      if (hasHundred) return null;
      segment += (base ?? 1) * 100;
      hasHundred = true;
      continue;
    }
    if (multiplier >= lastMultiplier) return null;
    const group = base !== null ? segment + base : segment > 0 ? segment : 1;
    total += group * multiplier;
    lastMultiplier = multiplier;
    segment = 0;
    hasHundred = false;
  }

  const tail: number | null = atom ?? (offset !== null ? 1 + offset : null);
  const result = total + segment + (tail ?? 0);
  if (!Number.isFinite(result) || result < 0 || result > MAX_VALUE) return null;
  // Round away binary noise from decimal digits such as "1.1 sau".
  return Math.round(result * 1e6) / 1e6;
}

/** Spoken or written number to a value, or null when it is not (fully) a number. */
export function parseNumber(text: string): number | null {
  if (typeof text !== 'string') return null;
  return parseTokens(tokenize(text));
}

const UNIT_ALIASES = new Map<string, Unit>(
  (
    [
      ['kg', 'kg'], ['kgs', 'kg'], ['kilo', 'kg'], ['kilos', 'kg'], ['kilogram', 'kg'],
      ['kilograms', 'kg'], ['किलो', 'kg'], ['किलोग्राम', 'kg'], ['केजी', 'kg'],
      ['g', 'g'], ['gm', 'g'], ['gms', 'g'], ['gram', 'g'], ['grams', 'g'], ['ग्राम', 'g'],
      ['l', 'l'], ['ltr', 'l'], ['lt', 'l'], ['litre', 'l'], ['liter', 'l'], ['litres', 'l'],
      ['liters', 'l'], ['लीटर', 'l'], ['लिटर', 'l'],
      ['ml', 'ml'], ['millilitre', 'ml'], ['milliliter', 'ml'], ['मिली', 'ml'],
      ['piece', 'piece'], ['pieces', 'piece'], ['pc', 'piece'], ['pcs', 'piece'],
      ['pis', 'piece'], ['पीस', 'piece'],
      ['packet', 'packet'], ['packets', 'packet'], ['pkt', 'packet'], ['pkts', 'packet'],
      ['pack', 'packet'], ['pakit', 'packet'], ['पैकेट', 'packet'], ['पैक', 'packet'],
      ['dozen', 'dozen'], ['dozens', 'dozen'], ['darjan', 'dozen'], ['dozan', 'dozen'],
      ['दर्जन', 'dozen'],
    ] as const
  ).map(([alias, unit]) => [nfc(alias), unit]),
);

/** Normalises a unit word to a catalog unit, or null if it is not one. */
export function normalizeUnit(word: string): Unit | null {
  if (typeof word !== 'string') return null;
  return UNIT_ALIASES.get(normalizeToken(word)) ?? null;
}

export interface ParsedQuantity {
  quantity: number;
  /** null when no unit word followed; the caller picks a default (catalog unit or piece). */
  unit: Unit | null;
  /** How many input tokens were used, so the caller can continue after them. */
  consumed: number;
}

/**
 * A paav is a quarter kilo, said as a unit of its own: "ek paav jeera" (250 g), "do paav" (500 g),
 * "paav kilo" (0.25 kg). "pav" is also bread, so that spelling counts only after a number.
 */
const PAAV = new Set(['paav', 'paaw', 'paw', 'pao', 'pau', 'पाव', 'पौआ', 'पव्वा'].map(nfc));
const PAAV_AFTER_NUMBER = new Set([...PAAV, 'pav']);
const PAAV_GRAMS = 250;

const ATTACHED = /^(\d+(?:\.\d+)?)(\p{L}[\p{L}\p{M}]*)$/u;

/**
 * Reads "quantity [unit]" from the START of a token list: ["paanch","sau","gram","dal"]
 * gives 500 g and consumed 3. Also accepts attached forms such as "2kg".
 */
export function extractQuantityAndUnit(tokens: readonly string[]): ParsedQuantity | null {
  if (tokens.length === 0) return null;
  const norm: string[] = [];
  const limit = Math.min(tokens.length, MAX_NUMBER_TOKENS + 1);
  for (let i = 0; i < limit; i++) norm.push(normalizeToken(tokens[i] ?? ''));

  const first = norm[0] ?? '';
  const attached = ATTACHED.exec(first);
  if (attached) {
    const unit = UNIT_ALIASES.get(attached[2] ?? '') ?? null;
    if (unit) return { quantity: Number.parseFloat(attached[1] ?? ''), unit, consumed: 1 };
  }

  if (PAAV.has(first)) {
    return UNIT_ALIASES.get(norm[1] ?? '') === 'kg' ? { quantity: 0.25, unit: 'kg', consumed: 2 } : { quantity: PAAV_GRAMS, unit: 'g', consumed: 1 };
  }

  for (let k = Math.min(norm.length, MAX_NUMBER_TOKENS); k >= 1; k--) {
    const quantity = parseTokens(norm.slice(0, k));
    if (quantity === null) continue;
    if (PAAV_AFTER_NUMBER.has(norm[k] ?? '')) return { quantity: quantity * PAAV_GRAMS, unit: 'g', consumed: k + 1 };
    const unit = UNIT_ALIASES.get(norm[k] ?? '') ?? null;
    return { quantity, unit, consumed: k + (unit ? 1 : 0) };
  }
  return null;
}

/** Splits an utterance into normalised word tokens (lowercase, NFC, ASCII digits, no punctuation). */
export { tokenize as tokenizeSpeech };
