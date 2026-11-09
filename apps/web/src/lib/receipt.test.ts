import { describe, expect, it } from 'vitest';
import { receiptText } from './receipt';
import type { Bill } from '@bolbill/shared';

const bill: Bill = { id: 'demo', items: [{ productId: 'a', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 }], total: 90, paid: 50, udhaar: 40, createdAt: 1 };
describe('receipt', () => {
  it('prints the exact quoted total without inventing a fractional unit price', () => {
    const text = receiptText({ ...bill, items: [{ productId: 'spoken:0:biscuit', name: 'Biscuit', quantity: 3, unit: 'packet', unitPrice: null, lineTotal: 50,
      spokenPrice: { amount: 50, basis: 'line', quantity: 3, unit: 'packet' } }], total: 50, paid: 50, udhaar: 0 });
    expect(text).toContain('3 packet'); expect(text).toContain('₹50');
    expect(text).not.toContain('× ₹0'); expect(text).not.toContain('16.67');
  });
  it('uses the business snapshot, address, contact and footer on a saved receipt', () => {
    const text = receiptText({ ...bill, business: { businessName: 'Synthetic Kirana', address: 'Synthetic Lane, Demo Nagar', mobile: '9000000000', receiptFooter: 'Thank you' } });
    expect(text).toContain('Synthetic Kirana'); expect(text).toContain('Synthetic Lane');
    expect(text).toContain('9000000000'); expect(text).toContain('Thank you');
  });
  it('includes the saved quantities and payment split', () => {
    const text = receiptText(bill, 'Synthetic Customer');
    expect(text).toContain('Synthetic Customer');
    expect(text).toContain('Aata');
    expect(text).toContain('90');
    expect(text).toContain('50');
    expect(text).toContain('40');
  });
  it('clearly labels a reversed receipt', () => {
    expect(receiptText({ ...bill, reversedAt: 2, reversalReason: 'Synthetic mistake' })).toContain('REVERSED');
  });
});

describe('payment status on the receipt', () => {
  const paidBill: Bill = { ...bill, paid: 90, udhaar: 0 };
  it('says UNPAID for a bill that went entirely on khata', () => {
    const text = receiptText({ ...bill, paid: 0, udhaar: 90 });
    expect(text).toContain('Status: UNPAID');
    expect(text).not.toContain('Status: PAID');
  });
  it('says PAID for a fully paid bill', () => {
    expect(receiptText(paidBill)).toContain('Status: PAID');
    expect(receiptText(paidBill)).not.toContain('UNPAID');
  });
  it('says PART PAID with what is left, for a bill that is partly on udhaar', () => {
    expect(receiptText(bill)).toMatch(/Status: PART PAID.*₹40/);
  });
  it('leaves the status off a reversed bill, which says REVERSED instead', () => {
    expect(receiptText({ ...paidBill, reversedAt: 2, reversalReason: 'x' })).not.toContain('Status:');
  });
});
