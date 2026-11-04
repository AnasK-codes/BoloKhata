import {
  LIMITS,
  applyPayment,
  balanceReply,
  billReadback,
  cancelled,
  customerAmbiguous,
  customerNeeded,
  customerNotFound,
  itemNotFound,
  nothingPending,
  notUnderstood,
  paymentRecorded,
  saved,
  udhaarNeedsCustomer,
  type CatalogCustomer,
  type CatalogProduct,
  type DraftMessage,
  type LedgerEntry,
  type UnresolvedItem,
} from '@bolbill/shared';
import type { ParseOutcome } from '../parse/orchestrator';

export interface Catalog {
  version: number;
  products: CatalogProduct[];
  customers: CatalogCustomer[];
}

/** A draft the user can still confirm by voice. Only one exists at a time. */
export interface PendingDraft {
  draftId: string;
  intent: 'create_bill' | 'record_payment';
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
  let reply: string[];
  let cacheReply = false;
  if (customer?.ambiguous) {
    reply = customerAmbiguous(customer.ambiguous.candidates.map((c) => c.name), variant);
  } else if (result.unresolvedItems.length > 0) {
    reply = itemNotFound(result.unresolvedItems[0]?.spoken, variant);
  } else if (missingCustomer) {
    reply = customerNeeded(variant);
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

  const confirmable = result.bill.items.length > 0 && unresolved.length === 0 && !missingCustomer;
  const draftId = input.draftId;
  const draft: DraftMessage = {
    ...base,
    draftId,
    intent: 'create_bill',
    ...(customer
      ? { customer: { ...(customer.id ? { id: customer.id } : {}), name: customer.name, isNew: customer.isNew } }
      : {}),
    bill: result.bill,
    unresolved: unresolved.slice(0, LIMITS.maxUnresolved),
    warnings: warningsOf(missingCustomer ? [...result.warnings, MISSING_CUSTOMER_WARNING] : result.warnings, outcome.needsReview),
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

/** "haan" / "nahi": acts on the pending draft. The browser performs the save; this only names it. */
function answer(input: DraftInput, base: Base, variant: number): DraftResult {
  const { pending, outcome } = input;
  const intent = outcome.parsed.intent === 'confirm' ? 'confirm' : 'cancel';
  if (!pending) return plain(input, base, 'unknown', nothingPending(variant), true, { action: 'keep' });
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
