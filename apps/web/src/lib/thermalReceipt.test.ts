import { describe, expect, it } from 'vitest';
import type { Bill } from '@bolbill/shared';
import { THERMAL_COLUMNS, thermalReceipt, wrapText } from './thermalReceipt';

const bill: Bill = {
  id: 'abcdef123456',
  customerId: 'c1',
  items: [
    { productId: 'p1', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 },
    { productId: 'p2', name: 'Maggi Masala Noodles Family Pack', quantity: 3, unit: 'packet', unitPrice: 28, lineTotal: 84 },
  ],
  total: 174,
  paid: 100,
  udhaar: 74,
  createdAt: Date.UTC(2026, 10, 4, 9, 2),
  business: { businessName: 'Sharma Kirana Store', address: 'Gali 4, Karol Bagh, Delhi 110005', mobile: '9876543210', receiptFooter: 'Dhanyavaad! Phir aaiye.' },
};

const lines = (b: Bill, name?: string) => thermalReceipt(b, name).split('\n');

describe('wrapText', () => {
  it('wraps on spaces and cuts a word that is too long', () => {
    expect(wrapText('aa bb cc', 5)).toEqual(['aa bb', 'cc']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('   ', 5)).toEqual([]);
  });
});

describe('thermalReceipt', () => {
  it('never prints a line wider than the 58 mm roll', () => {
    for (const line of lines(bill, 'Ramesh Kumar Gupta Wholesale Traders')) expect(line.length).toBeLessThanOrEqual(THERMAL_COLUMNS);
  });

  it('prints the shop, items with qty x rate, totals and the footer', () => {
    const text = thermalReceipt(bill, 'Sharma ji');
    expect(text).toContain('SHARMA KIRANA STORE');
    expect(text).toContain('Mob: 9876543210');
    expect(text).toContain('Grahak: Sharma ji');
    expect(text).toMatch(/2 kg x Rs45\s+Rs90/);
    expect(text).toMatch(/3 pkt x Rs28\s+Rs84/);
    expect(text).toMatch(/TOTAL\s+Rs174/);
    expect(text).toMatch(/UDHAAR\s+Rs74/);
    expect(text).toContain('Dhanyavaad! Phir aaiye.');
  });

  it('puts long item names on their own lines above the detail', () => {
    const ls = lines(bill);
    const at = ls.findIndex((l) => l.startsWith('Maggi Masala'));
    expect(at).toBeGreaterThan(-1);
    expect(ls.slice(at, at + 3).join('|')).toContain('Noodles');
  });

  it('shows the adjustment lines only when there is an adjustment', () => {
    expect(thermalReceipt(bill)).not.toMatch(/Subtotal|Chhoot|GST/);
    const adjusted: Bill = { ...bill, total: 160, paid: 160, udhaar: 0, adjust: { discountAmount: 20, gstPercent: 5, roundOff: true } };
    // 174 - 20 = 154; GST 5% = 8 -> 162; round-off to 160 = -2.
    const text = thermalReceipt(adjusted);
    expect(text).toMatch(/Subtotal\s+Rs174/);
    expect(text).toMatch(/Chhoot\s+-Rs20/);
    expect(text).toMatch(/GST 5%\s+\+Rs8/);
    expect(text).toMatch(/Round-off\s+-Rs2/);
    expect(text).toMatch(/TOTAL\s+Rs160/);
    expect(text).not.toMatch(/UDHAAR/);
  });

  it('marks a reversed bill', () => {
    const text = thermalReceipt({ ...bill, reversedAt: Date.UTC(2026, 10, 5), reversalReason: 'galat item' });
    expect(text).toContain('** REVERSED **');
    expect(text).toContain('Wajah: galat item');
  });

  it('works without a saved business profile and without a customer', () => {
    const plain: Bill = { ...bill };
    delete plain.business;
    const text = thermalReceipt(plain);
    expect(text).toContain('BOL-BILL');
    expect(text).not.toContain('Grahak:');
  });

  it('shows a spoken line price without inventing a rate', () => {
    const quoted: Bill = {
      ...bill,
      items: [{ productId: 'x', name: 'Basmati', quantity: 1.5, unit: 'kg', unitPrice: null, lineTotal: 165, spokenPrice: { amount: 165, basis: 'line', quantity: 1.5, unit: 'kg' } }],
      total: 165,
      paid: 165,
      udhaar: 0,
    };
    expect(thermalReceipt(quoted)).toMatch(/1\.5 kg \(bola Rs165\)\s+Rs165/);
  });
});
