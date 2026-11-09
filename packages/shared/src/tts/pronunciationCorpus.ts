/**
 * The words our replies speak that carry a nasal sound, with candidate spellings to A/B in Timbre.
 *
 * Why: we send romanised Hinglish ("Save kar dun?"), where a nasal VOWEL (दूँ, हाँ, हैं, में) is
 * written as a trailing "n". Two of these were heard as a hard "n" consonant (see
 * KNOWN_BAD_SPELLINGS). Words whose "n" or "m" IS a consonant (तीन, नाम, कौन) are listed as
 * controls: a fix for the first group must not break them.
 *
 * `pnpm spike --only P` synthesises every candidate, one request at a time, and writes a numbered
 * listening sheet. The first candidate is always the spelling sent today. Winners go into
 * PRONUNCIATION_OVERRIDES only after a person has listened. Synthetic text only: no real names.
 */
export interface CorpusEntry {
  id: string;
  /** The canonical spelling as our templates produce it today. */
  word: string;
  /** Hindi spelling, for the reader of the listening sheet. */
  hindi: string;
  /**
   * 'nasal': the n/m marks a nasal vowel. 'consonant': a real n/m that must stay (a control).
   * 'dental': a dental द that Timbre read as a retroflex ड when the word was written in Latin.
   */
  kind: 'nasal' | 'consonant' | 'dental';
  /** Where it is spoken. */
  usedIn: string;
  /** What is sent to Timbre for each variant. The first is today's spelling. */
  candidates: readonly string[];
}

export const PRONUNCIATION_CORPUS: readonly CorpusEntry[] = [
  { id: 'haan', word: 'haan', hindi: 'हाँ', kind: 'nasal', usedIn: 'addCustomerAsk ("Haan bolo ya confirm dabao.")',
    candidates: ['Haan bolo.', 'हाँ बोलो।', 'हां बोलो।', 'हा बोलो।', 'Haa bolo.', 'Han bolo.', 'हाँ जी बोलो।'] },
  { id: 'kar-dun', word: 'kar dun', hindi: 'कर दूँ', kind: 'nasal', usedIn: 'billReadback, paymentRecorded ("Save kar dun?", "Jama kar dun?")',
    candidates: ['Save kar dun?', 'Save कर दूँ?', 'सेव कर दूँ?', 'सेव कर दूं?', 'सेव कर दू?', 'Save kar du?', 'Save kar doon?', 'सेव कर दूँ क्या?', 'जोड़ दूँ?'] },
  { id: 'likh-dun', word: 'likh dun', hindi: 'लिख दूँ', kind: 'nasal', usedIn: 'stockOutAsk, addProductAsk',
    candidates: ['Aata khatam, likh dun?', 'आटा खत्म, लिख दूँ?', 'आटा खत्म, लिख दूं?', 'Aata khatam, likh du?'] },
  { id: 'jodun', word: 'jodun', hindi: 'जोड़ूँ', kind: 'nasal', usedIn: 'addCustomerAsk, addProductAsk, addProductsAsk',
    candidates: ['Samaan mein jodun?', 'सामान में जोड़ूँ?', 'सामान में जोड़ूं?', 'Samaan mein jodu?', 'Samaan mein जोड़ूँ?'] },
  { id: 'likhun', word: 'likhun', hindi: 'लिखूँ', kind: 'nasal', usedIn: 'customerNeeded ("Udhaar kiska likhun?")',
    candidates: ['Udhaar kiska likhun?', 'उधार किसका लिखूँ?', 'उधार किसका लिखूं?', 'Udhaar kiska likhu?'] },
  { id: 'karun', word: 'karun', hindi: 'करूँ', kind: 'nasal', usedIn: 'billReadback ("... udhaar rahega, save karun?")',
    candidates: ['Save karun?', 'सेव करूँ?', 'सेव करूं?', 'Save karu?'] },
  { id: 'dunga', word: 'dunga', hindi: 'दूँगा', kind: 'nasal', usedIn: 'addProductsAsk ("unhe chhod dunga")',
    candidates: ['Unhe chhod dunga.', 'उन्हें छोड़ दूँगा।', 'उन्हें छोड़ दूंगा।', 'Unhe chhod doonga.'] },
  { id: 'hain', word: 'hain', hindi: 'हैं', kind: 'nasal', usedIn: 'customerExists, balanceReply, allProductsExist',
    candidates: ['Pehle se hain.', 'पहले से हैं।', 'पहले से हैं', 'Pehle se hai.'] },
  { id: 'mein', word: 'mein', hindi: 'में', kind: 'nasal', usedIn: 'itemNotFound ("list mein"), addCustomerAsk, many more',
    candidates: ['List mein nahi mila.', 'लिस्ट में नहीं मिला।', 'List me nahi mila.', 'List mai nahi mila.'] },
  { id: 'nahi', word: 'nahi', hindi: 'नहीं', kind: 'nasal', usedIn: 'notUnderstood, customerNotFound, balanceReply, many more',
    candidates: ['Samajh nahi aaya.', 'समझ नहीं आया।', 'Samajh nahin aaya.', 'समझ नही आया।'] },
  { id: 'paanch', word: 'paanch', hindi: 'पाँच', kind: 'nasal', usedIn: 'amounts (5, 500, 5000 ...)',
    candidates: ['Paanch rupaye.', 'पाँच रुपये।', 'पांच रुपये।', 'Panch rupaye.'] },
  { id: 'paintis', word: 'paintis', hindi: 'पैंतीस', kind: 'nasal', usedIn: 'amounts (35; also saintis 37, taintis 33, chauntis 34)',
    candidates: ['Paintis rupaye.', 'पैंतीस रुपये।', 'Paintees rupaye.'] },
  { id: 'paintalis', word: 'paintalis', hindi: 'पैंतालीस', kind: 'nasal', usedIn: 'amounts (45; also saintalis 47, taintalis 43)',
    candidates: ['Paintalis rupaye.', 'पैंतालीस रुपये।', 'Paintaalees rupaye.'] },
  { id: 'chaunsath', word: 'chaunsath', hindi: 'चौंसठ', kind: 'nasal', usedIn: 'amounts (64; also painsath 65)',
    candidates: ['Chaunsath rupaye.', 'चौंसठ रुपये।'] },
  { id: 'pandrah', word: 'pandrah', hindi: 'पंद्रह', kind: 'nasal', usedIn: 'amounts (15)',
    candidates: ['Pandrah rupaye.', 'पंद्रह रुपये।'] },
  // Controls: the n or m is a real consonant and must still be heard.
  { id: 'teen', word: 'teen', hindi: 'तीन', kind: 'consonant', usedIn: 'amounts (3, 300 ...)', candidates: ['Teen sau rupaye.', 'तीन सौ रुपये।'] },
  { id: 'naam', word: 'naam', hindi: 'नाम', kind: 'consonant', usedIn: 'customerNeeded ("Grahak ka naam batao.")', candidates: ['Grahak ka naam batao.', 'ग्राहक का नाम बताओ।'] },
  { id: 'kaun', word: 'kaunsa', hindi: 'कौनसा', kind: 'consonant', usedIn: 'customerAmbiguous, clarifyAsk', candidates: ['Kaunsa customer hai?', 'कौनसा कस्टमर है?'] },
  { id: 'pachpan', word: 'pachpan', hindi: 'पचपन', kind: 'consonant', usedIn: 'amounts (55; also the other -van numbers)', candidates: ['Pachpan rupaye.', 'पचपन रुपये।'] },
  // The real decision behind most of the above: send whole sentences in Devanagari or keep Latin.
  { id: 'readback', word: 'readback', hindi: 'बिल … सेव कर दूँ?', kind: 'nasal', usedIn: 'billReadback (the demo sentence)',
    candidates: ['Bill do sau pachas rupaye ka hai. Save kar dun?', 'बिल दो सौ पचास रुपये का है। सेव कर दूँ?'] },
  // Reported by a person on 2026-11-09: "jodun" heard as जोडून, "dabao" heard as डबाओ. Last candidate is what the app now sends.
  { id: 'dabao', word: 'dabao', hindi: 'दबाओ', kind: 'dental', usedIn: 'addCustomerAsk ("Haan bolo ya confirm dabao.")',
    candidates: ['Haan bolo ya confirm dabao.', 'Haan bolo ya confirm दबाओ।', 'हाँ बोलो या कन्फर्म दबाओ।', 'Bolo ya button दबाओ.'] },
];

/**
 * Tokens our replies speak whose "n" or "m" was checked and is a real consonant (or English), so
 * the sweep does not flag them. Each was checked against its Hindi spelling, not guessed.
 */
export const REAL_CONSONANT_TOKENS: readonly string[] = [
  // Hindi words with a real न/म: तीन, नाम, कौन, कौनसा, सामान, चुन, दर्जन, ख़त्म
  'teen', 'naam', 'kaun', 'kaunsa', 'samaan', 'chun', 'darjan', 'khatam',
  // number words ending in a real न (-वन, -पन) or with न before a consonant (उन्नीस family)
  'atthavan', 'bavan', 'chauvan', 'chhappan', 'ikyavan', 'pachpan', 'sattavan', 'tirpan',
  'atthanve', 'bayanve', 'chauranve', 'chhiyanve', 'ikyanve', 'ninyanve', 'pachanve', 'sattanve', 'tiranve',
  'unchalis', 'unchas', 'unhattar', 'unsath', 'untis',
  // English words spoken as English
  'cancel', 'confirm', 'gram', 'item', 'pending', 'quantity', 'screen',
];

/** Nasal tokens that share an entry with a listed representative (same sound pattern). */
export const COVERED_BY: Readonly<Record<string, string>> = {
  saintis: 'paintis', taintis: 'paintis', chauntis: 'paintis',
  saintalis: 'paintalis', taintalis: 'paintalis',
  painsath: 'chaunsath',
  dun: 'kar-dun',
  unhe: 'dunga',
};
