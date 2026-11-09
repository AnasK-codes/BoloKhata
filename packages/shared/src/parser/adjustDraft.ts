import { computeTotals } from '../domain/adjustments';
import type { CorrectionResult } from '../domain/correction';
import { tokenizeSpeech } from '../domain/numberWords';
import type { DraftMessage } from '../protocol/server';
import { billReadback, gstRateNeeded } from '../voice/responses';
import { extractAdjust, fold, foldSet, type Tokens } from './extras';

const FILLER = foldSet([
  'karo', 'kar', 'kardo', 'do', 'de', 'dena', 'lagao', 'laga', 'lagana', 'bhi', 'please', 'aur', 'ab',
  'bill', 'par', 'pe', 'mein', 'me', 'ka', 'ki', 'ke', 'ko',
]);

/**
 * "das percent discount", "5 percent GST", "round off" said on their own while a bill is open.
 * Returns null when the speech is anything else (so it falls through to the normal parser), in
 * particular when it also names an item.
 */
export function adjustDraft(base: DraftMessage, text: string): CorrectionResult | null {
  const bill = base.bill;
  if (base.intent !== 'create_bill' || !bill || bill.items.length === 0) return null;
  const raw = tokenizeSpeech(text.replace(/₹/g, ' rupaye ').replace(/%/g, ' percent '));
  const w: Tokens = { raw, f: raw.map(fold), used: raw.map(() => false) };
  const { adjust, warnings } = extractAdjust(w);
  if (!adjust && warnings.length === 0) return null;
  if (w.f.some((t, i) => !w.used[i] && !FILLER.has(t))) return null;
  if (!adjust) {
    return { applied: false, draft: { ...base, warnings, replyText: gstRateNeeded() } };
  }
  // A newly spoken discount of one kind replaces the other: computeTotals lets an amount win.
  const merged = { ...bill.adjust, ...adjust };
  if (adjust.discountPercent !== undefined) delete merged.discountAmount;
  if (adjust.discountAmount !== undefined) delete merged.discountPercent;
  const total = computeTotals(bill.items.reduce((sum, item) => sum + item.lineTotal, 0), merged).total;
  const paid = bill.udhaar === 0 ? total : Math.min(bill.paid, total);
  const next = { ...bill, total, paid, udhaar: total - paid, adjust: merged };
  const replyText = billReadback({
    ...(base.customer ? { customerName: base.customer.name } : {}), total, udhaar: next.udhaar,
  });
  return { applied: true, draft: { ...base, bill: next, warnings: [], replyText } };
}
