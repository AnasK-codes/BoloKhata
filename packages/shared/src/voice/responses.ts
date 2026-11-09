/**
 * Short Hinglish replies for text-to-speech. Each function returns at most two short
 * sentences (the first can start playing while the second is still being synthesised).
 *
 * - A few fixed variants per reply keep repeated use from sounding robotic, while the set
 *   stays small so the gateway's phrase cache keeps hitting. The caller passes `variant`
 *   (any integer, e.g. a turn counter); the same variant gives the same text.
 * - Amounts are spoken Hindi words (hindiNumbers.ts), never digits. If an amount is too
 *   large to speak, digits are used as a last resort rather than saying nothing.
 * - Every sentence is clipped to MAX_SENTENCE_CHARS. Customer and item names are user
 *   data: they are length-limited here and never interpreted.
 */
import { amountToSpokenRupees, numberToHindiWords } from '../domain/hindiNumbers';
import type { Clarification } from '../protocol/server';

export const MAX_SENTENCE_CHARS = 160;
const MAX_NAME_CHARS = 40;

const rupees = (n: number): string => amountToSpokenRupees(n) || `${Math.round(n)} rupaye`;
/** An amount as spoken Hindi words, for replies a model wrote around a placeholder. */
export const spokenRupees = rupees;

function clip(s: string): string {
  return s.length <= MAX_SENTENCE_CHARS ? s : `${s.slice(0, MAX_SENTENCE_CHARS - 1).trimEnd()}.`;
}

function pick<T>(variants: readonly T[], variant: number): T {
  const n = variants.length;
  const i = Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) % n : 0;
  return variants[i] as T;
}

function name(n: string | undefined | null): string {
  const clean = (n ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS);
  return clean;
}

export interface BillReadback {
  customerName?: string | null;
  total: number;
  udhaar: number;
}

/** "Sharma ji ka bill teen sau bayalis rupaye ka hai. Isme sau rupaye udhaar, theek hai?" */
export function billReadback(b: BillReadback, variant = 0): string[] {
  const who = name(b.customerName);
  const total = rupees(b.total);
  const first = who
    ? pick([`${who} ka bill ${total} ka hai.`, `${who} ke liye bill ${total} ka bana.`, `Bill ${total} ka hai, ${who} ke naam.`], variant)
    : pick([`Bill ${total} ka hai.`, `Total ${total} hua.`], variant);
  const second =
    b.udhaar > 0
      ? pick([`Isme ${rupees(b.udhaar)} udhaar, theek hai?`, `${rupees(b.udhaar)} udhaar rahega, save karun?`], variant)
      : pick([`Save kar dun?`, `Theek hai?`], variant);
  return [clip(first), clip(second)];
}

/** Draft payment, asking for confirmation. */
export function paymentRecorded(customerName: string | null | undefined, amount: number, variant = 0): string[] {
  const who = name(customerName);
  const amt = rupees(amount);
  const first = who
    ? pick([`${who} ne ${amt} diye.`, `${who} se ${amt} mile.`], variant)
    : pick([`${amt} jama hue.`, `${amt} mile.`], variant);
  return [clip(first), clip(pick([`Jama kar dun?`, `Theek hai?`], variant))];
}

/** Answer to "kitna udhaar hai". Positive = customer owes; negative = shop owes customer. */
export function balanceReply(customerName: string | null | undefined, balance: number, variant = 0): string[] {
  const who = name(customerName) || 'Inka';
  if (balance === 0) {
    return [clip(pick([`${who} ka koi udhaar baaki nahi hai.`, `${who} ka hisaab saaf hai.`], variant))];
  }
  if (balance > 0) {
    return [clip(pick([`${who} ka ${rupees(balance)} udhaar baaki hai.`, `${who} par ${rupees(balance)} baaki hain.`], variant))];
  }
  return [clip(`${who} ne ${rupees(-balance)} zyada diye hain, wo aapko wapas dene hain.`)];
}

/** Shop-wide answer: today's sales and the total udhaar outstanding. */
export function summaryReply(todayBills: number, todaySales: number, totalUdhaar: number, variant = 0): string[] {
  const first =
    todayBills === 0
      ? pick([`Aaj abhi koi bill nahi bana.`, `Aaj ki bikri abhi shuru nahi hui.`], variant)
      : pick([`Aaj ${todayBills} bill bane, ${rupees(todaySales)} ki bikri hui.`, `Aaj ki bikri ${rupees(todaySales)}, ${todayBills} bill.`], variant);
  const second =
    totalUdhaar > 0
      ? pick([`Kul ${rupees(totalUdhaar)} udhaar baaki hai.`, `Udhaar mein ${rupees(totalUdhaar)} baaki hain.`], variant)
      : `Koi udhaar baaki nahi hai.`;
  return [clip(first), clip(second)];
}

/** Asks before marking a product as out of stock. */
export function stockOutAsk(productName: string | null | undefined, variant = 0): string[] {
  const item = name(productName);
  return [clip(item ? pick([`${item} khatam, likh dun?`, `${item} khatam ho gaya, theek hai?`], variant) : `Kya khatam hua?`)];
}

export function saved(variant = 0): string[] {
  return [pick([`Ho gaya, save kar diya.`, `Save ho gaya.`, `Theek hai, likh liya.`], variant)];
}

export function cancelled(variant = 0): string[] {
  return [pick([`Theek hai, rehne diya.`, `Cancel kar diya.`], variant)];
}

export function notUnderstood(variant = 0): string[] {
  return [
    pick([`Samajh nahi aaya.`, `Maaf kijiye, phir se boliye.`], variant),
    pick([`Dobara boliye na.`, `Thoda saaf boliye.`], variant),
  ];
}

export function customerNotFound(spoken: string | null | undefined, variant = 0): string[] {
  const who = name(spoken);
  return [
    clip(who ? pick([`${who} naam ka koi customer nahi mila.`, `${who} list mein nahi hai.`], variant) : `Customer ka naam nahi mila.`),
    `Naya customer jodna hai?`,
  ];
}

export function itemNotFound(spoken: string | null | undefined, variant = 0): string[] {
  const item = name(spoken);
  return [
    clip(item ? pick([`${item} catalog mein nahi mila.`, `${item} ka rate nahi mila.`], variant) : `Ek item nahi mila.`),
    `Dobara boliye ya list se chuniye.`,
  ];
}

/** Two customers match the spoken name about equally: ask which one. */
export function customerAmbiguous(candidates: readonly string[], variant = 0): string[] {
  const [a, b] = candidates.map((c) => name(c)).filter((c) => c !== '');
  if (!a || !b) return customerNotFound(a ?? null, variant);
  return [clip(`${a} ya ${b}?`), pick([`Kaunsa customer hai?`, `Naam chun lijiye.`], variant)];
}

/** A bill with udhaar but no customer named: ask whose udhaar it is. */
export function customerNeeded(variant = 0): string[] {
  return [pick([`Udhaar kiska likhun?`, `Yeh udhaar kiske naam hai?`], variant), `Grahak ka naam batao.`];
}

/** "Anil Singh ko customer mein add karo": asks for the go-ahead before a customer is created. */
export function addCustomerAsk(spoken: string | null | undefined, variant = 0): string[] {
  const who = name(spoken);
  return [clip(pick([`${who} ko customer mein jodun?`, `${who} naya customer jodna hai?`], variant)), `Haan bolo ya confirm dabao.`];
}

export function customerExists(spoken: string | null | undefined, variant = 0): string[] {
  const who = name(spoken);
  return [clip(pick([`${who} pehle se customer hain.`, `${who} list mein pehle se hai.`], variant))];
}

const UNIT_WORDS: Record<string, string> = { kg: 'kilo', g: 'gram', l: 'litre', ml: 'ml', piece: 'piece', packet: 'packet', dozen: 'darjan' };

/** "Samaan mein chawal 40 rupaye kilo": reads the product back with its rate before it is created. */
export function addProductAsk(productName: string | null | undefined, unit: string, price: number, variant = 0, stock?: number): string[] {
  const item = name(productName);
  const per = UNIT_WORDS[unit] ?? unit;
  const have = stock === undefined ? '' : spokenQuantity(stock, unit);
  // With a quantity: "Rajma, paanch kilo, ek sau bees rupaye per kilo. Samaan mein jodun?"
  if (have) return [clip(`${item}, ${have}, ${rupees(price)} per ${per}. Samaan mein jodun?`)];
  return [clip(pick([`${item}, ${rupees(price)} per ${per}. Samaan mein jodun?`, `${item} ${rupees(price)} per ${per}, likh dun?`], variant))];
}

/** A list where some items were named with no rate: the complete ones wait, the rate is asked for. */
export function addProductsNeedRate(ready: number, productName: string | null | undefined): string[] {
  const item = name(productName);
  return [clip(ready > 0 ? `${ready} samaan taiyar hain.` : `${item} ka rate bhi bolo.`), clip(ready > 0 ? `${item} ka rate bhi bolo.` : `Rupaye aur kilo ke saath.`)];
}

/** "Samaan mein rajma add karo" with no price: the rate is never guessed, so ask for it. */
export function addProductNeedsRate(productName: string | null | undefined, variant = 0): string[] {
  const item = name(productName);
  return [clip(pick([`${item} ka rate bhi bolo, rupaye aur kilo ke saath.`, `${item} kitne rupaye kilo hai? Rate bhi bolo.`], variant))];
}

/** "Chawal ka rate 45 karo": reads the change back before it is written. */
export function updatePriceAsk(productName: string | null | undefined, unit: string, price: number, variant = 0): string[] {
  const item = name(productName);
  const per = UNIT_WORDS[unit] ?? unit;
  return [clip(pick([`${item} ka rate ${rupees(price)} per ${per} kar dun?`, `${item} ab ${rupees(price)} per ${per}, theek hai?`], variant))];
}

export function priceUnchanged(productName: string | null | undefined, variant = 0): string[] {
  const item = name(productName);
  return [clip(pick([`${item} ka rate pehle se yahi hai.`, `${item} ka rate pehle se wahi hai, badla nahi.`], variant))];
}

/** "Samaan mein aata 45, cheeni 50, ...": one confirmation for the whole list. */
export function addProductsAsk(fresh: number, existing: number, variant = 0): string[] {
  const head = pick([`${fresh} samaan jodun?`, `${fresh} naye samaan jodne hain, theek hai?`], variant);
  return existing > 0 ? [head, `${existing} pehle se hain, unhe chhod dunga.`] : [head, `List dekh lo, phir haan bolo.`];
}

export function productExists(productName: string | null | undefined, variant = 0): string[] {
  const item = name(productName);
  return [clip(pick([`${item} samaan mein pehle se hai.`, `${item} list mein pehle se hai.`], variant))];
}

/** "haan" or "nahi" with no draft waiting. */
export function nothingPending(variant = 0): string[] {
  return [pick([`Abhi koi bill pending nahi hai.`, `Save karne ke liye kuch nahi hai.`], variant)];
}

const FRACTION_WORDS: ReadonlyMap<number, string> = new Map([[0.25, 'paav'], [0.5, 'aadha'], [1.5, 'dedh'], [2.5, 'dhai']]);

/** "do kilo", "aadha kilo", "250 gram". Empty when the amount has no simple spoken form. */
function spokenQuantity(quantity: number | undefined, unit: string | undefined): string {
  if (quantity === undefined) return '';
  const words = FRACTION_WORDS.get(quantity) ?? (Number.isInteger(quantity) ? numberToHindiWords(quantity) : '');
  if (!words) return '';
  return unit ? `${words} ${UNIT_WORDS[unit] ?? unit}` : words;
}

/**
 * The one question about a partly understood bill. It asks only for the missing piece, never for
 * the whole order again. Once the voice has asked twice (`fallback`), it points at the screen
 * instead of asking a third time.
 */
export function clarifyAsk(c: Clarification, itemName: string | undefined, variant = 0): string[] {
  if (c.fallback) return [pick([`Screen par chun lijiye.`, `Neeche se chun lijiye.`], variant)];
  switch (c.slot) {
    case 'item': {
      const heard = name(c.spoken);
      if (heard) {
        return [clip(pick([`${heard} list mein nahi mila.`, `${heard} samaan mein nahi hai.`], variant)), pick([`Doosra naam boliye, ya hatao boliye.`, `Kaunsa samaan hai? Naam boliye.`], variant)];
      }
      const amount = spokenQuantity(c.quantity, c.unit);
      return [clip(amount ? `${amount} kya chahiye?` : `Aur kya chahiye?`), `Samaan ka naam boliye.`];
    }
    case 'quantity': {
      const item = name(itemName);
      return [clip(item ? `${item} kitna chahiye?` : `Kitna chahiye?`), pick([`Jaise ek kilo ya aadha kilo.`, `Kilo ya gram mein boliye.`], variant)];
    }
    case 'rate': {
      const unit = c.unit ? ` per ${UNIT_WORDS[c.unit] ?? c.unit}` : '';
      return [clip(`${name(c.spoken) || 'Is samaan'} ka rate${unit} kitna hai?`), `Jaise: chaalis rupaye kilo.`];
    }
    case 'customer':
      return c.spoken ? [clip(`${name(c.spoken)} kaun hain?`), `Poora naam boliye.`] : customerNeeded(variant);
  }
}

/** Udhaar for a customer whose mobile and address are not filled in yet. */
export function creditDetailsNeeded(): string[] {
  return ['Udhaar ke liye grahak ka naam, mobile aur address bharo.'];
}

/** A spoken "haan" for a bill that cannot be saved yet. */
export function detailsFirst(): string[] {
  return ['Bill aur grahak ki details pehle poori karo.'];
}

/** "Samaan mein ..." for products that all exist already. */
export function allProductsExist(): string[] {
  return ['Ye sab samaan mein pehle se hain.'];
}

/** A spoken edit that could not be applied safely. */
export function correctionFailed(): string[] {
  return ['Badlav samajh nahi aaya. Item aur quantity saaf bolo.'];
}

/** A spoken edit that removed the last item. */
export function billEmptied(): string[] {
  return ['Bill mein koi item nahi bacha. Naya item jodo.'];
}
