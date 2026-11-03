import { describe, expect, it } from 'vitest';
import {
  MAX_SENTENCE_CHARS,
  balanceReply,
  billReadback,
  cancelled,
  customerNotFound,
  itemNotFound,
  notUnderstood,
  paymentRecorded,
  saved,
} from './responses';

const VARIANTS = [0, 1, 2, 3, 7, 100];
const allReplies = (): string[][] =>
  VARIANTS.flatMap((v) => [
    billReadback({ customerName: 'Sharma ji', total: 342, udhaar: 100 }, v),
    billReadback({ total: 1, udhaar: 0 }, v),
    paymentRecorded('Sharma ji', 200, v),
    paymentRecorded(null, 1, v),
    balanceReply('Sharma ji', 450, v),
    balanceReply('Sharma ji', 0, v),
    balanceReply('Sharma ji', -50, v),
    saved(v),
    cancelled(v),
    notUnderstood(v),
    customerNotFound('Tiwari ji', v),
    customerNotFound(null, v),
    itemNotFound('laptop', v),
    itemNotFound('', v),
  ]);

describe('limits that apply to every reply', () => {
  it('has at most two sentences, each non-empty and within 160 characters', () => {
    for (const reply of allReplies()) {
      expect(reply.length).toBeGreaterThanOrEqual(1);
      expect(reply.length).toBeLessThanOrEqual(2);
      for (const s of reply) {
        expect(s.length).toBeGreaterThan(0);
        expect(s.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
      }
    }
  });
  it('clips very long names', () => {
    const long = 'A'.repeat(500);
    for (const reply of [
      billReadback({ customerName: long, total: 10, udhaar: 5 }),
      paymentRecorded(long, 10),
      balanceReply(long, 10),
      customerNotFound(long),
      itemNotFound(long),
    ]) {
      for (const s of reply) expect(s.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    }
  });
  it('never puts digits in a spoken amount (amounts are Hindi words)', () => {
    for (const reply of allReplies()) expect(reply.join(' ')).not.toMatch(/\d/);
  });
  it('is deterministic for a given variant', () => {
    expect(billReadback({ total: 100, udhaar: 0 }, 3)).toEqual(billReadback({ total: 100, udhaar: 0 }, 3));
  });
  it('cycles variants and handles odd variant numbers', () => {
    const a = new Set(VARIANTS.map((v) => billReadback({ customerName: 'Sharma ji', total: 100, udhaar: 0 }, v)[0]));
    expect(a.size).toBeGreaterThan(1);
    expect(() => billReadback({ total: 1, udhaar: 0 }, Number.NaN)).not.toThrow();
    expect(() => billReadback({ total: 1, udhaar: 0 }, -5)).not.toThrow();
  });
});

describe('billReadback', () => {
  it('says the total as Hindi words with the customer name', () => {
    const [first] = billReadback({ customerName: 'Sharma ji', total: 342, udhaar: 0 }, 0);
    expect(first).toContain('Sharma ji');
    expect(first).toContain('teen sau bayalis rupaye');
  });
  it('mentions udhaar only when there is some', () => {
    expect(billReadback({ total: 300, udhaar: 100 }, 0).join(' ')).toContain('ek sau rupaye udhaar');
    expect(billReadback({ total: 300, udhaar: 0 }, 0).join(' ')).not.toContain('udhaar');
  });
  it('uses the singular for one rupee', () => {
    expect(billReadback({ total: 1, udhaar: 0 }, 0)[0]).toContain('ek rupaya');
  });
  it('speaks zero', () => {
    expect(billReadback({ total: 0, udhaar: 0 }, 0)[0]).toContain('sifar rupaye');
  });
  it('handles a large amount', () => {
    expect(billReadback({ total: 12_34_567, udhaar: 0 }, 0)[0]).toContain('barah lakh');
  });
  it('falls back to digits only when an amount is too large to speak', () => {
    expect(billReadback({ total: 5_000_000_000, udhaar: 0 }, 0)[0]).toContain('5000000000 rupaye');
  });
  it('works without a customer', () => {
    expect(billReadback({ total: 50, udhaar: 0 }, 0)[0]).not.toContain('null');
  });
});

describe('paymentRecorded', () => {
  it('names the customer and the amount', () => {
    const text = paymentRecorded('Sharma ji', 200, 0).join(' ');
    expect(text).toContain('Sharma ji');
    expect(text).toContain('do sau rupaye');
  });
  it('uses the singular for one rupee', () => {
    expect(paymentRecorded('Sharma ji', 1, 0).join(' ')).toContain('ek rupaya');
  });
});

describe('balanceReply', () => {
  it('states a positive balance', () => {
    expect(balanceReply('Sharma ji', 450, 0).join(' ')).toContain('chaar sau pachas rupaye');
  });
  it('says nothing is pending at zero', () => {
    const text = balanceReply('Sharma ji', 0, 0).join(' ');
    expect(text).toContain('Sharma ji');
    expect(text).not.toContain('rupaye');
  });
  it('explains a negative balance (shop owes the customer)', () => {
    const text = balanceReply('Sharma ji', -50, 0).join(' ');
    expect(text).toContain('pachas rupaye');
    expect(text).toContain('wapas');
  });
  it('is a single sentence', () => {
    expect(balanceReply('Sharma ji', 450, 0)).toHaveLength(1);
  });
  it('handles a missing name', () => {
    expect(balanceReply(null, 100, 0)[0]).not.toContain('null');
  });
});

describe('error replies', () => {
  it('echo the name that was not found', () => {
    expect(customerNotFound('Tiwari ji', 0).join(' ')).toContain('Tiwari ji');
    expect(itemNotFound('laptop', 0).join(' ')).toContain('laptop');
  });
  it('tell the user what to do next', () => {
    expect(customerNotFound('Tiwari ji')[1]).toBeTruthy();
    expect(itemNotFound('laptop')[1]).toBeTruthy();
    expect(notUnderstood()).toHaveLength(2);
  });
});
