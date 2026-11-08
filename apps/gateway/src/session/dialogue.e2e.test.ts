import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import type { LlmAdapter } from '../parse/llm/types';
import type { WsTestClient, Msg } from '../testing/client';
import { startGateway, type Harness } from '../testing/harness';

/**
 * The "keeps asking and forgets" loop, end to end on the mock Gnani servers (no credits, no model).
 * Before the fix, an answer to a question was parsed alone as a new bill, so what was said first
 * was lost and the same question came back forever.
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
      { id: 'p2', name: 'Cheeni', aliases: ['chini'], unit: 'kg', pricePerUnit: 50 },
      { id: 'p3', name: 'Jeera', aliases: [], unit: 'kg', pricePerUnit: 400 },
    ],
    customers: [{ id: 'c1', name: 'Sharma ji', aliases: [], balance: 0 }],
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

/** One press, as the browser does it: the draft on screen goes along with ptt_start. */
async function say(client: WsTestClient, turnId: number, text: string, draftContext?: Msg | null): Promise<Msg> {
  mock!.stt.queueTranscripts(text);
  client.sendJson({ type: 'ptt_start', turnId, ...(draftContext !== undefined ? { draftContext } : {}) });
  for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
  client.sendJson({ type: 'ptt_end', turnId });
  const draft = await client.next('draft');
  await client.next('tts_end');
  return draft;
}

const lines = (d: Msg) => ((d['bill'] as { items: { name: string; quantity: number }[] } | undefined)?.items ?? []).map((i) => [i.name, i.quantity]);

describe('a partly understood bill', () => {
  it('asks only for the missing item, keeps the first item, and finishes on the answer', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'ek kilo cheeni aur do kilo add kardo');
    expect(lines(first)).toEqual([['Cheeni', 1]]);
    expect(first['clarification']).toMatchObject({ slot: 'item', quantity: 2, unit: 'kg', attempts: 1 });
    expect(first['replyText']).toEqual(['do kilo kya chahiye?', 'Samaan ka naam boliye.']);

    const second = await say(client, 2, 'aata', first);
    expect(second['draftId']).toBe(first['draftId']);
    expect(lines(second)).toEqual([['Cheeni', 1], ['Aata', 2]]);
    expect(second['clarification']).toBeUndefined();
    expect((second['bill'] as { total: number }).total).toBe(140);

    const yes = await say(client, 3, 'haan', second);
    expect(yes).toMatchObject({ intent: 'confirm', draftId: first['draftId'] });
  }, 30_000);

  it('a vague amount is asked for, and "nahi, do kilo" corrects it', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'ek kilo cheeni aur thoda aata');
    expect(first['clarification']).toMatchObject({ slot: 'quantity', itemIndex: 1 });
    expect((first['replyText'] as string[])[0]).toBe('Aata kitna chahiye?');
    const second = await say(client, 2, 'nahi, do kilo', first);
    expect(lines(second)).toEqual([['Cheeni', 1], ['Aata', 2]]);
    expect(second['clarification']).toBeUndefined();
  }, 30_000);

  it('stops asking by voice after two attempts and offers taps instead', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'ek kilo cheeni aur kesar');
    expect(first['clarification']).toMatchObject({ slot: 'item', spoken: 'kesar', attempts: 1, fallback: false });
    const second = await say(client, 2, 'kesar', first);
    expect(second['clarification']).toMatchObject({ attempts: 2, fallback: false });
    expect(lines(second)).toEqual([['Cheeni', 1]]);
    const third = await say(client, 3, 'pata nahi yaar', second);
    expect(third['clarification']).toMatchObject({ attempts: 2, fallback: true });
    expect(third['replyText']).toHaveLength(1);
    expect((third['replyText'] as string[])[0]).not.toMatch(/\?/);
    expect(lines(third)).toEqual([['Cheeni', 1]]);
  }, 30_000);

  it('"cancel" during a question cancels the draft', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'ek kilo cheeni aur kesar');
    const cancel = await say(client, 2, 'cancel karo', first);
    expect(cancel).toMatchObject({ intent: 'cancel', draftId: first['draftId'] });
  }, 30_000);

  it('an unrelated question is answered without losing the bill on the next press', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'ek kilo cheeni aur kesar');
    const balance = await say(client, 2, 'Sharma ji ka kitna udhaar hai', first);
    expect(balance['intent']).toBe('query_balance');
    // The browser keeps showing (and sending) the bill draft, so the answer still lands on it.
    const answer = await say(client, 3, 'jeera', first);
    expect(lines(answer)).toEqual([['Cheeni', 1], ['Jeera', 1]]);
  }, 30_000);

  it('survives a reconnect mid-question: the browser sends the draft to the new session', async () => {
    const client = await gateway!.ready(HELLO);
    const first = await say(client, 1, 'ek kilo cheeni aur do kilo add kardo');
    client.close();
    const again = await gateway!.ready(HELLO);
    const answer = await say(again, 1, 'aata', first);
    expect(lines(answer)).toEqual([['Cheeni', 1], ['Aata', 2]]);
  }, 30_000);
});
