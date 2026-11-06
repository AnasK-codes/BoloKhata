import { describe, expect, it } from 'vitest';
import { seedIndex } from '../testing/seed';
import { parseUtterance } from './ruleBased';

const index = seedIndex();
const parse = (t: string) => parseUtterance(t, index);

/**
 * Gnani Prisma answers Hindi speech in Devanagari (`indic-auto`). Our keyword lists are Roman, so
 * Devanagari spellings that keep a middle "a" (कितना -> kitana) must still match "kitna".
 */
describe('Devanagari transcripts parse like their Roman spelling', () => {
  it('asks for a balance without a "ka" particle (real transcript)', () => {
    const r = parse('अनिल सिंह जी, क्या कितना उधार है?');
    expect(r.intent).toBe('query_balance');
    expect(r.customer).toMatch(/^अनिल/);
  });

  it('keeps the whole name of a customer who is not in the catalog yet', () => {
    expect(parse('मोहन लाल जी, क्या कितना उधार है?')).toMatchObject({ intent: 'query_balance', customer: 'मोहन लाल जी' });
    expect(parse('Mohan Lal ji kitna udhaar hai')).toMatchObject({ intent: 'query_balance', customer: 'Mohan Lal ji' });
  });

  it('asks for a balance with "ka"', () => {
    const r = parse('मोहन लाल जी का कितना उधार है');
    expect(r.intent).toBe('query_balance');
    expect(r.customer).toBe('मोहन लाल जी');
  });

  it('keeps the Roman form working, with and without "ka"', () => {
    expect(parse('Mohan Lal ji ka kitna udhaar hai')).toMatchObject({ intent: 'query_balance', customer: 'Mohan Lal ji' });
  });

  it('understands a payment', () => {
    expect(parse('शर्मा जी ने दो सौ दे दिए')).toMatchObject({ intent: 'record_payment', amount_paid: 200 });
  });

  it('understands the shop summary', () => {
    expect(parse('आज कितनी बिक्री हुई').intent).toBe('query_summary');
  });

  it('does not turn an unrelated sentence into a balance query', () => {
    expect(parse('कितना').intent).toBe('unknown');
    expect(parse('उधार है').intent).toBe('unknown');
  });
});

describe('add a customer by voice', () => {
  it('understands the real Devanagari transcript', () => {
    const r = parse('अनिल सिंह जी का नाम कस्टमर में ऐड करो।');
    expect(r.intent).toBe('add_customer');
    expect(r.customer).toBe('अनिल सिंह जी');
    expect(r.items).toEqual([]);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it.each([
    ['Ramesh Kumar ko customer mein add karo', 'Ramesh Kumar'],
    ['naya customer Ramesh Kumar', 'Ramesh Kumar'],
    ['customer add karo Ramesh Kumar', 'Ramesh Kumar'],
    ['Ramesh Kumar ko customer banao', 'Ramesh Kumar'],
    ['रमेश कुमार को ग्राहक में जोड़ो', 'रमेश कुमार'],
    ['नया ग्राहक रमेश कुमार', 'रमेश कुमार'],
  ])('%s', (text, name) => {
    const r = parse(text);
    expect(r.intent).toBe('add_customer');
    expect(r.customer).toBe(name);
  });

  it('needs a name', () => {
    expect(parse('customer add karo').intent).toBe('unknown');
  });

  it('does not hijack bills, balances or payments', () => {
    expect(parse('Sharma ji ka kitna udhaar hai').intent).toBe('query_balance');
    expect(parse('Verma ji ne do sau de diye').intent).toBe('record_payment');
    expect(parse('do kilo aata Sharma ji ko').intent).toBe('create_bill');
  });

  it('rejects a name that contains a number', () => {
    expect(parse('customer 5 add karo').intent).not.toBe('add_customer');
  });
});
