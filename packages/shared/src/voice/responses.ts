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
import { amountToSpokenRupees } from '../domain/hindiNumbers';

export const MAX_SENTENCE_CHARS = 160;
const MAX_NAME_CHARS = 40;

const rupees = (n: number): string => amountToSpokenRupees(n) || `${Math.round(n)} rupaye`;

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

/** "haan" or "nahi" with no draft waiting. */
export function nothingPending(variant = 0): string[] {
  return [pick([`Abhi koi bill pending nahi hai.`, `Save karne ke liye kuch nahi hai.`], variant)];
}
