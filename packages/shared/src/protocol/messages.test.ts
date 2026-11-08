import { describe, expect, it } from 'vitest';
import { LIMITS, MAX_ANY_MESSAGE_BYTES } from './constants';
import { CLIENT_FIXTURES, SERVER_FIXTURES } from './fixtures';
import { parseClientMessage, parseServerMessage } from './parse';
import { draftSchema, MAX_CLARIFY_ATTEMPTS } from './server';
import { DIALECTS } from './common';

const enc = (value: unknown) => JSON.stringify(value);

describe('draft context on push-to-talk', () => {
  it('accepts a validated draft or explicit null and enforces the larger size limit', () => {
    const draft = draftSchema.parse(SERVER_FIXTURES.draft.valid);
    expect(parseClientMessage(enc({ type: 'ptt_start', turnId: 2, draftContext: draft })).ok).toBe(true);
    expect(parseClientMessage(enc({ type: 'ptt_start', turnId: 2, draftContext: null })).ok).toBe(true);
    expect(parseClientMessage(enc({ type: 'ptt_start', turnId: 2, draftContext: { ...draft, confidence: 5 } })).ok).toBe(false);
    expect(parseClientMessage(enc({ type: 'ptt_start', turnId: 2, pad: 'x'.repeat(34 * 1024) }))).toMatchObject({ ok: false, reason: 'too_large' });
  });
});

describe.each(Object.entries(CLIENT_FIXTURES))('client message %s', (type, fixture) => {
  it('round-trips a valid message', () => {
    const result = parseClientMessage(enc(fixture.valid));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(fixture.valid);
  });

  it('rejects a malformed message without echoing its content', () => {
    const result = parseClientMessage(enc(fixture.invalid));
    expect(result).toEqual({ ok: false, reason: 'invalid_shape', messageType: type });
  });

  it('matches its snapshot', () => {
    const result = parseClientMessage(enc(fixture.valid));
    expect(result).toMatchSnapshot();
  });

  it('is not accepted as a server message', () => {
    expect(parseServerMessage(enc(fixture.valid)).ok).toBe(false);
  });
});

describe.each(Object.entries(SERVER_FIXTURES))('server message %s', (type, fixture) => {
  it('round-trips a valid message', () => {
    const result = parseServerMessage(enc(fixture.valid));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(fixture.valid);
  });

  it('rejects a malformed message', () => {
    const result = parseServerMessage(enc(fixture.invalid));
    expect(result).toEqual({ ok: false, reason: 'invalid_shape', messageType: type });
  });

  it('matches its snapshot', () => {
    expect(parseServerMessage(enc(fixture.valid))).toMatchSnapshot();
  });

  it('is not accepted as a client message', () => {
    expect(parseClientMessage(enc(fixture.valid)).ok).toBe(false);
  });
});

describe('malformed and hostile input', () => {
  it.each([
    ['not json', 'this is {not json'],
    ['empty string', ''],
    ['json null', 'null'],
    ['json array', '[1,2,3]'],
    ['json number', '42'],
    ['binary instead of text', new Uint8Array(4)],
    ['undefined', undefined],
  ])('returns invalid_json for %s', (_name, raw) => {
    expect(parseClientMessage(raw)).toEqual({ ok: false, reason: 'invalid_json' });
    expect(parseServerMessage(raw)).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('ignores unknown message types', () => {
    expect(parseClientMessage(enc({ type: 'launch_missiles' }))).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
    expect(parseClientMessage(enc({ turnId: 1 }))).toEqual({ ok: false, reason: 'unknown_type' });
    expect(parseClientMessage(enc({ type: 7 }))).toEqual({ ok: false, reason: 'unknown_type' });
  });

  it('does not treat prototype keys as message types', () => {
    expect(parseClientMessage(enc({ type: 'constructor' }))).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
    expect(parseClientMessage(enc({ type: '__proto__' }))).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
  });

  it('rejects anything above the global ceiling before parsing it', () => {
    const huge = enc({ type: 'ping', t: 1, pad: 'x'.repeat(MAX_ANY_MESSAGE_BYTES) });
    expect(parseClientMessage(huge)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('enforces the per-type size limit', () => {
    const padded = enc({ type: 'ptt_end', turnId: 1, pad: 'x'.repeat(1000) });
    expect(parseClientMessage(padded)).toEqual({
      ok: false,
      reason: 'too_large',
      messageType: 'ptt_end',
    });
  });

  it('counts bytes, not characters, for the size limit', () => {
    // 100 three-byte characters = 300 bytes, over the 256 byte cap for ptt_end.
    const padded = enc({ type: 'ptt_end', turnId: 1, pad: 'न'.repeat(100) });
    expect(padded.length).toBeLessThan(256);
    expect(parseClientMessage(padded)).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('rejects over-long speak text and control characters', () => {
    const long = enc({ type: 'speak', turnId: 1, text: 'a'.repeat(LIMITS.maxSpeakTextLength + 1) });
    expect(parseClientMessage(long)).toMatchObject({ ok: false, reason: 'invalid_shape' });

    const control = enc({ type: 'speak', turnId: 1, text: 'hello\u0007world' });
    expect(parseClientMessage(control)).toMatchObject({ ok: false, reason: 'invalid_shape' });
  });

  it('accepts Devanagari speak text', () => {
    const msg = enc({ type: 'speak', turnId: 1, text: 'बिल सेव हो गया' });
    expect(parseClientMessage(msg).ok).toBe(true);
  });

  it('caps the catalog size', () => {
    const product = { id: 'p', name: 'X', aliases: [], unit: 'kg', pricePerUnit: 1 };
    const msg = enc({
      type: 'hello',
      v: 2,
      clientTime: 0,
      lang: 'hi-en',
      catalog: {
        version: 1,
        products: Array.from({ length: LIMITS.maxProducts + 1 }, () => product),
        customers: [],
      },
    });
    expect(parseClientMessage(msg)).toMatchObject({ ok: false });
  });

  it('rejects a wrong protocol version in hello', () => {
    const hello = { ...(CLIENT_FIXTURES.hello.valid as object), v: 1 };
    expect(parseClientMessage(enc(hello))).toMatchObject({ ok: false, reason: 'invalid_shape' });
  });

  it('never puts user text in a failure result', () => {
    const secret = 'PRIVATE_CUSTOMER_NAME\u0007';
    const result = parseClientMessage(enc({ type: 'speak', turnId: 1, text: secret }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CUSTOMER_NAME');
  });

  it('keeps money as integers and rejects negative amounts', () => {
    const draft = SERVER_FIXTURES.draft.valid as { bill: { total: number } };
    const negative = { ...draft, bill: { ...draft.bill, total: -1 } };
    expect(parseServerMessage(enc(negative)).ok).toBe(false);
  });

  it('allows at most two reply sentences', () => {
    const draft = SERVER_FIXTURES.draft.valid as object;
    const three = { ...draft, replyText: ['Ek.', 'Do.', 'Teen.'] };
    expect(parseServerMessage(enc(three)).ok).toBe(false);
    const none = { ...draft, replyText: [] };
    expect(parseServerMessage(enc(none)).ok).toBe(false);
  });

  it('allows an empty transcript but not an oversized one', () => {
    const empty = enc({ type: 'transcript', turnId: 1, text: '' });
    expect(parseServerMessage(empty).ok).toBe(true);
    const big = enc({ type: 'transcript', turnId: 1, text: 'a'.repeat(LIMITS.maxTranscriptLength + 1) });
    expect(parseServerMessage(big).ok).toBe(false);
  });

  it('allows a customer balance to be negative (overpayment)', () => {
    const msg = CLIENT_FIXTURES.context_update.valid;
    expect(parseClientMessage(enc(msg)).ok).toBe(true);
  });
});

describe('clarification on a draft', () => {
  const draft = draftSchema.parse(SERVER_FIXTURES.draft.valid);
  const ask = { slot: 'item', spoken: 'kesar', quantity: 1, unit: 'kg', attempts: 1, fallback: false, transcript: 'ek kilo cheeni aur kesar' };

  it('accepts an open question and round-trips it through ptt_start', () => {
    const withAsk = { ...draft, clarification: ask };
    expect(parseServerMessage(enc(withAsk)).ok).toBe(true);
    const back = parseClientMessage(enc({ type: 'ptt_start', turnId: 3, draftContext: withAsk }));
    expect(back.ok && back.value.type === 'ptt_start' && back.value.draftContext?.clarification).toEqual(ask);
  });

  it('accepts a quantity question about one bill line', () => {
    const q = { slot: 'quantity', itemIndex: 0, attempts: 2, fallback: true, transcript: 'thoda aata' };
    expect(parseServerMessage(enc({ ...draft, clarification: q })).ok).toBe(true);
  });

  it('rejects an unknown slot, zero or too many attempts, and an over-long transcript', () => {
    for (const bad of [
      { ...ask, slot: 'price' },
      { ...ask, attempts: 0 },
      { ...ask, attempts: MAX_CLARIFY_ATTEMPTS + 1 },
      { ...ask, transcript: 'x'.repeat(LIMITS.maxTranscriptLength + 1) },
      { ...ask, itemIndex: LIMITS.maxBillItems },
    ]) {
      expect(parseServerMessage(enc({ ...draft, clarification: bad })).ok).toBe(false);
    }
  });
});

describe('dialect hint', () => {
  const hello = CLIENT_FIXTURES.hello.valid as Record<string, unknown>;
  it.each(DIALECTS)('accepts %s on hello and context_update', (dialect) => {
    expect(parseClientMessage(enc({ ...hello, dialect })).ok).toBe(true);
    expect(parseClientMessage(enc({ type: 'context_update', catalog: { version: 1 }, dialect })).ok).toBe(true);
  });
  it('rejects a dialect we do not know', () => {
    expect(parseClientMessage(enc({ ...hello, dialect: 'klingon' })).ok).toBe(false);
  });
  it('keeps the field optional for older clients', () => {
    expect(parseClientMessage(enc(hello)).ok).toBe(true);
  });
});
