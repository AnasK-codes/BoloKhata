import {
  CatalogIndex,
  billReadback,
  buildBill,
  computeTotals,
  isEmptyAdjust,
  repriceBillItem,
  paymentRecorded,
  parseUtterance,
  type BillAdjust,
  type BillItem,
  type CatalogCustomer,
  type CatalogProduct,
  type DraftMessage,
} from '@bolbill/shared';

/**
 * Local edits to a draft on screen. Every number is recomputed here with the same shared
 * pricing code the gateway uses, so an edit shows its new total instantly and a spoken "haan"
 * afterwards saves exactly what is on screen. Functions return a new draft; nothing is mutated.
 */

function withBill(draft: DraftMessage, items: BillItem[], paid: number): DraftMessage {
  const adjust = draft.bill?.adjust;
  const total = computeTotals(items.reduce((sum, i) => sum + i.lineTotal, 0), adjust).total;
  const clampedPaid = Math.min(Math.max(0, Math.round(paid)), total);
  const bill = { items, total, paid: clampedPaid, udhaar: total - clampedPaid, ...(adjust ? { adjust } : {}) };
  return { ...draft, bill, replyText: readback(draft, bill.total, bill.udhaar) };
}

function readback(draft: DraftMessage, total: number, udhaar: number): DraftMessage['replyText'] {
  const sentences = billReadback({ ...(draft.customer ? { customerName: draft.customer.name } : {}), total, udhaar });
  return sentences.length > 0 ? (sentences as DraftMessage['replyText']) : draft.replyText;
}

/** The draft without its open question. */
function closeQuestion(draft: DraftMessage): DraftMessage {
  const { clarification: _closed, ...rest } = draft;
  return rest;
}

export function setItemQuantity(draft: DraftMessage, index: number, quantity: number): DraftMessage {
  const bill = draft.bill;
  const item = bill?.items[index];
  if (!bill || !item || !Number.isFinite(quantity) || quantity <= 0) return draft;
  const items = bill.items.map((it, i) =>
    i === index ? repriceBillItem(it, quantity) ?? it : it,
  );
  // Setting the amount of the line in question answers "kitna chahiye?".
  const answered = draft.clarification?.slot === 'quantity' && draft.clarification.itemIndex === index;
  return withBill(answered ? closeQuestion(draft) : draft, items, bill.paid);
}

/** Amount choices for the "kitna chahiye?" chips, in the line's own unit. */
export function quantityChoices(unit: BillItem['unit']): number[] {
  if (unit === 'kg' || unit === 'l') return [0.25, 0.5, 1, 2, 5];
  if (unit === 'g' || unit === 'ml') return [100, 250, 500];
  return [1, 2, 5, 10];
}

/** "do kilo kya?" answered by a tap: the product is added with the amount already heard. */
export function answerMissingItem(draft: DraftMessage, product: CatalogProduct): DraftMessage {
  const ask = draft.clarification;
  const bill = draft.bill ?? { items: [], total: 0, paid: 0, udhaar: 0 };
  if (ask?.slot !== 'item' || ask.spoken !== undefined) return draft;
  const added = buildBill({ parsedItems: [{ name: product.name, quantity: ask.quantity ?? 1, unit: ask.unit ?? null }], products: [product] }).bill.items[0];
  if (!added) return draft;
  return withBill(closeQuestion(draft), [...bill.items, added], bill.udhaar === 0 ? Number.MAX_SAFE_INTEGER : bill.paid);
}

/** "Hatao" on the open question: drop what it was about (a missing or unknown item) and close it. */
export function dismissQuestion(draft: DraftMessage): DraftMessage {
  const ask = draft.clarification;
  if (!ask) return draft;
  if (ask.slot === 'item' && ask.spoken !== undefined) {
    return closeQuestion({ ...draft, unresolved: draft.unresolved.filter((u) => !(u.kind === 'item' && u.spoken === ask.spoken)) });
  }
  if (ask.slot === 'quantity' && ask.itemIndex !== undefined) return removeItem(draft, ask.itemIndex);
  return closeQuestion(draft);
}

/**
 * Sets (or clears, with undefined) the discount, GST and round-off. A bill that was fully paid
 * stays fully paid at the new total; a credit bill keeps the amount already paid.
 */
export function setAdjust(draft: DraftMessage, adjust: BillAdjust | undefined): DraftMessage {
  const bill = draft.bill;
  if (!bill) return draft;
  const next = isEmptyAdjust(adjust) ? undefined : adjust;
  const { adjust: _old, ...rest } = bill;
  const base: DraftMessage = { ...draft, bill: { ...rest, ...(next ? { adjust: next } : {}) } };
  return withBill(base, bill.items, bill.udhaar === 0 ? Number.MAX_SAFE_INTEGER : bill.paid);
}

export function removeItem(draft: DraftMessage, index: number): DraftMessage {
  const bill = draft.bill;
  if (!bill || index < 0 || index >= bill.items.length) return draft;
  // A question about this line is gone with it; one about a later line moves up with it.
  const ask = draft.clarification;
  let next = draft;
  if (ask?.slot === 'quantity' && ask.itemIndex !== undefined) {
    if (ask.itemIndex === index) next = closeQuestion(draft);
    else if (ask.itemIndex > index) next = { ...draft, clarification: { ...ask, itemIndex: ask.itemIndex - 1 } };
  }
  return withBill(next, bill.items.filter((_, i) => i !== index), bill.paid);
}

/** Amount paid now; the rest becomes udhaar. Clamped between 0 and the total. */
export function setPaid(draft: DraftMessage, paid: number): DraftMessage {
  if (!draft.bill) return draft;
  return withBill(draft, draft.bill.items, paid);
}

/** One tap on a quick tile: 100 g or ml, otherwise one whole unit. */
const tileQuantity = (unit: CatalogProduct['unit']): number => (unit === 'g' || unit === 'ml' ? 100 : 1);

/** A new cash bill with one unit of the tapped product at its catalog price. */
export function billFromProduct(product: CatalogProduct, draftId: string, turnId: number): DraftMessage {
  const built = buildBill({ parsedItems: [{ name: product.name, quantity: tileQuantity(product.unit), unit: product.unit }], products: [product] });
  const bill = built.bill;
  return {
    type: 'draft',
    turnId,
    draftId,
    intent: 'create_bill',
    source: 'rules',
    confidence: 1,
    bill,
    unresolved: [],
    warnings: [],
    replyText: billReadback({ total: bill.total, udhaar: bill.udhaar }) as DraftMessage['replyText'],
  };
}

/** Adds a tapped product to the bill on screen: a new line, or more of the line it already has. */
export function addProductToDraft(draft: DraftMessage, product: CatalogProduct): DraftMessage {
  const bill = draft.bill;
  if (draft.intent !== 'create_bill' || !bill) return draft;
  const step = tileQuantity(product.unit);
  const at = bill.items.findIndex((i) => i.productId === product.id);
  if (at >= 0) return setItemQuantity(draft, at, (bill.items[at]?.quantity ?? 0) + step);
  const added = buildBill({ parsedItems: [{ name: product.name, quantity: step, unit: product.unit }], products: [product] }).bill.items[0];
  if (!added) return draft;
  // A cash bill stays fully paid at the new total; a credit bill keeps what was already paid.
  return withBill(draft, [...bill.items, added], bill.udhaar === 0 ? Number.MAX_SAFE_INTEGER : bill.paid);
}

/** Resolves one unresolved item to a chosen product, keeping the quantity that was spoken. */
export function resolveItem(draft: DraftMessage, unresolvedIndex: number, product: CatalogProduct): DraftMessage {
  const target = draft.unresolved[unresolvedIndex];
  if (!target || target.kind !== 'item') return draft;
  const built = buildBill({
    parsedItems: [{ name: product.name, quantity: target.quantity ?? 1, unit: target.unit ?? null }],
    products: [product],
  });
  const added = built.bill.items[0];
  if (!added) return draft;
  const unresolved = draft.unresolved.filter((_, i) => i !== unresolvedIndex);
  const existing = draft.bill ?? { items: [], total: 0, paid: 0, udhaar: 0 };
  const answered = draft.clarification?.slot === 'item' && draft.clarification.spoken === target.spoken;
  const base = answered ? closeQuestion(draft) : draft;
  const next = withBill({ ...base, unresolved }, [...existing.items, added], existing.paid);
  return { ...next, warnings: draft.warnings.filter((w) => !/no items/i.test(w)) };
}

export function resolveCustomer(draft: DraftMessage, unresolvedIndex: number, customer: { id: string; name: string }): DraftMessage {
  const target = draft.unresolved[unresolvedIndex];
  if (!target || target.kind !== 'customer') return draft;
  const base = draft.clarification?.slot === 'customer' ? closeQuestion(draft) : draft;
  const next = { ...base, customer: { id: customer.id, name: customer.name, isNew: false }, unresolved: draft.unresolved.filter((_, i) => i !== unresolvedIndex) };
  return draft.bill ? { ...next, replyText: readback(next, draft.bill.total, draft.bill.udhaar) } : next;
}

export function setCustomer(draft: DraftMessage, customer: { id?: string; name: string; isNew: boolean; creditReady?: boolean }): DraftMessage {
  const base = draft.clarification?.slot === 'customer' ? closeQuestion({ ...draft, unresolved: draft.unresolved.filter((u) => u.kind !== 'customer') }) : draft;
  const next: DraftMessage = { ...base, customer: { ...(customer.id ? { id: customer.id } : {}), name: customer.name, isNew: customer.isNew, ...(customer.creditReady !== undefined ? { creditReady: customer.creditReady } : {}) } };
  return draft.bill ? { ...next, replyText: readback(next, draft.bill.total, draft.bill.udhaar) } : next;
}

/**
 * Re-runs the shared rule parser and pricing on corrected text. Only bills and payments can be
 * rebuilt this way; for anything else it returns null and the caller keeps the draft.
 */
export function draftFromTranscript(
  base: DraftMessage,
  text: string,
  products: readonly CatalogProduct[],
  customers: readonly CatalogCustomer[],
): DraftMessage | null {
  const index = new CatalogIndex(products, customers);
  const parsed = parseUtterance(text, index);
  const common = { type: 'draft' as const, turnId: base.turnId, draftId: base.draftId, source: 'rules' as const, confidence: parsed.confidence };

  const customerMatch = parsed.customer ? index.matchCustomer(parsed.customer) : null;
  const unresolved: DraftMessage['unresolved'] = [];
  let customer: DraftMessage['customer'];
  if (parsed.customer && customerMatch) {
    if (customerMatch.best && !customerMatch.ambiguous) {
      customer = { id: customerMatch.best.id, name: customerMatch.best.name, isNew: false };
    } else if (customerMatch.ambiguous) {
      unresolved.push({ kind: 'customer', spoken: parsed.customer, candidates: customerMatch.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score })) });
    } else {
      customer = { name: parsed.customer, isNew: true };
    }
  }

  if (parsed.intent === 'create_bill') {
    const result = buildBill({ parsedItems: parsed.items, products: index, amountPaid: parsed.amount_paid, udhaarAmount: parsed.udhaar_amount, ...(parsed.adjust ? { adjust: parsed.adjust } : {}), ...(parsed.creditAll ? { creditAll: true } : {}) });
    if (result.bill.items.length === 0 && result.unresolvedItems.length === 0) return null;
    const draft: DraftMessage = {
      ...common,
      intent: 'create_bill',
      ...(customer ? { customer } : {}),
      bill: result.bill,
      unresolved: [...result.unresolvedItems, ...unresolved].slice(0, 10),
      warnings: [...result.warnings, ...(parsed.adjustWarnings ?? [])].slice(0, 8),
      replyText: base.replyText,
    };
    return { ...draft, replyText: readback(draft, result.bill.total, result.bill.udhaar) };
  }
  if (parsed.intent === 'record_payment' && parsed.amount_paid && parsed.amount_paid > 0) {
    return {
      ...common,
      intent: 'record_payment',
      ...(customer ? { customer } : {}),
      payment: { amount: parsed.amount_paid },
      unresolved,
      warnings: [],
      replyText: paymentRecorded(customer?.name ?? null, parsed.amount_paid) as DraftMessage['replyText'],
    };
  }
  return null;
}
