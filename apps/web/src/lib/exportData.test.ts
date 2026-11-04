import { describe, expect, it } from 'vitest';
import { backupJson, billsCsv, ledgerCsv, toCsv, type ShopData } from './exportData';

const data: ShopData = {
  products: [{ id: 'p1', name: 'Aata', aliases: [], unit: 'kg', pricePerUnit: 45 }],
  customers: [{ id: 'c1', name: 'Sharma, ji', aliases: [], createdAt: 1 }],
  bills: [
    { id: 'b2', customerId: 'c1', items: [{ productId: 'p1', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 }], total: 85, paid: 85, udhaar: 0, adjust: { discountAmount: 5 }, createdAt: Date.UTC(2026, 10, 5) },
    { id: 'b1', items: [], total: 10, paid: 10, udhaar: 0, createdAt: Date.UTC(2026, 10, 4), reversedAt: Date.UTC(2026, 10, 4) },
  ],
  ledgerEntries: [{ id: 'e1', customerId: 'c1', type: 'udhaar', amount: 40, note: '=HYPERLINK("x")', createdAt: Date.UTC(2026, 10, 5) }],
};

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['a'], [['x,y'], ['say "hi"'], ['l1\nl2']])).toBe('a\r\n"x,y"\r\n"say ""hi"""\r\n"l1\nl2"\r\n');
  });

  it('defuses spreadsheet formulas in text but keeps numbers', () => {
    expect(toCsv(['a'], [['=SUM(A1)'], ['+1'], ['@x'], [-5]])).toBe("a\r\n'=SUM(A1)\r\n'+1\r\n'@x\r\n-5\r\n");
  });
});

describe('billsCsv', () => {
  it('lists bills oldest first with the customer name, adjustments and reversal', () => {
    const lines = billsCsv(data).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^b1,2026-11-04,Cash,,10,10,0,,,,,2026-11-04$/);
    expect(lines[2]).toMatch(/^b2,2026-11-05,"Sharma, ji",Aata 2 kg,85,85,0,5,,,,$/);
  });
});

describe('ledgerCsv', () => {
  it('writes entries with names and escapes a hostile note', () => {
    expect(ledgerCsv(data)).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('backupJson', () => {
  it('contains every table and a timestamp', () => {
    const parsed = JSON.parse(backupJson(data, Date.UTC(2026, 10, 6))) as Record<string, unknown>;
    expect(parsed.exportedAt).toBe('2026-11-06T00:00:00.000Z');
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['products', 'customers', 'bills', 'ledgerEntries']));
  });
});
