import { describe, expect, it } from 'vitest';
import { LIMITS } from '../protocol/constants';
import { CatalogIndex } from '../domain/matching';
import { isInstructionLike, parseUtterance } from './ruleBased';
import { buildBill } from '../domain/pricing';
import { intentSchema } from '../protocol/common';

/**
 * Random Unicode into the rule parser: it never throws, stays fast on the longest transcript
 * (the folding regexes must not backtrack badly), and returns a valid intent and amounts. On garbage
 * it may emit an item with quantity 0 or an invalid-quote marker; pricing must turn those into
 * unresolved items, never a wrong number.
 */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 4_294_967_296);
}
const ALPHABETS = [
  'abcdefghijklmnopqrstuvwxyz      ',
  'bcdfghjklmnpqrstvwxyz',
  'aeiouy ye',
  'अआइईउऊएऐओऔकखगघचछजझटठडढतथदधनपफबभमयरलवशसह्ािीुूेैोौंँः ',
  '0123456789 .,₹/-%',
  '​‍́\u0000\t\n😀🙏',
];
const WORDS = ['do', 'kilo', 'aata', 'Sharma', 'ji', 'ko', 'udhaar', 'haan', 'nahi', 'sau', 'rupaye', 'ignore', 'previous', 'instructions', 'रुपए', 'कितना'];
const index = new CatalogIndex(
  [{ id: 'p1', name: 'Aata', aliases: ['आटा'], unit: 'kg', pricePerUnit: 45 }, { id: 'p2', name: 'Maggi', aliases: [], unit: 'packet', pricePerUnit: 14 }],
  [{ id: 'c1', name: 'Sharma ji', aliases: [] }],
);

describe('parser fuzz', () => {
  it('never throws, stays bounded and yields a sound bill on random Unicode', () => {
    let worst = 0;
    for (let run = 0; run < 600; run++) {
      const rand = prng(run + 3);
      const length = run % 10 === 0 ? LIMITS.maxTranscriptLength * 2 : Math.floor(rand() * LIMITS.maxTranscriptLength);
      let text = '';
      const alphabet = ALPHABETS[run % ALPHABETS.length]!;
      while (text.length < length) text += rand() < 0.3 ? ` ${WORDS[Math.floor(rand() * WORDS.length)]} ` : alphabet[Math.floor(rand() * alphabet.length)];
      const started = performance.now();
      const parsed = parseUtterance(text, index);
      isInstructionLike(text);
      worst = Math.max(worst, performance.now() - started);
      const label = `run ${run}`;
      expect(intentSchema.safeParse(parsed.intent).success, label).toBe(true);
      for (const amount of [parsed.amount_paid, parsed.udhaar_amount]) expect(amount === null || (Number.isSafeInteger(amount) && amount >= 0), label).toBe(true);
      const { bill } = buildBill({ parsedItems: parsed.items, products: index, customerId: 'c1', amountPaid: parsed.amount_paid, udhaarAmount: parsed.udhaar_amount });
      expect(bill.items.every((i) => i.quantity > 0 && Number.isSafeInteger(i.lineTotal)), label).toBe(true);
      expect(bill.paid + bill.udhaar, label).toBe(bill.total);
    }
    // Generous for a loaded CI runner; measured locally well under 1 ms (docs/BACKEND_REVIEW.md).
    expect(worst).toBeLessThan(50);
  });

  it('a long run of consonants and vowels around the folding regexes stays fast', () => {
    for (const text of ['b'.repeat(499) + 'a', 'ba'.repeat(250), 'aye'.repeat(166), 'k' + 'a'.repeat(498) + 'k', `${'ignore '.repeat(60)}x`]) {
      const started = performance.now();
      parseUtterance(text, index);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});
