import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import type { LlmAdapter, LlmResult, ToolCall, ToolRequest } from '../parse/llm/types';
import type { Msg, WsTestClient } from '../testing/client';
import { startGateway, type Harness } from '../testing/harness';

/**
 * Two misses in a row hand the conversation to the AI. Mock Gnani servers and a scripted model:
 * no real call can happen here.
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
    ],
    customers: [{ id: 'c1', name: 'Sharma ji', aliases: [], balance: 120 }],
  },
};

function model(respond: (r: ToolRequest) => LlmResult<ToolCall>) {
  const calls: ToolRequest[] = [];
  const adapter: LlmAdapter = {
    name: 'openai-compatible',
    generateStructured: () => Promise.resolve({ ok: false, reason: 'unavailable', ms: 1 }),
    callTool: (request) => {
      calls.push(request);
      return Promise.resolve(respond(request));
    },
  };
  return { adapter, calls };
}
const tool = (name: string, args: unknown): LlmResult<ToolCall> => ({ ok: true, value: { name, args }, ms: 5 });

let gateway: Harness | undefined;
let mock: MockGnani | undefined;
beforeEach(async () => { mock = await startMockGnani(); });
afterEach(async () => {
  await gateway?.close();
  await mock?.close();
  gateway = undefined;
  mock = undefined;
});
const start = async (llm: LlmAdapter) => {
  gateway = await startGateway({ GNANI_STT_URL: mock!.stt.url, GNANI_TTS_URL: mock!.tts.url }, { llm });
  return gateway.ready(HELLO);
};

async function say(client: WsTestClient, turnId: number, text: string, draftContext?: Msg | null): Promise<Msg> {
  mock!.stt.queueTranscripts(text);
  client.sendJson({ type: 'ptt_start', turnId, ...(draftContext !== undefined ? { draftContext } : {}) });
  for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
  client.sendJson({ type: 'ptt_end', turnId });
  const draft = await client.next('draft');
  await client.next('tts_end');
  return draft;
}
const reply = (d: Msg) => (d['replyText'] as string[]).join(' ');

describe('the AI steps in after two misses', () => {
  it('first miss: the usual answer, no model call. Second miss: the model gets the conversation and its answer is spoken', async () => {
    const m = model(() => tool('say', { reply: 'Aap shayad cheeni ki baat kar rahe hain. Kitna chahiye?' }));
    const client = await start(m.adapter);
    const first = await say(client, 1, 'wo wala dena bhai');
    expect(first['intent']).toBe('unknown');
    expect(m.calls).toHaveLength(0);

    const second = await say(client, 2, 'arre wahi jo kal liya tha');
    expect(m.calls).toHaveLength(1);
    expect(reply(second)).toBe('Aap shayad cheeni ki baat kar rahe hain. Kitna chahiye?');
    const sent = m.calls[0]!.userBlock;
    expect(sent).toContain('wo wala dena bhai'); // the earlier sentence
    expect(sent).toContain('arre wahi jo kal liya tha'); // the one to handle
    expect(sent).toContain('<history>');
  }, 40_000);

  it('the AI can perform the task: a bill, priced from the catalog and still waiting for haan', async () => {
    const m = model(() => tool('create_bill', { customer: 'Sharma ji', items: [{ name: 'aata', quantity: 3, unit: 'kg' }], reply: '{customer} ko {total} ka bill. Theek hai?' }));
    const client = await start(m.adapter);
    await say(client, 1, 'wo wala dena bhai');
    const rescued = await say(client, 2, 'arre wahi jo kal liya tha');
    expect(rescued).toMatchObject({ intent: 'create_bill', source: 'llm', customer: { id: 'c1' }, bill: { total: 135 } });
    const yes = await say(client, 3, 'haan', rescued);
    expect(yes).toMatchObject({ intent: 'confirm', draftId: rescued['draftId'] });
  }, 40_000);

  it('an understood sentence in between resets the count', async () => {
    const m = model(() => tool('say', { reply: 'Kya chahiye?' }));
    const client = await start(m.adapter);
    await say(client, 1, 'wo wala dena bhai');
    await say(client, 2, 'do kilo aata');
    await say(client, 3, 'arre wahi jo kal liya tha');
    expect(m.calls).toHaveLength(0);
  }, 40_000);

  it('after the AI has helped, the count starts again from zero', async () => {
    const m = model(() => tool('say', { reply: 'Kya chahiye?' }));
    const client = await start(m.adapter);
    await say(client, 1, 'wo wala dena bhai');
    await say(client, 2, 'arre wahi jo kal liya tha');
    expect(m.calls).toHaveLength(1);
    await say(client, 3, 'bhai suno na');
    expect(m.calls).toHaveLength(1);
    await say(client, 4, 'kuch bhi');
    expect(m.calls).toHaveLength(2);
  }, 60_000);

  it('keeps the usual answer when there is no model, or the model fails', async () => {
    const none: LlmAdapter = { name: 'none', generateStructured: () => Promise.resolve({ ok: false, reason: 'not_configured', ms: 0 }) };
    const client = await start(none);
    await say(client, 1, 'wo wala dena bhai');
    expect((await say(client, 2, 'arre wahi jo kal liya tha'))['intent']).toBe('unknown');
  }, 40_000);

  it('the history includes answers as well as questions, so a later sentence can refer back', async () => {
    const m = model(() => tool('say', { reply: 'Theek hai.' }));
    const client = await start(m.adapter);
    await say(client, 1, 'do kilo aata');
    await say(client, 2, 'wo wala dena bhai');
    await say(client, 3, 'arre wahi jo kal liya tha');
    const block = m.calls[0]!.userBlock;
    expect(block).toContain('shopkeeper: do kilo aata');
    expect(block).toMatch(/assistant: .*(Bill|Total).*rupaye/); // what the app said back, in words
  }, 60_000);
});
