import { describe, expect, it } from 'vitest';
import { receiptText } from './receipt';
import type { Bill } from '@bolbill/shared';

const bill: Bill = { id: 'demo', items: [{ productId: 'a', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 }], total: 90, paid: 50, udhaar: 40, createdAt: 1 };
describe('receipt', () => {
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
