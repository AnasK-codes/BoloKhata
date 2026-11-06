import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import { draftSchema, type ParsedUtterance } from '@bolbill/shared';
import type { LlmAdapter, LlmResult, StructuredRequest } from '../parse/llm/types';
import { WsTestClient, sleep, type Msg } from '../testing/client';
import { captureLogs, startGateway, type Harness } from '../testing/harness';

/**
 * The full turn pipeline on the mock Gnani servers with a scripted client and a stub language
 * model. No real Gnani or model call is possible here.
 */
const HELLO = {
  type: 'hello',
  v: 2,
  clientTime: 0,
  lang: 'hi-IN',
  catalog: {
    version: 1,
    products: [
      { id: 'p1', name: 'Aata', aliases: ['atta'], unit: 'kg', pricePerUnit: 45 },
      { id: 'p2', name: 'Cheeni', aliases: ['sugar'], unit: 'kg', pricePerUnit: 50 },
    ],
    customers: [
      { id: 'c1', name: 'Sharma ji', aliases: [], balance: 120 },
      { id: 'c2', name: 'Ramesh Sharma', aliases: [], balance: 0 },
      { id: 'c3', name: 'Ramesh Gupta', aliases: [], balance: 0 },
    ],
  },
};

let gateway: Harness | undefined;
let mock: MockGnani | undefined;

beforeEach(async () => {
  mock = await startMockGnani();
});
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  await mock?.close();
  mock = undefined;
});

const env = () => ({ GNANI_STT_URL: mock!.stt.url, GNANI_TTS_URL: mock!.tts.url });

/** A language model the test controls. Records every call and the signal it was given. */
function stubLlm(respond: (r: StructuredRequest<unknown>) => LlmResult<unknown> | Promise<LlmResult<unknown>>) {
  const calls: StructuredRequest<unknown>[] = [];
  const adapter: LlmAdapter = {
    name: 'bedrock',
    async generateStructured<T>(request: StructuredRequest<T>) {
      calls.push(request as StructuredRequest<unknown>);
      return (await respond(request as StructuredRequest<unknown>)) as LlmResult<T>;
    },
  };
  return { adapter, calls };
}
const never = () => stubLlm(() => ({ ok: false, reason: 'not_configured', ms: 0 }));
const answer = (p: Partial<ParsedUtterance>): LlmResult<unknown> => ({
  ok: true,
  ms: 5,
  value: {
    intent: 'create_bill',
    customer: 'Sharma ji',
    items: [{ name: 'aata', quantity: 2, unit: 'kg' }],
    amount_paid: null,
    udhaar_amount: null,
    confidence: 0.9,
    ...p,
  },
});

async function press(client: WsTestClient, turnId: number, frames = 8): Promise<void> {
  client.sendJson({ type: 'ptt_start', turnId });
  for (let i = 0; i < frames; i++) client.sendBinary(speechFrame());
  client.sendJson({ type: 'ptt_end', turnId });
}

/** Says `text` and waits for the spoken reply to finish. Returns the draft. */
async function say(client: WsTestClient, turnId: number, text: string): Promise<Msg> {
  mock!.stt.queueTranscripts(text);
  await press(client, turnId);
  const draft = await client.next('draft');
  await client.next('tts_end');
  return draft;
}

const types = (client: WsTestClient, turnId?: number) =>
  client.messages.filter((m) => turnId === undefined || m['turnId'] === turnId).map((m) => m['type']);
const framesOf = (client: WsTestClient, turnId: number) =>
  client.binary.filter((b) => b.readUInt32BE(1) === turnId).length;

describe('a full turn on the rules path', () => {
  it('sends transcript, draft, tts_start, audio, tts_end and timing in that order, without any model call', async () => {
    const llm = never();
    mock!.stt.queueTranscripts('Sharma ji ko do kilo aata');
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);

    await press(client, 1);
    const draft = await client.next('draft');
    await client.next('tts_end');
    await client.next('timing');

    expect(draft).toMatchObject({
      turnId: 1,
      intent: 'create_bill',
      source: 'rules',
      customer: { id: 'c1', isNew: false },
      bill: { total: 90, paid: 90, udhaar: 0 },
    });
    expect(llm.calls).toHaveLength(0);

    const order = types(client, 1);
    const at = (t: string) => order.indexOf(t);
    expect(at('transcript')).toBeGreaterThanOrEqual(0);
    expect(at('transcript')).toBeLessThan(at('draft'));
    expect(at('draft')).toBeLessThan(at('tts_start'));
    expect(at('tts_start')).toBeLessThan(order.lastIndexOf('tts_end'));
    expect(order.lastIndexOf('tts_end')).toBeLessThan(order.lastIndexOf('timing'));
    expect(client.binary.length).toBeGreaterThan(0);

    const timing = client.messages.filter((m) => m['type'] === 'timing').at(-1) as {
      spans: Record<string, number>;
      parseSource: string;
    };
    expect(timing.parseSource).toBe('rules');
    expect(Object.keys(timing.spans)).toEqual(
      expect.arrayContaining(['release', 'transcript', 'rules_done', 'draft', 'tts_request', 'tts_first_chunk']),
    );
    expect(Object.keys(timing.spans)).not.toContain('llm_done');
  });

  it('speaks the readback as Hindi number words, once, and does not wait for the client to confirm', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    await say(client, 1, 'Sharma ji ko do kilo aata');
    // The client sent nothing after releasing the button, and the reply still played in full.
    const spoken = mock!.tts.requests.map((r) => r.text).join(' ');
    expect(spoken).toContain('nabbe rupaye');
    expect(spoken).not.toMatch(/\d/);
    expect(mock!.tts.requests.length).toBeLessThanOrEqual(2);
    expect(client.messages.filter((m) => m['type'] === 'tts_start')).toHaveLength(1);
  });

  it('handles all six intents, with confirm and cancel acting on the pending draft', async () => {
    const llm = never();
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);

    const bill = await say(client, 1, 'Sharma ji ko do kilo aata');
    expect(bill['intent']).toBe('create_bill');

    const confirm = await say(client, 2, 'haan');
    expect(confirm).toMatchObject({ intent: 'confirm', draftId: bill['draftId'], source: 'rules' });
    expect((confirm['replyText'] as string[])[0]).toMatch(/save|likh/i);

    const second = await say(client, 3, 'Sharma ji ko ek kilo cheeni');
    const cancel = await say(client, 4, 'nahi');
    expect(cancel).toMatchObject({ intent: 'cancel', draftId: second['draftId'] });

    const payment = await say(client, 5, 'Sharma ji ne sau rupaye de diye');
    expect(payment).toMatchObject({ intent: 'record_payment', payment: { amount: 100 }, customer: { id: 'c1' } });

    const balance = await say(client, 6, 'Sharma ji ka kitna udhaar hai');
    expect(balance).toMatchObject({ intent: 'query_balance', balance: { balance: 120 } });

    const unknown = await say(client, 7, 'kuch bhi');
    expect(unknown['intent']).toBe('unknown');
    expect(llm.calls.length).toBeLessThanOrEqual(1); // only the unclear sentence may reach a model
  }, 30_000);

  it('yes with nothing pending changes nothing', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    const draft = await say(client, 1, 'haan');
    expect(draft['intent']).toBe('unknown');
  });

  it('a new bill replaces the pending one', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    await say(client, 1, 'Sharma ji ko do kilo aata');
    const second = await say(client, 2, 'Sharma ji ko ek kilo cheeni');
    const confirm = await say(client, 3, 'haan');
    expect(confirm['draftId']).toBe(second['draftId']);
  }, 20_000);

  it('does not confirm a bill with an unknown item or an ambiguous customer', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    const unknownItem = await say(client, 1, 'Sharma ji ko do kilo laptop');
    expect(unknownItem['unresolved']).toMatchObject([{ kind: 'item' }]);
    expect((await say(client, 2, 'haan'))['intent']).toBe('unknown');

    const ambiguous = await say(client, 3, 'Ramesh ko do kilo aata');
    expect((ambiguous['unresolved'] as { kind: string }[]).some((u) => u.kind === 'customer')).toBe(true);
    expect((await say(client, 4, 'haan'))['intent']).toBe('unknown');
  }, 30_000);

  it('runs two turns back to back with no state leaking between them', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    const a = await say(client, 1, 'Sharma ji ko do kilo aata');
    const b = await say(client, 2, 'Sharma ji ko ek kilo cheeni');
    expect(a).toMatchObject({ turnId: 1, bill: { total: 90 } });
    expect(b).toMatchObject({ turnId: 2, bill: { total: 50 } });
    expect(a['draftId']).not.toBe(b['draftId']);
    expect(types(client, 1).filter((t) => t === 'draft')).toHaveLength(1);
  }, 20_000);
});

describe('the language model path', () => {
  const MESSY = 'Sharma ji ko woh jo lal wala packet hai do dena';

  it('is used once for an unclear sentence, then the draft is priced in code and spoken once', async () => {
    const llm = stubLlm(() => answer({}));
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    const draft = await say(client, 1, MESSY);

    expect(llm.calls).toHaveLength(1);
    expect(draft).toMatchObject({ source: 'llm', bill: { total: 90 } });
    expect(client.messages.filter((m) => m['type'] === 'draft')).toHaveLength(1);
    expect(client.messages.filter((m) => m['type'] === 'tts_start')).toHaveLength(1);
    const timing = client.messages.filter((m) => m['type'] === 'timing').at(-1) as {
      spans: Record<string, number>;
      parseSource: string;
    };
    expect(timing.parseSource).toBe('llm');
    expect(Object.keys(timing.spans)).toEqual(expect.arrayContaining(['rules_done', 'llm_done']));
  });

  it('falls back to the rules result with a review flag and LLM_TIMEOUT when the model is too slow', async () => {
    const llm = stubLlm(() => ({ ok: false, reason: 'timeout', ms: 1200 }));
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    mock!.stt.queueTranscripts(MESSY);
    await press(client, 1);
    const draft = await client.next('draft');
    const error = await client.next('error');
    await client.next('tts_end');
    expect(draft['source']).toBe('rules');
    expect(draft['warnings']).toContain('Please check this draft before saving.');
    expect(error).toMatchObject({ code: 'LLM_TIMEOUT', turnId: 1 });
    expect(client.binary.length).toBeGreaterThan(0); // the reply was still spoken
  });

  it('an interrupt during the model call cancels it and nothing more is sent for the turn', async () => {
    let seen: AbortSignal | undefined;
    const llm = stubLlm(
      (r) =>
        new Promise<LlmResult<unknown>>((resolve) => {
          seen = r.signal;
          r.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted', ms: 1 }));
        }),
    );
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    mock!.stt.queueTranscripts(MESSY);
    await press(client, 1);
    await client.next('transcript');
    while (llm.calls.length === 0) await sleep(10);
    client.sendJson({ type: 'interrupt', turnId: 1 });
    await client.next('timing');
    await sleep(200);
    expect(seen?.aborted).toBe(true);
    expect(types(client, 1)).not.toContain('draft');
    expect(types(client, 1)).not.toContain('tts_start');
    expect(client.binary).toHaveLength(0);
  });

  it('a new press during the model call drops the old turn even if the model ignores its signal', async () => {
    let first = true;
    const llm = stubLlm(async () => {
      if (!first) return answer({});
      first = false;
      await sleep(400); // slow, and deaf to the abort signal
      return answer({ items: [{ name: 'cheeni', quantity: 9, unit: 'kg' }] });
    });
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    mock!.stt.queueTranscripts(MESSY);
    await press(client, 1);
    await client.next('transcript');
    while (llm.calls.length === 0) await sleep(10);

    mock!.stt.queueTranscripts('Sharma ji ko do kilo aata');
    await press(client, 2);
    const draft = await client.next('draft');
    await client.next('tts_end');
    await sleep(500);

    expect(draft).toMatchObject({ turnId: 2 });
    expect(client.messages.filter((m) => m['type'] === 'draft')).toHaveLength(1);
    expect(types(client, 1)).not.toContain('draft');
    expect(framesOf(client, 1)).toBe(0);
  }, 20_000);
});

describe('interrupts and new presses while speaking', () => {
  it('an interrupt stops the reply and no late audio reaches the client', async () => {
    await mock!.close();
    mock = await startMockGnani({ tts: { chunkBytes: 2400, interChunkDelayMs: 25 } });
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    mock.stt.queueTranscripts('Sharma ji ko do kilo aata aur ek kilo cheeni');
    await press(client, 1);
    await client.next('draft');
    await client.waitBinary(2);
    client.sendJson({ type: 'interrupt', turnId: 1 });
    expect(await client.next('tts_end')).toMatchObject({ turnId: 1, interrupted: true });
    const n = client.binary.length;
    await sleep(300);
    expect(client.binary.length).toBe(n);
    expect(client.messages.filter((m) => m['type'] === 'tts_start')).toHaveLength(1); // no second sentence
  });

  it('a new press while speaking silences it and answers the new turn', async () => {
    await mock!.close();
    mock = await startMockGnani({ tts: { chunkBytes: 2400, interChunkDelayMs: 25 } });
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    mock.stt.queueTranscripts('Sharma ji ko do kilo aata aur ek kilo cheeni', 'Sharma ji ka kitna udhaar hai');
    await press(client, 1);
    await client.next('draft');
    await client.waitBinary(2);
    await press(client, 2);
    expect(await client.next('tts_end')).toMatchObject({ turnId: 1, interrupted: true });
    const draft = await client.next('draft');
    expect(draft).toMatchObject({ turnId: 2, intent: 'query_balance' });
    const n = framesOf(client, 1);
    await client.next('tts_end');
    await sleep(200);
    expect(framesOf(client, 1)).toBe(n);
  }, 20_000);
});

describe('failures at each stage', () => {
  it('an empty transcript: NO_TRANSCRIPT, no draft, no model call, no speech', async () => {
    const llm = stubLlm(() => answer({}));
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    mock!.stt.queueTranscripts('');
    await press(client, 1);
    expect(await client.next('error')).toMatchObject({ code: 'NO_TRANSCRIPT', turnId: 1 });
    await sleep(150);
    expect(client.has('draft')).toBe(false);
    expect(llm.calls).toHaveLength(0);
    expect(mock!.tts.requests).toHaveLength(0);
  });

  it('a speech recognition error is reported and the next turn still works', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    client.sendJson({ type: 'ptt_start', turnId: 1 });
    for (let i = 0; i < 4; i++) client.sendBinary(speechFrame());
    await sleep(120);
    mock!.stt.sendError('boom');
    expect((await client.next('error'))['code']).toMatch(/STT_/);
    client.sendJson({ type: 'interrupt', turnId: 1 });
    await sleep(100);
    mock!.stt.queueTranscripts('Sharma ji ka kitna udhaar hai');
    await press(client, 2);
    expect(await client.next('draft')).toMatchObject({ turnId: 2, intent: 'query_balance' });
    expect(types(client, 1)).not.toContain('draft');
  }, 20_000);

  it('when speech synthesis fails the draft is still delivered, then TTS_UNAVAILABLE', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    mock!.tts.failNextRequest('boom');
    mock!.stt.queueTranscripts('Sharma ji ko do kilo aata');
    await press(client, 1);
    const draft = await client.next('draft');
    const error = await client.next('error');
    expect(draft).toMatchObject({ turnId: 1, bill: { total: 90 } });
    expect(error).toMatchObject({ code: 'TTS_UNAVAILABLE', turnId: 1 });
  });

  it('a client that leaves mid-turn cancels the model call and frees the session', async () => {
    let seen: AbortSignal | undefined;
    const llm = stubLlm(
      (r) =>
        new Promise<LlmResult<unknown>>((resolve) => {
          seen = r.signal;
          r.signal?.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted', ms: 1 }));
        }),
    );
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    mock!.stt.queueTranscripts('Sharma ji ko woh jo lal wala packet hai do dena');
    await press(client, 1);
    await client.next('transcript');
    while (llm.calls.length === 0) await sleep(10);
    client.close();
    await sleep(250);
    expect(seen?.aborted).toBe(true);
    expect(gateway.app.gateway.sessions.size).toBe(0);
  });
});

describe('privacy', () => {
  it('never writes the transcript or reply text to the logs during a full turn', async () => {
    const logs = captureLogs();
    gateway = await startGateway({ ...env(), LOG_LEVEL: 'debug' }, { logStream: logs.stream, llm: never().adapter });
    const client = await gateway.ready(HELLO);
    await say(client, 1, 'Sharma ji ko do kilo SECRETITEM');
    await say(client, 2, 'Sharma ji ka kitna udhaar hai');
    await gateway.close();
    gateway = undefined;
    const text = logs.text();
    expect(text).not.toContain('SECRETITEM');
    expect(text).not.toContain('Sharma');
    expect(text).not.toContain('udhaar');
  }, 20_000);
});

describe('voice corrections with the browser draft context', () => {
  it('creates an uncatalogued quoted-price bill and preserves its rate during correction', async () => {
    const llm = never();
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready({ ...HELLO, catalog: { version: 1, products: [], customers: [] } });
    const first = draftSchema.parse(await say(client, 1, 'Do kilo chawal ₹110 ke, do Maggi ke packets ₹28 ke'));
    expect(first.bill).toMatchObject({ total: 138, paid: 138, udhaar: 0 });
    expect(first.bill?.items).toHaveLength(2);
    mock!.stt.queueTranscripts('Chawal teen kilo karo');
    client.sendJson({ type: 'ptt_start', turnId: 2, draftContext: first });
    for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
    client.sendJson({ type: 'ptt_end', turnId: 2 });
    const corrected = draftSchema.parse(await client.next('draft'));
    await client.next('tts_end');
    expect(corrected.draftId).toBe(first.draftId);
    expect(corrected.bill).toMatchObject({ total: 193, paid: 193, udhaar: 0 });
    expect(corrected.bill?.items[0]).toMatchObject({ quantity: 3, lineTotal: 165 });
    expect(llm.calls).toHaveLength(0);
    expect((await say(client, 3, 'haan'))).toMatchObject({ intent: 'confirm', draftId: first.draftId });
  }, 15_000);
  it('updates the same draft, reprices from the catalog, then confirms its id', async () => {
    const llm = never();
    gateway = await startGateway(env(), { llm: llm.adapter });
    const client = await gateway.ready(HELLO);
    const first = draftSchema.parse(await say(client, 1, 'Sharma ji ko do kilo aata'));
    const context = { ...first, bill: { ...first.bill!, items: first.bill!.items.map((i) => ({ ...i, unitPrice: 1, lineTotal: 1 })), total: 1 } };
    mock!.stt.queueTranscripts('Aata do nahi teen kilo karo');
    client.sendJson({ type: 'ptt_start', turnId: 2, draftContext: context });
    for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
    client.sendJson({ type: 'ptt_end', turnId: 2 });
    const corrected = draftSchema.parse(await client.next('draft'));
    await client.next('tts_end');
    expect(corrected).toMatchObject({ draftId: first.draftId, turnId: 2, source: 'rules', bill: { total: 135, paid: 135, udhaar: 0 } });
    expect(corrected.bill?.items[0]).toMatchObject({ quantity: 3, unitPrice: 45, lineTotal: 135 });
    expect(llm.calls).toHaveLength(0);
    const confirmation = await say(client, 3, 'haan');
    expect(confirmation).toMatchObject({ intent: 'confirm', draftId: first.draftId });
  }, 15_000); // Three complete mock audio replies use real timers, including under parallel test load.

  it('an explicit null context clears a previously saved bill', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    await say(client, 1, 'Sharma ji ko do kilo aata');
    mock!.stt.queueTranscripts('haan');
    client.sendJson({ type: 'ptt_start', turnId: 2, draftContext: null });
    for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
    client.sendJson({ type: 'ptt_end', turnId: 2 });
    expect(await client.next('draft')).toMatchObject({ intent: 'unknown' });
    await client.next('tts_end');
  });

  it('a draft the browser cannot save is not confirmed by "haan" (payment from an unknown customer)', async () => {
    gateway = await startGateway(env(), { llm: never().adapter });
    const client = await gateway.ready(HELLO);
    const first = draftSchema.parse(await say(client, 1, 'Kapoor ji ne do sau de diye'));
    expect(first).toMatchObject({ intent: 'record_payment' });
    expect(first.customer?.id).toBeUndefined();
    mock!.stt.queueTranscripts('haan');
    client.sendJson({ type: 'ptt_start', turnId: 2, draftContext: first });
    for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
    client.sendJson({ type: 'ptt_end', turnId: 2 });
    expect(await client.next('draft')).toMatchObject({ intent: 'unknown' });
    await client.next('tts_end');
  });
});
