import { describe, expect, it } from 'vitest';
import type { Clarification, DraftMessage } from '../protocol/server';
import { seedIndex } from '../testing/seed';
import { answerFollowUp, nextClarification, repeatClarification, type FollowUp } from './dialogue';

const index = seedIndex();

const line = (productId: string, name: string, quantity: number, unitPrice: number) =>
  ({ productId, name, quantity, unit: 'kg' as const, unitPrice, lineTotal: Math.round(quantity * unitPrice) });

/** A bill draft as the gateway would have sent it, with one open question. */
function context(clarification: Clarification, extra: Partial<DraftMessage> = {}): DraftMessage {
  const items = [line('p_cheeni', 'Cheeni', 1, 48)];
  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    type: 'draft', turnId: 4, draftId: 'd-1', intent: 'create_bill', source: 'rules', confidence: 0.5,
    bill: { items, total, paid: total, udhaar: 0 },
    unresolved: [], warnings: [], replyText: ['ok'], clarification, ...extra,
  };
}

const items = (f: FollowUp) => (f.kind === 'answer' ? f.parsed.items.map((i) => [i.name, i.quantity, i.unit]) : f.kind);

const askQuantity: Clarification = { slot: 'quantity', itemIndex: 1, attempts: 1, fallback: false, transcript: 'ek kilo cheeni aur thoda aata' };
/** "ek kilo cheeni aur thoda aata": aata is on the bill at a placeholder quantity. */
const withAata = (c: Clarification = askQuantity) => {
  const d = context(c);
  const bill = d.bill!;
  const aata = line('p_aata', 'Aata', 1, 45);
  return { ...d, bill: { ...bill, items: [...bill.items, aata], total: bill.total + 45, paid: bill.total + 45 } };
};
const askMissing: Clarification = { slot: 'item', quantity: 2, unit: 'kg', attempts: 1, fallback: false, transcript: 'ek kilo cheeni aur do kilo add kardo' };
const askUnknown: Clarification = { slot: 'item', spoken: 'kesar', attempts: 1, fallback: false, transcript: 'ek kilo cheeni aur kesar' };
const withKesar = (c: Clarification = askUnknown) =>
  context(c, { unresolved: [{ kind: 'item', spoken: 'kesar', quantity: 1, candidates: [] }] });

describe('a follow-up is read as the answer to the open question first', () => {
  it('quantity: "ek kilo" after "aata kitna chahiye?" fills the amount and keeps the rest of the bill', () => {
    expect(items(answerFollowUp(withAata(), 'ek kilo', index))).toEqual([['Cheeni', 1, 'kg'], ['Aata', 1, 'kg']]);
    expect(items(answerFollowUp(withAata(), 'dedh kilo', index))).toEqual([['Cheeni', 1, 'kg'], ['Aata', 1.5, 'kg']]);
    expect(items(answerFollowUp(withAata(), 'aata do kilo', index))).toEqual([['Cheeni', 1, 'kg'], ['Aata', 2, 'kg']]);
  });

  it('the filled item no longer carries the unclear flag', () => {
    const f = answerFollowUp(withAata(), 'paav kilo', index);
    expect(f.kind === 'answer' && f.parsed.items.every((i) => i.quantityUnclear === undefined)).toBe(true);
  });

  it('item: a name after "do kilo kya?" gets the amount that was already heard', () => {
    expect(items(answerFollowUp(context(askMissing), 'aata', index))).toEqual([['Cheeni', 1, 'kg'], ['aata', 2, 'kg']]);
    // A number in the answer wins over the one heard before.
    expect(items(answerFollowUp(context(askMissing), 'teen kilo aata', index))).toEqual([['Cheeni', 1, 'kg'], ['aata', 3, 'kg']]);
  });

  it('item: an unknown name is replaced by the one named in the answer', () => {
    expect(items(answerFollowUp(withKesar(), 'jeera', index))).toEqual([['Cheeni', 1, 'kg'], ['jeera', 1, null]]);
  });

  it('item: "hatao" or a bare "nahi" drops the item being asked about, not the bill', () => {
    expect(items(answerFollowUp(withKesar(), 'kesar hatao', index))).toEqual([['Cheeni', 1, 'kg']]);
    expect(items(answerFollowUp(withKesar(), 'rehne do', index))).toEqual([['Cheeni', 1, 'kg']]);
    expect(items(answerFollowUp(context(askMissing), 'nahi', index))).toEqual([['Cheeni', 1, 'kg']]);
  });

  it('customer: a name picks between the two that matched', () => {
    const ask: Clarification = { slot: 'customer', spoken: 'Ramesh', attempts: 1, fallback: false, transcript: 'Ramesh ko ek kilo cheeni' };
    const ctx = context(ask, { unresolved: [{ kind: 'customer', spoken: 'Ramesh', candidates: [] }] });
    const f = answerFollowUp(ctx, 'Gupta ji', index);
    expect(f.kind === 'answer' && f.parsed.customer).toBe('Ramesh Gupta');
  });

  it('keeps the original words for a combined second parse', () => {
    const f = answerFollowUp(context(askMissing), 'aata', index);
    expect(f.kind === 'answer' && f.transcript).toBe('ek kilo cheeni aur do kilo add kardo · aata');
  });
});

describe('a correction mid-way', () => {
  it('"nahi, do kilo" sets the amount being asked about', () => {
    expect(items(answerFollowUp(withAata(), 'nahi, do kilo', index))).toEqual([['Cheeni', 1, 'kg'], ['Aata', 2, 'kg']]);
  });
});

describe('cancel', () => {
  it.each(['cancel', 'cancel karo', 'bill cancel kar do'])('"%s" cancels the whole draft', (t) => {
    expect(answerFollowUp(withKesar(), t, index).kind).toBe('cancel');
  });
});

describe('something that is clearly not an answer', () => {
  it.each([
    ['a balance question', 'Ramesh Sharma ka kitna udhaar hai'],
    ['a payment', 'Suresh Verma ne do sau rupaye diye'],
    ['a new bill', 'naya bill do kilo chawal'],
    ['a bill for someone else', 'Ramesh Gupta ko do kilo aata'],
  ])('%s is handled as a new command', (_, t) => {
    expect(answerFollowUp(withAata(), t, index).kind).toBe('command');
  });

  it('a premature "haan" repeats the question instead of saving or refusing', () => {
    const f = answerFollowUp(withAata(), 'haan', index);
    expect(f).toEqual({ kind: 'missed', transcript: askQuantity.transcript });
  });

  it('a full phrase for a different item during a quantity question is a new command', () => {
    expect(answerFollowUp(withAata(), 'do kilo chawal', index).kind).toBe('command');
  });

  it('noise or an unrelated word is a miss, so the question is asked again (not a new bill)', () => {
    expect(answerFollowUp(withAata(), 'pata nahi yaar', index).kind).toBe('missed');
    expect(answerFollowUp(withKesar(), '', index).kind).toBe('missed');
  });
});

describe('nextClarification: one question at a time, at most two spoken attempts', () => {
  const base = { transcript: 'ek kilo cheeni aur thoda aata', unclearQuantity: [1], unresolved: [], missing: [] };

  it('asks about a missing item before an unknown one, before a vague amount', () => {
    expect(nextClarification({ ...base, missing: [{ quantity: 2, unit: 'kg' }], unresolved: [{ kind: 'item', spoken: 'kesar', candidates: [] }] }))
      .toMatchObject({ slot: 'item', quantity: 2, unit: 'kg', attempts: 1, fallback: false });
    expect(nextClarification({ ...base, unresolved: [{ kind: 'item', spoken: 'kesar', candidates: [] }] }))
      .toMatchObject({ slot: 'item', spoken: 'kesar' });
    expect(nextClarification(base)).toMatchObject({ slot: 'quantity', itemIndex: 1 });
    expect(nextClarification({ ...base, unclearQuantity: [] })).toBeUndefined();
  });

  it('counts a second question about the same slot, then falls back to taps', () => {
    const first = nextClarification(base)!;
    const second = nextClarification({ ...base, previous: first })!;
    expect(second).toMatchObject({ attempts: 2, fallback: false });
    const third = nextClarification({ ...base, previous: second })!;
    expect(third).toMatchObject({ attempts: 2, fallback: true });
    expect(nextClarification({ ...base, previous: third })).toMatchObject({ attempts: 2, fallback: true });
  });

  it('an unknown name answered with another unknown name counts as the same question', () => {
    const first = nextClarification({ ...base, unclearQuantity: [], unresolved: [{ kind: 'item', spoken: 'kesar', candidates: [] }] })!;
    const again = nextClarification({ ...base, unclearQuantity: [], unresolved: [{ kind: 'item', spoken: 'kesariya', candidates: [] }], previous: first })!;
    expect(again).toMatchObject({ spoken: 'kesariya', attempts: 2, fallback: false });
  });

  it('repeatClarification bumps the attempt, then falls back', () => {
    const once = repeatClarification(askQuantity, 'a');
    expect(once).toMatchObject({ attempts: 2, fallback: false, transcript: 'a' });
    expect(repeatClarification(once, 'b')).toMatchObject({ attempts: 2, fallback: true });
  });

  it('starts again at one for a different slot', () => {
    const first = nextClarification(base)!;
    const other = nextClarification({ ...base, unclearQuantity: [], unresolved: [{ kind: 'item', spoken: 'kesar', candidates: [] }], previous: first })!;
    expect(other).toMatchObject({ slot: 'item', attempts: 1 });
  });

  it('keeps everything said for the bill, clipped to the transcript limit', () => {
    const next = nextClarification({ ...base, transcript: `${'x'.repeat(400)} · ${'y'.repeat(400)}` })!;
    expect(next.transcript.length).toBeLessThanOrEqual(500);
    expect(next.transcript.startsWith('x')).toBe(true);
  });
});

describe('udhaar with nobody named', () => {
  const ask: Clarification = { slot: 'customer', attempts: 1, fallback: false, transcript: 'do kilo cheeni udhaar' };
  const ctx = () => context(ask, { bill: { items: [line('p_cheeni', 'Cheeni', 2, 48)], total: 96, paid: 0, udhaar: 96 } });

  it('asks whose udhaar it is when a credit bill has no customer', () => {
    expect(nextClarification({ transcript: 'x', missing: [], unresolved: [], unclearQuantity: [], needsCustomer: true })).toMatchObject({ slot: 'customer', attempts: 1 });
    expect(nextClarification({ transcript: 'x', missing: [], unresolved: [], unclearQuantity: [] })).toBeUndefined();
  });

  it('a known name answers it, and the udhaar stays', () => {
    const f = answerFollowUp(ctx(), 'Sharma ji', index);
    expect(f.kind === 'answer' && [f.parsed.customer, f.parsed.amount_paid]).toEqual(['Ramesh Sharma', 0]);
  });

  it('a new name is taken as a new customer', () => {
    const f = answerFollowUp(ctx(), 'Mohan Lal', index);
    expect(f.kind === 'answer' && f.parsed.customer).toBe('Mohan Lal');
  });

  it('a number is not a name', () => {
    expect(answerFollowUp(ctx(), 'do sau', index).kind).toBe('missed');
  });
});
