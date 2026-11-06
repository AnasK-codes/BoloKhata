import {
  LIMITS,
  addCustomerAsk,
  addProductAsk,
  addProductNeedsRate,
  addProductsAsk,
  applyPayment,
  balanceReply,
  billReadback,
  cancelled,
  customerAmbiguous,
  customerExists,
  customerNeeded,
  customerNotFound,
  itemNotFound,
  nothingPending,
  notUnderstood,
  stockOutAsk,
  summaryReply,
  type ShopStats,
  paymentRecorded,
  priceUnchanged,
  productExists,
  saved,
  udhaarNeedsCustomer,
  type CatalogCustomer,
  type CatalogProduct,
  type DraftMessage,
  type LedgerEntry,
  updatePriceAsk,
  type UnresolvedItem,
} from '@bolbill/shared';
import type { ParseOutcome } from '../parse/orchestrator';
import { modelReplyFor } from '../parse/agent/reply';

export interface Catalog {
  version: number;
  products: CatalogProduct[];
  customers: CatalogCustomer[];
  shop?: ShopStats;
}

/** A draft the user can still confirm by voice. Only one exists at a time. */
export interface PendingDraft {
  draftId: string;
  intent: 'create_bill' | 'record_payment' | 'out_of_stock' | 'add_customer' | 'add_product' | 'add_products' | 'update_price';
  canConfirm?: boolean;
}

export type PendingChange = { action: 'set'; pending: PendingDraft } | { action: 'clear' } | { action: 'keep' };

export interface DraftInput {
  turnId: number;
  outcome: ParseOutcome;
  catalog: Catalog;
  pending: PendingDraft | null;
  /** Used for a new draft. A confirm or cancel reuses the pending draft's id instead. */
  draftId: string;
}

export interface DraftResult {
  draft: DraftMessage;
  /** True when the reply has no names or amounts, so its audio can come from the phrase cache. */
  cacheReply: boolean;
  pendingChange: PendingChange;
}

const MISSING_CUSTOMER_WARNING = 'Udhaar ke liye grahak ka naam chuno.';
const REVIEW_WARNING = 'Please check this draft before saving.';

/**
 * Turns a parse outcome into the `draft` message and the spoken reply. Pure: no I/O, no clock.
 * Every number in it comes from the catalog snapshot through shared pricing and ledger code.
 *
 * What the user can confirm by voice ("haan") is decided here: only a bill with items that all
 * resolved to a product and a customer who is not ambiguous, or a payment for a known customer.
 * Anything else is shown for correction and cannot be saved by a spoken yes.
 */
export function buildDraft(input: DraftInput): DraftResult {
  const result = buildTemplateDraft(input);
  // ai_only: the model's own reply replaces the template when it is safe to say (see modelReplyFor).
  const template = input.outcome.modelReply;
  if (!template) return result;
  const sentences = modelReplyFor(result.draft, template, input.outcome.parsed.intent === 'unknown');
  return sentences ? { ...result, draft: { ...result.draft, replyText: sentences }, cacheReply: false } : result;
}

function buildTemplateDraft(input: DraftInput): DraftResult {
  const { outcome, turnId } = input;
  const variant = turnId;
  const base = {
    type: 'draft' as const,
    turnId,
    source: outcome.source,
    confidence: outcome.parsed.confidence,
  };

  switch (outcome.parsed.intent) {
    case 'create_bill':
      return createBill(input, base, variant);
    case 'record_payment':
      return recordPayment(input, base, variant);
    case 'query_balance':
      return queryBalance(input, base, variant);
    case 'query_summary':
      return querySummary(input, base, variant);
    case 'out_of_stock':
      return outOfStock(input, base, variant);
    case 'add_customer':
      return addCustomer(input, base, variant);
    case 'add_product':
      return addProduct(input, base, variant);
    case 'update_price':
      return updatePrice(input, base, variant);
    case 'add_products':
      return addProducts(input, base, variant);
    case 'confirm':
    case 'cancel':
      return answer(input, base, variant);
    case 'unknown':
      return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'keep' });
  }
}

type Base = Pick<DraftMessage, 'type' | 'turnId' | 'source' | 'confidence'>;

function createBill(input: DraftInput, base: Base, variant: number): DraftResult {
  const { outcome } = input;
  const result = outcome.resolution.bill;
  const customer = outcome.resolution.customer;
  if (!result) return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'keep' });

  const unresolved: UnresolvedItem[] = [...result.unresolvedItems];
  if (customer?.ambiguous) unresolved.push(customer.ambiguous);

  if (result.bill.items.length === 0 && unresolved.length === 0) {
    return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'clear' });
  }

  // Udhaar with nobody to owe it would be stored with no ledger entry: do not offer to save it.
  const missingCustomer = udhaarNeedsCustomer(result.bill.udhaar, customer !== undefined && customer !== null);
  const creditReady = customer?.id ? input.catalog.customers.find((c) => c.id === customer.id)?.creditReady : false;
  const missingDetails = result.bill.udhaar > 0 && creditReady === false;
  let reply: string[];
  let cacheReply = false;
  if (customer?.ambiguous) {
    reply = customerAmbiguous(customer.ambiguous.candidates.map((c) => c.name), variant);
  } else if (result.unresolvedItems.length > 0) {
    reply = itemNotFound(result.unresolvedItems[0]?.spoken, variant);
  } else if (missingCustomer) {
    reply = customerNeeded(variant);
  } else if (missingDetails) {
    reply = ['Udhaar ke liye grahak ka naam, mobile aur address bharo.'];
  } else {
    reply = billReadback(
      { ...(customer ? { customerName: customer.name } : {}), total: result.bill.total, udhaar: result.bill.udhaar },
      variant,
    );
  }
  if (reply.length === 0) {
    reply = notUnderstood(variant);
    cacheReply = true;
  }

  const confirmable = result.bill.items.length > 0 && unresolved.length === 0 && !missingCustomer && !missingDetails;
  const draftId = input.draftId;
  const draft: DraftMessage = {
    ...base,
    draftId,
    intent: 'create_bill',
    ...(customer
      ? { customer: { ...(customer.id ? { id: customer.id } : {}), name: customer.name, isNew: customer.isNew, ...(creditReady !== undefined ? { creditReady } : {}) } }
      : {}),
    bill: result.bill,
    unresolved: unresolved.slice(0, LIMITS.maxUnresolved),
    warnings: warningsOf([...result.warnings, ...(outcome.parsed.adjustWarnings ?? []), ...(missingCustomer ? [MISSING_CUSTOMER_WARNING] : [])], outcome.needsReview || (outcome.parsed.adjustWarnings?.length ?? 0) > 0),
    replyText: reply,
  };
  return {
    draft,
    cacheReply,
    pendingChange: confirmable ? { action: 'set', pending: { draftId, intent: 'create_bill' } } : { action: 'clear' },
  };
}

function recordPayment(input: DraftInput, base: Base, variant: number): DraftResult {
  const { outcome, catalog } = input;
  const customer = outcome.resolution.customer;
  const amount = outcome.parsed.amount_paid;
  const intent = 'record_payment' as const;

  if (customer?.ambiguous) {
    const reply = customerAmbiguous(customer.ambiguous.candidates.map((c) => c.name), variant);
    return plain(input, base, intent, reply, false, { action: 'clear' }, [customer.ambiguous]);
  }
  if (!customer?.id) {
    const spoken = customer?.name;
    const missing: UnresolvedItem[] = spoken ? [{ kind: 'customer', spoken, candidates: [] }] : [];
    return plain(input, base, intent, customerNotFound(spoken, variant), !spoken, { action: 'clear' }, missing);
  }
  if (amount === null || amount <= 0) {
    return plain(input, base, intent, notUnderstood(variant), true, { action: 'clear' });
  }

  const known = catalog.customers.find((c) => c.id === customer.id);
  const payment = applyPayment(customer.id, amount, openingEntries(customer.id, known?.balance ?? 0), {
    id: 'draft',
    createdAt: 0,
  });
  const warnings = payment.ok ? payment.warnings : [payment.error];
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    customer: { id: customer.id, name: customer.name, isNew: false },
    payment: { amount },
    unresolved: [],
    warnings: warningsOf(warnings, outcome.needsReview),
    replyText: paymentRecorded(customer.name, amount, variant),
  };
  return {
    draft,
    cacheReply: false,
    pendingChange: payment.ok
      ? { action: 'set', pending: { draftId: input.draftId, intent } }
      : { action: 'clear' },
  };
}

function queryBalance(input: DraftInput, base: Base, variant: number): DraftResult {
  const { outcome, catalog } = input;
  const customer = outcome.resolution.customer;
  const intent = 'query_balance' as const;
  if (customer?.ambiguous) {
    const reply = customerAmbiguous(customer.ambiguous.candidates.map((c) => c.name), variant);
    return plain(input, base, intent, reply, false, { action: 'keep' }, [customer.ambiguous]);
  }
  const known = customer?.id ? catalog.customers.find((c) => c.id === customer.id) : undefined;
  if (!customer || !known) {
    const spoken = customer?.name;
    const missing: UnresolvedItem[] = spoken ? [{ kind: 'customer', spoken, candidates: [] }] : [];
    return plain(input, base, intent, customerNotFound(spoken, variant), !spoken, { action: 'keep' }, missing);
  }
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    customer: { id: known.id, name: known.name, isNew: false },
    balance: { balance: known.balance },
    unresolved: [],
    warnings: warningsOf([], outcome.needsReview),
    replyText: balanceReply(known.name, known.balance, variant),
  };
  return { draft, cacheReply: false, pendingChange: { action: 'keep' } };
}

/** "Anil Singh ko customer mein add karo": a new name waits for "haan"; the browser creates the customer. */
function addCustomer(input: DraftInput, base: Base, variant: number): DraftResult {
  const customer = input.outcome.resolution.customer;
  const intent = 'add_customer' as const;
  if (!customer) return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'clear' });
  if (customer.ambiguous) {
    const reply = customerAmbiguous(customer.ambiguous.candidates.map((c) => c.name), variant);
    return plain(input, base, intent, reply, false, { action: 'clear' }, [customer.ambiguous]);
  }
  if (customer.id) {
    const draft: DraftMessage = {
      ...base,
      draftId: input.draftId,
      intent,
      customer: { id: customer.id, name: customer.name, isNew: false },
      unresolved: [],
      warnings: [],
      replyText: customerExists(customer.name, variant),
    };
    return { draft, cacheReply: false, pendingChange: { action: 'clear' } };
  }
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    customer: { name: customer.name, isNew: true },
    unresolved: [],
    warnings: warningsOf([], input.outcome.needsReview),
    replyText: addCustomerAsk(customer.name, variant),
  };
  return { draft, cacheReply: false, pendingChange: { action: 'set', pending: { draftId: input.draftId, intent } } };
}

/**
 * "Samaan mein chawal 40 rupaye kilo": a new product waits for "haan"; the browser creates it. The
 * price is the literal one the rules heard, shown on the card, never a model's guess.
 */
function addProduct(input: DraftInput, base: Base, variant: number): DraftResult {
  const item = input.outcome.parsed.items[0];
  const price = item?.spokenPrice?.amount;
  const intent = 'add_product' as const;
  // Name only: ask for the rate. A price is never guessed, and a spoken but unusable one is "not understood".
  if (item && item.spokenPrice === undefined && item.name.trim() !== '') {
    return plain(input, base, 'unknown', addProductNeedsRate(item.name.slice(0, LIMITS.maxNameLength), variant), false, { action: 'clear' });
  }
  if (!item || price === undefined || !Number.isInteger(price) || price <= 0) {
    return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'clear' });
  }
  const name = item.name.slice(0, LIMITS.maxNameLength);
  const unit = item.unit ?? 'piece';
  const match = input.outcome.resolution.stockMatch;
  const existing = match && !match.ambiguous ? match.best : undefined;
  if (existing || match?.ambiguous) {
    const shown = existing?.name ?? match?.candidates[0]?.name ?? name;
    const draft: DraftMessage = {
      ...base,
      draftId: input.draftId,
      intent,
      product: { ...(existing ? { id: existing.id } : {}), name: shown, unit, pricePerUnit: price, isNew: false },
      unresolved: [],
      warnings: [],
      replyText: productExists(shown, variant),
    };
    return { draft, cacheReply: false, pendingChange: { action: 'clear' } };
  }
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    product: { name, unit, pricePerUnit: price, isNew: true },
    unresolved: [],
    warnings: warningsOf([], input.outcome.needsReview),
    replyText: addProductAsk(name, unit, price, variant),
  };
  return { draft, cacheReply: false, pendingChange: { action: 'set', pending: { draftId: input.draftId, intent } } };
}

/** "Samaan mein aata 45, cheeni 50, ...": the whole list waits for one "haan"; existing products are skipped. */
function addProducts(input: DraftInput, base: Base, variant: number): DraftResult {
  const items = input.outcome.parsed.items;
  const matches = input.outcome.resolution.rowMatches ?? [];
  const intent = 'add_products' as const;
  const products: NonNullable<DraftMessage['products']> = [];
  items.forEach((item, i) => {
    const price = item.spokenPrice?.amount;
    if (price === undefined || !Number.isInteger(price) || price <= 0) return;
    const unit = item.unit ?? 'piece';
    const match = matches[i];
    const existing = match && !match.ambiguous ? match.best : undefined;
    if (existing || match?.ambiguous) {
      const shown = existing?.name ?? match?.candidates[0]?.name ?? item.name;
      products.push({ ...(existing ? { id: existing.id } : {}), name: shown.slice(0, LIMITS.maxNameLength), unit, pricePerUnit: price, isNew: false });
    } else {
      products.push({ name: item.name.slice(0, LIMITS.maxNameLength), unit, pricePerUnit: price, isNew: true });
    }
  });
  const fresh = products.filter((p) => p.isNew).length;
  if (products.length === 0) return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'clear' });
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    products: products.slice(0, LIMITS.maxBillItems),
    unresolved: [],
    warnings: warningsOf([], input.outcome.needsReview),
    replyText: fresh > 0 ? addProductsAsk(fresh, products.length - fresh, variant) : [`Ye sab samaan mein pehle se hain.`],
  };
  return { draft, cacheReply: false, pendingChange: fresh > 0 ? { action: 'set', pending: { draftId: input.draftId, intent } } : { action: 'clear' } };
}

/**
 * "Chawal ka rate 45 karo": an existing product gets the rate that was spoken, after "haan". The
 * unit stays the product's own: a rate spoken for another unit is refused rather than guessed.
 */
function updatePrice(input: DraftInput, base: Base, variant: number): DraftResult {
  const item = input.outcome.parsed.items[0];
  const price = item?.spokenPrice?.amount;
  const intent = 'update_price' as const;
  if (!item || price === undefined || !Number.isInteger(price) || price <= 0) {
    return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'clear' });
  }
  const match = input.outcome.resolution.stockMatch;
  if (match?.ambiguous) {
    const candidates = match.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score }));
    const unresolved: UnresolvedItem[] = [{ kind: 'item', spoken: item.name.slice(0, LIMITS.maxNameLength), candidates }];
    return plain(input, base, intent, itemNotFound(item.name, variant), false, { action: 'clear' }, unresolved);
  }
  const known = match?.best ? input.catalog.products.find((p) => p.id === match.best?.id) : undefined;
  if (!known) {
    const unresolved: UnresolvedItem[] = [{ kind: 'item', spoken: item.name.slice(0, LIMITS.maxNameLength), candidates: [] }];
    return plain(input, base, intent, itemNotFound(item.name, variant), false, { action: 'clear' }, unresolved);
  }
  if (item.unit !== null && item.unit !== known.unit) {
    return plain(input, base, intent, notUnderstood(variant), true, { action: 'clear' });
  }
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    product: { id: known.id, name: known.name, unit: known.unit, pricePerUnit: price, previousPrice: known.pricePerUnit, isNew: false },
    unresolved: [],
    warnings: warningsOf([], input.outcome.needsReview),
    replyText: price === known.pricePerUnit ? priceUnchanged(known.name, variant) : updatePriceAsk(known.name, known.unit, price, variant),
  };
  const changed = price !== known.pricePerUnit;
  return { draft, cacheReply: false, pendingChange: changed ? { action: 'set', pending: { draftId: input.draftId, intent } } : { action: 'clear' } };
}

/** "Aaj kitni bikri hui": shop-wide numbers from the device's snapshot; nothing to confirm. */
function querySummary(input: DraftInput, base: Base, variant: number): DraftResult {
  const shop = input.catalog.shop;
  if (!shop) return plain(input, base, 'unknown', notUnderstood(variant), true, { action: 'keep' });
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent: 'query_summary',
    summary: { todaySales: shop.todaySales, todayBills: shop.todayBills, totalUdhaar: shop.totalUdhaar },
    unresolved: [],
    warnings: warningsOf([], false),
    replyText: summaryReply(shop.todayBills, shop.todaySales, shop.totalUdhaar, variant),
  };
  return { draft, cacheReply: false, pendingChange: { action: 'keep' } };
}

/** "Aata khatam ho gaya": names one product and waits for "haan"; the browser writes the stock. */
function outOfStock(input: DraftInput, base: Base, variant: number): DraftResult {
  const spoken = input.outcome.parsed.items[0]?.name ?? '';
  const match = input.outcome.resolution.stockMatch;
  const intent = 'out_of_stock' as const;
  if (!match || match.ambiguous || !match.best) {
    const candidates = match?.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score })) ?? [];
    const unresolved: UnresolvedItem[] = spoken ? [{ kind: 'item', spoken: spoken.slice(0, LIMITS.maxNameLength), candidates }] : [];
    return plain(input, base, intent, itemNotFound(spoken, variant), false, { action: 'clear' }, unresolved);
  }
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    stock: { productId: match.best.id, name: match.best.name },
    unresolved: [],
    warnings: warningsOf([], input.outcome.needsReview),
    replyText: stockOutAsk(match.best.name, variant),
  };
  return { draft, cacheReply: false, pendingChange: { action: 'set', pending: { draftId: input.draftId, intent } } };
}

/** "haan" / "nahi": acts on the pending draft. The browser performs the save; this only names it. */
function answer(input: DraftInput, base: Base, variant: number): DraftResult {
  const { pending, outcome } = input;
  const intent = outcome.parsed.intent === 'confirm' ? 'confirm' : 'cancel';
  if (!pending) return plain(input, base, 'unknown', nothingPending(variant), true, { action: 'keep' });
  if (intent === 'confirm' && pending.canConfirm === false) {
    return plain(input, base, 'unknown', ['Bill aur grahak ki details pehle poori karo.'], true, { action: 'keep' });
  }
  const draft: DraftMessage = {
    ...base,
    draftId: pending.draftId,
    intent,
    unresolved: [],
    warnings: [],
    replyText: intent === 'confirm' ? saved(variant) : cancelled(variant),
  };
  return { draft, cacheReply: true, pendingChange: { action: 'clear' } };
}

/** A draft that carries only a spoken reply (retry prompts, not-found replies). */
function plain(
  input: DraftInput,
  base: Base,
  intent: DraftMessage['intent'],
  reply: string[],
  cacheReply: boolean,
  pendingChange: PendingChange,
  unresolved: UnresolvedItem[] = [],
): DraftResult {
  const draft: DraftMessage = {
    ...base,
    draftId: input.draftId,
    intent,
    unresolved: unresolved.slice(0, LIMITS.maxUnresolved),
    warnings: warningsOf([], input.outcome.needsReview && intent !== 'unknown'),
    replyText: reply,
  };
  return { draft, cacheReply, pendingChange };
}

function warningsOf(warnings: readonly string[], needsReview: boolean): string[] {
  const out = warnings
    .map((w) => w.slice(0, LIMITS.maxWarningLength))
    .filter((w) => w !== '')
    .slice(0, LIMITS.maxWarnings);
  if (needsReview && out.length < LIMITS.maxWarnings && !out.includes(REVIEW_WARNING)) out.push(REVIEW_WARNING);
  return out;
}

/** The snapshot balance as ledger entries, so shared ledger code can judge a payment against it. */
function openingEntries(customerId: string, balance: number): LedgerEntry[] {
  if (balance === 0) return [];
  return [
    {
      id: 'opening',
      customerId,
      type: balance > 0 ? 'udhaar' : 'payment',
      amount: Math.abs(balance),
      createdAt: 0,
    },
  ];
}
