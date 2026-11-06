import { isConfirmable, numberToHindiWords, spokenRupees, type DraftMessage } from '@bolbill/shared';

/**
 * The model writes the spoken reply, but this file decides whether it may be used. A reply is used only
 * when the draft it describes is clean (something the user can simply confirm, or a plain answer), it has
 * no digits, at most two short sentences, no claim that something was saved or done, and only placeholders
 * the draft can fill. Amounts are filled in from the draft by code, in Hindi words, so a spoken number
 * always matches the card. Anything else: the caller keeps the deterministic template reply.
 */

const MAX_SENTENCE = 160;
const MAX_NAME = 40;
// eslint-disable-next-line no-control-regex -- the point is to detect control characters
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/;
const DIGITS = /[0-9०-९]/;
/** Nothing is saved until the user says haan, so a reply must not say it was. */
const DONE_CLAIMS = ['ho gaya', 'hogaya', 'ho gayi', 'ho gaye', 'kar diya', 'kar di ', 'likh diya', 'likh liya', 'likh li ', 'jod diya', 'saved', 'done', 'हो गया', 'हो गई', 'कर दिया', 'लिख दिया', 'जोड़ दिया'];

// eslint-disable-next-line no-control-regex -- names are user data: control characters and markup are stripped
const NAME_NOISE = /[\u0000-\u001f\u007f<>{}]/g;
const cleanName = (n: string): string => n.replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** The names and spoken amounts a reply for this draft may mention. */
function factsOf(draft: DraftMessage): Record<string, string> {
  const facts: Record<string, string> = {};
  if (draft.customer?.name) facts['customer'] = cleanName(draft.customer.name);
  if (draft.bill) {
    facts['total'] = spokenRupees(draft.bill.total);
    facts['paid'] = spokenRupees(draft.bill.paid);
    facts['udhaar'] = spokenRupees(draft.bill.udhaar);
  }
  if (draft.payment) facts['amount'] = spokenRupees(draft.payment.amount);
  // A negative balance (the shop owes the customer) needs different words, so it is left to the template.
  if (draft.balance && draft.balance.balance >= 0) facts['balance'] = spokenRupees(draft.balance.balance);
  if (draft.product) {
    facts['product'] = cleanName(draft.product.name);
    facts['rate'] = spokenRupees(draft.product.pricePerUnit);
  }
  if (draft.summary) {
    facts['sales'] = spokenRupees(draft.summary.todaySales);
    facts['bills'] = numberToHindiWords(draft.summary.todayBills) || String(draft.summary.todayBills);
    facts['udhaar'] = spokenRupees(draft.summary.totalUdhaar);
  }
  return facts;
}

/**
 * The reply as at most two spoken sentences, or null when it may not be used.
 * `say`: the model's own words for a sentence that needs no action (greeting, a question back).
 */
export function modelReplyFor(draft: DraftMessage, template: string, say: boolean): string[] | null {
  const clean = say ? draft.intent === 'unknown' : isConfirmable(draft) || (draft.intent === 'query_balance' && draft.balance !== undefined) || (draft.intent === 'query_summary' && draft.summary !== undefined);
  if (!clean) return null;
  const text = template.trim();
  if (text === '' || DIGITS.test(text) || BAD_CHARS.test(text)) return null;
  const lower = text.toLowerCase();
  if (DONE_CLAIMS.some((claim) => lower.includes(claim))) return null;
  const facts = factsOf(draft);
  let missing = false;
  const filled = text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = facts[key];
    if (value === undefined) missing = true;
    return value ?? '';
  });
  if (missing || /[{}]/.test(filled)) return null;
  const sentences = filled.split(/(?<=[.?!।])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0 || sentences.length > 2 || sentences.some((s) => s.length > MAX_SENTENCE)) return null;
  return sentences;
}
