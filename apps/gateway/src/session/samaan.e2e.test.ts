import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import type { LlmAdapter } from '../parse/llm/types';
import type { Msg, WsTestClient } from '../testing/client';
import { startGateway, type Harness } from '../testing/harness';

/** Adding items to Samaan by voice, with quantity and rate, on the mock Gnani servers. */
const HELLO = {
  type: 'hello',
  v: 2,
  clientTime: 0,
  lang: 'hi-IN',
  catalog: {
    version: 1,
    products: [
      { id: 'p1', name: 'Aata', aliases: ['atta'], unit: 'kg', pricePerUnit: 45 },
      { id: 'p2', name: 'Cheeni', aliases: ['chini'], unit: 'kg', pricePerUnit: 50 },
    ],
    customers: [{ id: 'c1', name: 'Sharma ji', aliases: [], balance: 120 }],
  },
};
const noModel: LlmAdapter = { name: 'bedrock', generateStructured: () => Promise.resolve({ ok: false, reason: 'not_configured', ms: 0 }) };

let gateway: Harness | undefined;
let mock: MockGnani | undefined;
beforeEach(async () => {
  mock = await startMockGnani();
  gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url }, { llm: noModel });
});
afterEach(async () => {
  await gateway?.close();
  await mock?.close();
  gateway = undefined;
  mock = undefined;
});

async function say(client: WsTestClient, turnId: number, text: string, draftContext?: Msg | null): Promise<Msg> {
  mock!.stt.queueTranscripts(text);
  client.sendJson({ type: 'ptt_start', turnId, ...(draftContext !== undefined ? { draftContext } : {}) });
  for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
  client.sendJson({ type: 'ptt_end', turnId });
  const draft = await client.next('draft');
  await client.next('tts_end');
  return draft;
}
const rows = (d: Msg) => ((d['products'] as { name: string; stock?: number; unit: string; pricePerUnit: number }[] | undefined) ?? []).map((p) => [p.name, p.stock ?? null, p.unit, p.pricePerUnit]);

describe('Samaan by voice', () => {
  it('"naya item samaan mai jodo ..." keeps the quantity and the rate, and a spoken haan confirms it', async () => {
    const client = await gateway!.ready(HELLO);
    const d = await say(client, 1, 'naya item samaan mai jodo rajma 5 kilo 120 rupaye kilo');
    expect(d).toMatchObject({ intent: 'add_product', product: { name: 'Rajma', stock: 5, unit: 'kg', pricePerUnit: 120, isNew: true } });
    expect(await say(client, 2, 'haan', d)).toMatchObject({ intent: 'confirm', draftId: d['draftId'] });
  }, 30_000);

  it('several items, each with its own quantity and rate, wait for one haan', async () => {
    const client = await gateway!.ready(HELLO);
    const d = await say(client, 1, 'samaan mein jodo maida 20 kilo 35 rupaye kilo aur besan 10 kilo 80 rupaye kilo');
    expect(d['intent']).toBe('add_products');
    expect(rows(d)).toEqual([['Maida', 20, 'kg', 35], ['Besan', 10, 'kg', 80]]);
    expect(await say(client, 2, 'haan', d)).toMatchObject({ intent: 'confirm', draftId: d['draftId'] });
  }, 30_000);

  it('an item without a rate keeps the others, asks only for the rate, and finishes on the answer', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'samaan mein jodo maida 20 kilo 35 rupaye kilo aur sooji 10 kilo');
    expect(rows(first)).toEqual([['Maida', 20, 'kg', 35]]);
    expect(first['clarification']).toMatchObject({ slot: 'rate', spoken: 'Sooji', quantity: 10, unit: 'kg' });
    // A "haan" now must not save a half-finished list.
    const early = await say(client, 2, 'haan', first);
    expect(early['intent']).not.toBe('confirm');
    expect(early['clarification']).toMatchObject({ slot: 'rate', attempts: 2 });

    const done = await say(client, 3, 'bis rupaye kilo', early);
    expect(done['draftId']).toBe(first['draftId']);
    expect(done['clarification']).toBeUndefined();
    expect(rows(done)).toEqual([['Maida', 20, 'kg', 35], ['Sooji', 10, 'kg', 20]]);
    expect(await say(client, 4, 'haan', done)).toMatchObject({ intent: 'confirm' });
  }, 40_000);

  it('a name alone asks for the rate, and the answer completes it (no more "bolo phir se")', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'samaan mein rajma add karo');
    expect(first['clarification']).toMatchObject({ slot: 'rate', spoken: 'Rajma' });
    const done = await say(client, 2, '120 rupaye kilo', first);
    expect(rows(done)).toEqual([['Rajma', null, 'kg', 120]]);
    expect(done['warnings'] as string[]).toEqual([expect.stringMatching(/stock/i)]);
  }, 30_000);

  it('stops asking for the rate by voice after two attempts', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'samaan mein rajma add karo');
    const second = await say(client, 2, 'pata nahi', first);
    expect(second['clarification']).toMatchObject({ attempts: 2, fallback: false });
    const third = await say(client, 3, 'pata nahi', second);
    expect(third['clarification']).toMatchObject({ attempts: 2, fallback: true });
    expect(third['replyText']).toHaveLength(1);
  }, 40_000);

  it('cancel and other commands work while the rate is open', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'samaan mein rajma add karo');
    const balance = await say(client, 2, 'Sharma ji ka kitna udhaar hai', first);
    expect(balance['intent']).toBe('query_balance');
    expect(await say(client, 3, 'cancel karo', first)).toMatchObject({ intent: 'cancel', draftId: first['draftId'] });
  }, 40_000);

  it('a rate for an item that exists is shown as already there, not asked for', async () => {
    const client = await gateway!.ready(HELLO);
    const d = await say(client, 1, 'samaan mein aata add karo');
    expect(d['clarification']).toBeUndefined();
    expect((d['replyText'] as string[]).join(' ')).toContain('pehle se');
  }, 30_000);
});

describe('change a rate by voice', () => {
  it.each([
    ['aata ka rate 50 karo', 50],
    ['aata ka rate badal ke 52 kar do', 52],
    ['aata ka daam 48 rupaye kilo ho gaya', 48],
  ])('%s', async (text, price) => {
    const client = await gateway!.ready(HELLO);
    const d = await say(client, 1, text);
    expect(d).toMatchObject({ intent: 'update_price', product: { id: 'p1', name: 'Aata', pricePerUnit: price, previousPrice: 45 } });
    expect(await say(client, 2, 'haan', d)).toMatchObject({ intent: 'confirm', draftId: d['draftId'] });
  }, 30_000);
});

describe('khate mein jodo means the whole bill is unpaid', () => {
  it('"khate main jodo do kilo aata" is all udhaar, and asks whose', async () => {
    const client = await gateway!.ready(HELLO);
    const d = await say(client, 1, 'khate main jodo do kilo aata');
    expect(d).toMatchObject({ intent: 'create_bill', bill: { total: 90, paid: 0, udhaar: 90 } });
    expect(d['clarification']).toMatchObject({ slot: 'customer' });
    const named = await say(client, 2, 'Sharma ji', d);
    expect(named).toMatchObject({ draftId: d['draftId'], customer: { id: 'c1' }, bill: { paid: 0, udhaar: 90 } });
    expect(named['clarification']).toBeUndefined();
  }, 30_000);

  it('"Sharma ji ke khate main jodo do kilo cheeni" goes on his khata with nothing paid', async () => {
    const client = await gateway!.ready(HELLO);
    const d = await say(client, 1, 'Sharma ji ke khate main jodo do kilo cheeni');
    expect(d).toMatchObject({ intent: 'create_bill', customer: { id: 'c1' }, bill: { total: 100, paid: 0, udhaar: 100 } });
  }, 30_000);
});
