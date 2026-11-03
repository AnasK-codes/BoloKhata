/**
 * Number -> spoken Hindi, for text-to-speech.
 *
 * Gnani's formatting guidance is to send amounts as words, so "342" becomes
 * "teen sau bayalis". Hindi 1..99 are all irregular, hence the two lookup tables.
 *
 * Decisions:
 * - Indian grouping: crore / lakh / hazaar / sau, never "million".
 * - Range: integers 0 .. 99,99,99,999 (99 crore and change). Anything else (negative,
 *   fractional, NaN, too big, not a number) returns '' rather than throwing, so a bad
 *   amount can never crash a turn. Callers must treat '' as "do not speak this".
 * - Which script TTS prefers is NOT verified. Roman is the default until the latency
 *   spike says otherwise; Devanagari is supported for that comparison.
 *
 * REVIEW: the Roman spellings below are the author's best standard transliteration.
 * The ones listed in VALUES_TO_REVIEW are the least certain; please check them.
 */

export type NumberScript = 'devanagari' | 'latin';
export interface SpeakOptions {
  script?: NumberScript;
}

/** Values whose Roman (and Devanagari) form deserves a human check. */
export const VALUES_TO_REVIEW: readonly number[] = [22, 23, 33, 37, 38, 47, 48, 53, 67, 68, 79, 99];

export const LATIN_0_99: readonly string[] = [
  'sifar', 'ek', 'do', 'teen', 'chaar', 'paanch', 'chhah', 'saat', 'aath', 'nau',
  'das', 'gyarah', 'barah', 'terah', 'chaudah', 'pandrah', 'solah', 'satrah', 'atharah', 'unnis',
  'bees', 'ikkis', 'baais', 'teis', 'chaubis', 'pachchis', 'chhabbis', 'sattais', 'atthais', 'untis',
  'tees', 'ikattis', 'battis', 'taintis', 'chauntis', 'paintis', 'chhattis', 'saintis', 'adtis', 'unchalis',
  'chalis', 'iktalis', 'bayalis', 'taintalis', 'chauvalis', 'paintalis', 'chhiyalis', 'saintalis', 'adtalis', 'unchas',
  'pachas', 'ikyavan', 'bavan', 'tirpan', 'chauvan', 'pachpan', 'chhappan', 'sattavan', 'atthavan', 'unsath',
  'saath', 'iksath', 'baasath', 'tirsath', 'chaunsath', 'painsath', 'chhiyasath', 'sadsath', 'adsath', 'unhattar',
  'sattar', 'ikhattar', 'bahattar', 'tihattar', 'chauhattar', 'pachhattar', 'chhihattar', 'satattar', 'athattar', 'unyasi',
  'assi', 'ikyasi', 'bayasi', 'tirasi', 'chaurasi', 'pachasi', 'chhiyasi', 'sattasi', 'atthasi', 'navasi',
  'nabbe', 'ikyanve', 'bayanve', 'tiranve', 'chauranve', 'pachanve', 'chhiyanve', 'sattanve', 'atthanve', 'ninyanve',
];

export const DEVANAGARI_0_99: readonly string[] = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
];

interface ScaleWords {
  sau: string;
  hazaar: string;
  lakh: string;
  crore: string;
  rupee: string;
  rupees: string;
}

const LATIN_SCALE: ScaleWords = {
  sau: 'sau',
  hazaar: 'hazaar',
  lakh: 'lakh',
  crore: 'crore',
  rupee: 'rupaya',
  rupees: 'rupaye',
};

const DEVANAGARI_SCALE: ScaleWords = {
  sau: 'सौ',
  hazaar: 'हज़ार',
  lakh: 'लाख',
  crore: 'करोड़',
  rupee: 'रुपया',
  rupees: 'रुपये',
};

/** 99,99,99,999: the crore group must stay within the 0..99 tables. */
const MAX_SPEAKABLE = 999_999_999;

function isSpeakable(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_SPEAKABLE;
}

/** Spoken form of a non-negative integer, or '' when the input is not speakable. */
export function numberToHindiWords(n: number, options: SpeakOptions = {}): string {
  if (!isSpeakable(n)) return '';
  const devanagari = options.script === 'devanagari';
  const table = devanagari ? DEVANAGARI_0_99 : LATIN_0_99;
  const scale = devanagari ? DEVANAGARI_SCALE : LATIN_SCALE;
  if (n === 0) return table[0] ?? '';

  const parts: string[] = [];
  const push = (value: number, word: string): void => {
    if (value > 0) parts.push(`${table[value] ?? ''} ${word}`);
  };

  push(Math.floor(n / 10_000_000), scale.crore);
  push(Math.floor((n % 10_000_000) / 100_000), scale.lakh);
  push(Math.floor((n % 100_000) / 1000), scale.hazaar);
  push(Math.floor((n % 1000) / 100), scale.sau);
  const rest = n % 100;
  if (rest > 0) parts.push(table[rest] ?? '');
  return parts.join(' ');
}

/** "teen sau bayalis rupaye". One rupee is singular; zero is spoken. '' if not speakable. */
export function amountToSpokenRupees(n: number, options: SpeakOptions = {}): string {
  const words = numberToHindiWords(n, options);
  if (words === '') return '';
  const scale = options.script === 'devanagari' ? DEVANAGARI_SCALE : LATIN_SCALE;
  return `${words} ${n === 1 ? scale.rupee : scale.rupees}`;
}
