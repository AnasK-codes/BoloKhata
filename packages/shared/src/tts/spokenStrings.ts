/**
 * Every sentence the app can speak from its templates, with synthetic names and a sweep of
 * amounts, so tests can check each word against the pronunciation corpus. Model-written replies
 * (ai_only mode) cannot be enumerated; they still pass through prepareSpeechText.
 */
import { CLARIFY_SLOTS, type Clarification } from '../protocol/server';
import * as r from '../voice/responses';

const NAME = 'Sharma ji';
const ITEM = 'Aata';
const AMOUNTS = [...Array.from({ length: 100 }, (_, i) => i), 100, 250, 999, 1000, 15_000, 100_000, 2_500_000];
const VARIANTS = [0, 1, 2];
const UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'packet', 'dozen'];

export function allSpokenStrings(): string[] {
  const out: string[][] = [];
  for (const v of VARIANTS) {
    for (const n of AMOUNTS) {
      out.push(r.billReadback({ customerName: NAME, total: n, udhaar: n }, v), r.billReadback({ total: n, udhaar: 0 }, v));
      out.push(r.paymentRecorded(NAME, n, v), r.paymentRecorded(null, n, v));
      out.push(r.balanceReply(NAME, n, v), r.balanceReply(NAME, -n, v));
      out.push(r.summaryReply(n % 7, n, n, v));
    }
    out.push(r.stockOutAsk(ITEM, v), r.stockOutAsk(null, v), r.saved(v), r.cancelled(v), r.notUnderstood(v));
    out.push(r.customerNotFound(NAME, v), r.customerNotFound(null, v), r.itemNotFound(ITEM, v), r.itemNotFound(null, v));
    out.push(r.customerAmbiguous([NAME, 'Verma ji'], v), r.customerNeeded(v), r.addCustomerAsk(NAME, v), r.customerExists(NAME, v));
    for (const unit of UNITS) out.push(r.addProductAsk(ITEM, unit, 45, v), r.updatePriceAsk(ITEM, unit, 45, v));
    out.push(r.addProductNeedsRate(ITEM, v), r.priceUnchanged(ITEM, v), r.addProductsAsk(3, 2, v), r.addProductsAsk(3, 0, v));
    out.push(r.productExists(ITEM, v), r.nothingPending(v));
    for (const slot of CLARIFY_SLOTS) {
      for (const c of clarifications(slot)) out.push(r.clarifyAsk(c, ITEM, v));
    }
  }
  out.push(r.creditDetailsNeeded(), r.detailsFirst(), r.allProductsExist(), r.correctionFailed(), r.billEmptied());
  return [...new Set(out.flat())];
}

function clarifications(slot: Clarification['slot']): Clarification[] {
  const base = { slot, attempts: 1, fallback: false, transcript: 'x' } as const;
  return [
    base,
    { ...base, spoken: 'kesar' },
    { ...base, quantity: 2, unit: 'kg' },
    { ...base, quantity: 0.5, unit: 'kg' },
    { ...base, itemIndex: 0 },
    { ...base, fallback: true, attempts: 2 },
  ];
}
