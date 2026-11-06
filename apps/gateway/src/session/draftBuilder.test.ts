import { describe, expect, it } from 'vitest';
import { CatalogIndex, draftSchema, type ParsedUtterance } from '@bolbill/shared';
import type { LlmStatus, ParseOutcome } from '../parse/orchestrator';
import { resolveUtterance } from '../parse/resolve';
import { buildDraft, type Catalog, type PendingDraft } from './draftBuilder';

const catalog: Catalog = {
  version: 1,
  products: [
    { id: 'p1', name: 'Aata', aliases: [], unit: 'kg', pricePerUnit: 45 },
    { id: 'p2', name: 'Cheeni', aliases: [], unit: 'kg', pricePerUnit: 50 },
  ],
  customers: [
    { id: 'c1', name: 'Sharma ji', aliases: [], balance: 120 },
    { id: 'c2', name: 'Ramesh Sharma', aliases: [], balance: 0 },
    { id: 'c3', name: 'Ramesh Gupta', aliases: [], balance: -30 },
  ],
};
const index = new CatalogIndex(catalog.products, catalog.customers);

const parsed = (p: Partial<ParsedUtterance>): ParsedUtterance => ({
  intent: 'unknown',
  customer: null,
  items: [],
  amount_paid: null,
  udhaar_amount: null,
  confidence: 0.9,
  ...p,
});

function build(p: Partial<ParsedUtterance>, pending: PendingDraft | null = null, llm: LlmStatus = 'skipped', review = false) {
  const utterance = parsed(p);
  const outcome: ParseOutcome = {
    parsed: utterance,
    resolution: resolveUtterance(utterance, index),
    source: 'rules',
    needsReview: review,
    llm,
  };
  const result = buildDraft({ turnId: 7, outcome, catalog, pending, draftId: 'new-id' });
  // Every draft must survive the protocol schema, or the send queue would drop it silently.
  expect(draftSchema.safeParse(result.draft).success).toBe(true);
  return result;
}

const bill = (extra: Partial<ParsedUtterance> = {}) =>
  build({
    intent: 'create_bill',
    customer: 'Sharma ji',
    items: [{ name: 'aata', quantity: 2, unit: 'kg' }],
    ...extra,
  });

describe('udhaar without a customer', () => {
  const noCustomer = (extra: Partial<ParsedUtterance> = {}) =>
    bill({ customer: null, udhaar_amount: 40, ...extra });

  it('is not offered for confirmation, asks whose udhaar it is, and carries a warning', () => {
    const r = noCustomer();
    expect(r.pendingChange).toEqual({ action: 'clear' });
    expect(r.draft.replyText.join(' ')).toMatch(/kiska|kiske|naam/i);
    expect(r.draft.warnings.join(' ')).toMatch(/grahak/i);
    expect(r.draft.bill?.udhaar).toBe(40);
  });

  it('is fine when fully paid with nobody named (a cash sale)', () => {
    const r = bill({ customer: null });
    expect(r.draft.bill?.udhaar).toBe(0);
    expect(r.pendingChange.action).toBe('set');
  });

  it('requires contact details for a brand-new customer who is named', () => {
    const r = bill({ customer: 'Naya Grahak', udhaar_amount: 40 });
    expect(r.draft.customer?.isNew).toBe(true);
    expect(r.draft.customer?.creditReady).toBe(false);
    expect(r.draft.replyText.join(' ')).toContain('mobile');
    expect(r.pendingChange.action).toBe('clear');
  });
});

describe('create_bill', () => {
  it('prices from the catalog, reads the bill back and becomes confirmable', () => {
    const r = bill();
    expect(r.draft).toMatchObject({
      intent: 'create_bill',
      draftId: 'new-id',
      customer: { id: 'c1', name: 'Sharma ji', isNew: false },
      bill: { total: 90, paid: 90, udhaar: 0 },
      unresolved: [],
    });
    expect(r.draft.replyText[0]).toContain('nabbe rupaye');
    expect(r.cacheReply).toBe(false);
    expect(r.pendingChange).toEqual({ action: 'set', pending: { draftId: 'new-id', intent: 'create_bill' } });
  });

  it('mentions udhaar', () => {
    const r = bill({ udhaar_amount: 40 });
    expect(r.draft.bill).toMatchObject({ total: 90, paid: 50, udhaar: 40 });
    expect(r.draft.replyText.join(' ')).toContain('udhaar');
  });

  it('an unknown item is unresolved, spoken as not found, and not confirmable', () => {
    const r = build({ intent: 'create_bill', customer: 'Sharma ji', items: [{ name: 'laptop', quantity: 1, unit: null }] });
    expect(r.draft.unresolved).toMatchObject([{ kind: 'item', spoken: 'laptop' }]);
    expect(r.draft.replyText.join(' ')).toContain('laptop');
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });

  it('an ambiguous customer asks which one and is not confirmable', () => {
    const r = build({ intent: 'create_bill', customer: 'Ramesh', items: [{ name: 'aata', quantity: 1, unit: 'kg' }] });
    expect(r.draft.unresolved.some((u) => u.kind === 'customer')).toBe(true);
    expect(r.draft.customer?.id).toBeUndefined();
    expect(r.draft.replyText.join(' ')).toContain('Ramesh');
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });

  it('a new customer keeps the spoken name and is still confirmable', () => {
    const r = build({ intent: 'create_bill', customer: 'Tiwari ji', items: [{ name: 'aata', quantity: 1, unit: 'kg' }] });
    expect(r.draft.customer).toMatchObject({ name: 'Tiwari ji', isNew: true });
    expect(r.pendingChange.action).toBe('set');
  });

  it('adds a review warning when the outcome is flagged', () => {
    expect(bill({}).draft.warnings).toEqual([]);
    const flagged = build({ intent: 'create_bill', customer: 'Sharma ji', items: [{ name: 'aata', quantity: 1, unit: 'kg' }] }, null, 'timeout', true);
    expect(flagged.draft.warnings).toContain('Please check this draft before saving.');
  });

  it('an empty bill becomes a retry prompt', () => {
    const r = build({ intent: 'create_bill', customer: 'Sharma ji' });
    expect(r.draft.intent).toBe('unknown');
    expect(r.cacheReply).toBe(true);
  });
});

describe('record_payment', () => {
  it('names the customer and amount and is confirmable', () => {
    const r = build({ intent: 'record_payment', customer: 'Sharma ji', amount_paid: 100 });
    expect(r.draft).toMatchObject({ intent: 'record_payment', payment: { amount: 100 }, customer: { id: 'c1' } });
    expect(r.draft.replyText.join(' ')).toContain('sau rupaye');
    expect(r.draft.warnings).toEqual([]);
    expect(r.pendingChange.action).toBe('set');
  });
  it('warns when it is more than is owed', () => {
    const r = build({ intent: 'record_payment', customer: 'Sharma ji', amount_paid: 500 });
    expect(r.draft.warnings[0]).toMatch(/more than the customer owes/);
  });
  it('needs a known customer', () => {
    const r = build({ intent: 'record_payment', customer: 'Tiwari ji', amount_paid: 100 });
    expect(r.draft.payment).toBeUndefined();
    expect(r.draft.unresolved).toMatchObject([{ kind: 'customer', spoken: 'Tiwari ji' }]);
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });
  it('needs an amount', () => {
    expect(build({ intent: 'record_payment', customer: 'Sharma ji', amount_paid: null }).draft.payment).toBeUndefined();
  });
});

describe('query_balance', () => {
  it('answers from the snapshot and leaves a pending draft alone', () => {
    const r = build({ intent: 'query_balance', customer: 'Sharma ji' }, { draftId: 'old', intent: 'create_bill' });
    expect(r.draft.balance).toEqual({ balance: 120 });
    expect(r.draft.replyText[0]).toContain('ek sau bees rupaye');
    expect(r.pendingChange).toEqual({ action: 'keep' });
  });
  it('explains a negative balance', () => {
    const r = build({ intent: 'query_balance', customer: 'Ramesh Gupta' });
    expect(r.draft.balance).toEqual({ balance: -30 });
    expect(r.draft.replyText[0]).toContain('wapas');
  });
  it('asks which customer, or says it is not found', () => {
    expect(build({ intent: 'query_balance', customer: 'Ramesh' }).draft.replyText.join(' ')).toContain('Ramesh Sharma');
    expect(build({ intent: 'query_balance', customer: 'Tiwari ji' }).draft.balance).toBeUndefined();
    expect(build({ intent: 'query_balance', customer: null }).draft.replyText.length).toBeGreaterThan(0);
  });
});

describe('confirm, cancel, unknown', () => {
  const pending: PendingDraft = { draftId: 'pending-1', intent: 'create_bill' };
  it('confirm names the pending draft and clears it', () => {
    const r = build({ intent: 'confirm', confidence: 0.95 }, pending);
    expect(r.draft).toMatchObject({ intent: 'confirm', draftId: 'pending-1' });
    expect(r.cacheReply).toBe(true);
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });
  it('cancel names the pending draft and clears it', () => {
    const r = build({ intent: 'cancel', confidence: 0.95 }, pending);
    expect(r.draft).toMatchObject({ intent: 'cancel', draftId: 'pending-1' });
  });
  it('without a pending draft, yes or no does nothing', () => {
    for (const intent of ['confirm', 'cancel'] as const) {
      const r = build({ intent }, null);
      expect(r.draft.intent).toBe('unknown');
      expect(r.draft.replyText[0]).toMatch(/pending|kuch nahi/);
      expect(r.pendingChange).toEqual({ action: 'keep' });
    }
  });
  it('unknown speaks a retry prompt and keeps a pending draft', () => {
    const r = build({ intent: 'unknown', confidence: 0.1 }, pending);
    expect(r.draft.intent).toBe('unknown');
    expect(r.cacheReply).toBe(true);
    expect(r.pendingChange).toEqual({ action: 'keep' });
  });
});

describe('discount, GST and round-off', () => {
  it('prices the bill after the adjustment and keeps it on the draft', () => {
    // 2 kg aata at 45 = 90; 10 off -> 80.
    const r = bill({ adjust: { discountAmount: 10 } });
    expect(r.draft.bill?.total).toBe(80);
    expect(r.draft.bill?.adjust).toEqual({ discountAmount: 10 });
    expect(r.draft.bill?.paid).toBe(80);
  });

  it('warns and asks for a review when GST was asked for without a rate', () => {
    const r = bill({ adjustWarnings: ['GST kitna percent? Bolo: "5 percent GST".'] });
    expect(r.draft.warnings.join(' ')).toMatch(/GST/);
  });
});

describe('query_summary', () => {
  const shopCatalog: Catalog = { ...catalog, shop: { todaySales: 1250, todayBills: 4, totalUdhaar: 90 } };
  const run = (c: Catalog) => {
    const utterance = parsed({ intent: 'query_summary' });
    const outcome: ParseOutcome = { parsed: utterance, resolution: resolveUtterance(utterance, index), source: 'rules', needsReview: false, llm: 'skipped' };
    const result = buildDraft({ turnId: 7, outcome, catalog: c, pending: null, draftId: 'new-id' });
    expect(draftSchema.safeParse(result.draft).success).toBe(true);
    return result;
  };

  it('answers from the device snapshot and leaves any pending draft alone', () => {
    const r = run(shopCatalog);
    expect(r.draft.summary).toEqual({ todaySales: 1250, todayBills: 4, totalUdhaar: 90 });
    expect(r.pendingChange).toEqual({ action: 'keep' });
    expect(r.draft.replyText.join(' ')).toMatch(/bill/i);
  });

  it('says it did not understand when the device sent no shop numbers', () => {
    const r = run(catalog);
    expect(r.draft.summary).toBeUndefined();
    expect(r.draft.intent).toBe('unknown');
  });
});

describe('out_of_stock', () => {
  it('names the product and waits for a spoken yes', () => {
    const r = build({ intent: 'out_of_stock', items: [{ name: 'aata', quantity: 1, unit: null }] });
    expect(r.draft.stock).toEqual({ productId: 'p1', name: 'Aata' });
    expect(r.pendingChange).toEqual({ action: 'set', pending: { draftId: 'new-id', intent: 'out_of_stock' } });
  });

  it('does not guess when the product is unknown', () => {
    const r = build({ intent: 'out_of_stock', items: [{ name: 'xyzzy', quantity: 1, unit: null }] });
    expect(r.draft.stock).toBeUndefined();
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });
});

describe('add_customer', () => {
  const add = (customer: string | null, pending: PendingDraft | null = null) => build({ intent: 'add_customer', customer }, pending);

  it('offers a new customer for confirmation by voice or tap', () => {
    const r = add('Anil Singh');
    expect(r.draft.intent).toBe('add_customer');
    expect(r.draft.customer).toEqual({ name: 'Anil Singh', isNew: true });
    expect(r.pendingChange).toEqual({ action: 'set', pending: { draftId: 'new-id', intent: 'add_customer' } });
    expect(r.draft.replyText.join(' ')).toContain('Anil Singh');
  });

  it('does not offer a customer that already exists', () => {
    const r = add('Sharma ji');
    expect(r.draft.intent).toBe('add_customer');
    expect(r.draft.customer).toMatchObject({ id: 'c1', isNew: false });
    expect(r.pendingChange).toEqual({ action: 'clear' });
    expect(r.draft.replyText.join(' ')).toContain('pehle se');
  });

  it('asks which one when the name matches two customers', () => {
    const r = add('Ramesh');
    expect(r.pendingChange).toEqual({ action: 'clear' });
    expect(r.draft.unresolved[0]?.kind).toBe('customer');
  });

  it('is not understood without a name', () => {
    const r = add(null);
    expect(r.draft.intent).toBe('unknown');
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });

  it('is saved by a spoken "haan"', () => {
    const pending: PendingDraft = { draftId: 'd-add', intent: 'add_customer', canConfirm: true };
    const r = build({ intent: 'confirm' }, pending);
    expect(r.draft).toMatchObject({ intent: 'confirm', draftId: 'd-add' });
    expect(r.pendingChange).toEqual({ action: 'clear' });
  });
});

describe('add_product', () => {
  const add = (name: string | null, unit: 'kg' | null = 'kg', amount = 40) =>
    build({
      intent: 'add_product',
      items: name ? [{ name, quantity: 1, unit, spokenPrice: { amount, basis: 'unit' as const, unit } }] : [],
    });

  it('offers a new product with its unit and price for confirmation', () => {
    const r = add('Maida');
    expect(r.draft.intent).toBe('add_product');
    expect(r.draft.product).toEqual({ name: 'Maida', unit: 'kg', pricePerUnit: 40, isNew: true });
    expect(r.pendingChange).toEqual({ action: 'set', pending: { draftId: 'new-id', intent: 'add_product' } });
    expect(r.draft.replyText.join(' ')).toContain('Maida');
  });

  it('defaults to piece when no unit was spoken', () => {
    expect(add('Rusk', null, 20).draft.product).toMatchObject({ unit: 'piece', pricePerUnit: 20 });
  });

  it('does not offer a product that already exists', () => {
    const r = add('aata');
    expect(r.draft.product).toMatchObject({ id: 'p1', isNew: false });
    expect(r.pendingChange).toEqual({ action: 'clear' });
    expect(r.draft.replyText.join(' ')).toContain('pehle se');
  });

  it('is not understood without a product or a usable price', () => {
    expect(add(null).draft.intent).toBe('unknown');
    expect(add('Maida', 'kg', 0).draft.intent).toBe('unknown');
  });

  it('is saved by a spoken "haan"', () => {
    const pending: PendingDraft = { draftId: 'd-prod', intent: 'add_product', canConfirm: true };
    const r = build({ intent: 'confirm' }, pending);
    expect(r.draft).toMatchObject({ intent: 'confirm', draftId: 'd-prod' });
  });
});
