import { describe, expect, it } from 'vitest';
import type { DraftMessage } from '../protocol/server';
import { isConfirmable } from './confirm';

const base = { type: 'draft', turnId: 1, draftId: 'd1', source: 'rules', confidence: 0.9, unresolved: [], warnings: [], replyText: ['ok'] } as const;
const bill = (udhaar: number) => ({
  items: [{ productId: 'p1', name: 'Aata', quantity: 1, unit: 'kg', unitPrice: 45, lineTotal: 45 }],
  subtotal: 45, total: 45, paid: 45 - udhaar, udhaar,
});
const d = (extra: Partial<DraftMessage>) => ({ ...base, intent: 'unknown', ...extra }) as DraftMessage;

describe('isConfirmable', () => {
  it('bills: items that all resolved, and a ready customer for udhaar', () => {
    expect(isConfirmable(d({ intent: 'create_bill', bill: bill(0) } as Partial<DraftMessage>))).toBe(true);
    expect(isConfirmable(d({ intent: 'create_bill', bill: bill(20) } as Partial<DraftMessage>))).toBe(false);
    expect(isConfirmable(d({ intent: 'create_bill', bill: bill(20), customer: { id: 'c1', name: 'A', isNew: false } } as Partial<DraftMessage>))).toBe(true);
    expect(isConfirmable(d({ intent: 'create_bill', bill: bill(20), customer: { id: 'c1', name: 'A', isNew: false, creditReady: false } } as Partial<DraftMessage>))).toBe(false);
    expect(isConfirmable(d({ intent: 'create_bill', bill: bill(0), unresolved: [{ kind: 'item', spoken: 'x', candidates: [] }] } as Partial<DraftMessage>))).toBe(false);
  });

  it('payments need a known customer', () => {
    expect(isConfirmable(d({ intent: 'record_payment', payment: { amount: 200 } }))).toBe(false);
    expect(isConfirmable(d({ intent: 'record_payment', payment: { amount: 200 }, customer: { id: 'c1', name: 'A', isNew: false } }))).toBe(true);
  });

  it('add and update drafts need something new', () => {
    expect(isConfirmable(d({ intent: 'add_customer', customer: { name: 'A', isNew: true } }))).toBe(true);
    expect(isConfirmable(d({ intent: 'add_customer', customer: { id: 'c1', name: 'A', isNew: false } }))).toBe(false);
    expect(isConfirmable(d({ intent: 'add_product', product: { name: 'X', unit: 'kg', pricePerUnit: 5, isNew: true } }))).toBe(true);
    expect(isConfirmable(d({ intent: 'add_products', products: [{ id: 'p1', name: 'X', unit: 'kg', pricePerUnit: 5, isNew: false }] }))).toBe(false);
    expect(isConfirmable(d({ intent: 'update_price', product: { id: 'p1', name: 'X', unit: 'kg', pricePerUnit: 5, previousPrice: 5, isNew: false } }))).toBe(false);
    expect(isConfirmable(d({ intent: 'update_price', product: { id: 'p1', name: 'X', unit: 'kg', pricePerUnit: 6, previousPrice: 5, isNew: false } }))).toBe(true);
    expect(isConfirmable(d({ intent: 'out_of_stock', stock: { productId: 'p1', name: 'X' } }))).toBe(true);
  });

  it('questions and answers are never confirmable', () => {
    for (const intent of ['query_balance', 'query_summary', 'confirm', 'cancel', 'unknown'] as const) expect(isConfirmable(d({ intent }))).toBe(false);
  });
});
