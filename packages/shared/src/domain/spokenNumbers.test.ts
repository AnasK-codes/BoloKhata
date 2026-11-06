import { describe, expect, it } from 'vitest';
import { spokenNumbers } from './spokenNumbers';

describe('spokenNumbers', () => {
  it('finds digits, symbols and Hindi number words', () => {
    const n = spokenNumbers('Sharma ji ko do kilo chawal ₹110 ke aur do sau pachas udhaar');
    expect([...n]).toEqual(expect.arrayContaining([2, 110, 200, 250, 50]));
  });

  it('reads Devanagari words and digits', () => {
    const n = spokenNumbers('चालीस रुपए किलो और १२० का');
    expect(n.has(40)).toBe(true);
    expect(n.has(120)).toBe(true);
  });

  it('does not contain a number nobody said', () => {
    const n = spokenNumbers('Verma ji ne do sau de diye');
    expect(n.has(200)).toBe(true);
    expect(n.has(2000)).toBe(false);
    expect(n.has(20)).toBe(false);
  });

  it('is bounded and safe on odd input', () => {
    expect(spokenNumbers('').size).toBe(0);
    expect(spokenNumbers('ek '.repeat(250)).size).toBeGreaterThan(0);
    expect(spokenNumbers(undefined as unknown as string).size).toBe(0);
  });
});
