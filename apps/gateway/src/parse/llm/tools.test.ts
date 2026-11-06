import { describe, expect, it, vi } from 'vitest';
import { ConverseCommand, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { BedrockLlm, type ConverseClient } from './bedrock';
import { NoLlm } from './none';
import { OpenAiCompatibleLlm } from './openaiCompatible';
import type { ToolRequest } from './types';

const TOOLS: ToolRequest['tools'] = [
  { name: 'record_payment', description: 'paid', parameters: { type: 'object', properties: { amount: { type: 'integer' } }, required: ['amount'] }, schema: z.object({ amount: z.number().int() }) },
  { name: 'say', description: 'talk', parameters: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] }, schema: z.object({ reply: z.string() }) },
];
const REQUEST: ToolRequest = { system: 'sys', userBlock: 'user', tools: TOOLS, timeoutMs: 500 };

const completion = (toolCalls: unknown[] | undefined) =>
  new Response(JSON.stringify({ choices: [{ message: { content: null, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }] }), { status: 200 });
const fn = (name: string, args: unknown) => ({ id: 'c1', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

describe('OpenAiCompatibleLlm.callTool', () => {
  const make = (fetchImpl: typeof fetch) => new OpenAiCompatibleLlm({ baseUrl: 'https://llm.test/v1/', model: 'm', apiKey: 'k', reasoningEffort: 'low', fetch: fetchImpl });

  it('sends the tools with tool_choice required, and returns the validated call', async () => {
    const fetchMock = vi.fn(async () => completion([fn('record_payment', { amount: 200 })]));
    const r = await make(fetchMock as unknown as typeof fetch).callTool(REQUEST);
    expect(r).toMatchObject({ ok: true, value: { name: 'record_payment', args: { amount: 200 } } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'm', temperature: 0, tool_choice: 'required', reasoning_effort: 'low' });
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(['record_payment', 'say']);
    expect(body.tools[0]).toMatchObject({ type: 'function', function: { parameters: TOOLS[0]?.parameters } });
    expect(body).not.toHaveProperty('response_format');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k' });
  });

  it.each([
    ['no tool call (plain text)', () => completion(undefined)],
    ['a tool that was not offered', () => completion([fn('delete_all', {})])],
    ['arguments that are not JSON', () => completion([fn('say', 'not json')])],
    ['arguments that fail the schema', () => completion([fn('record_payment', { amount: 'lots' })])],
    ['no choices', () => new Response(JSON.stringify({ choices: [] }), { status: 200 })],
  ])('invalid output: %s', async (_n, respond) => {
    const r = await make((async () => respond()) as typeof fetch).callTool(REQUEST);
    expect(r).toMatchObject({ ok: false, reason: 'invalid_output' });
  });

  it('maps an HTTP 429 to unavailable (so the circuit breaker can see a rate limit)', async () => {
    const r = await make((async () => new Response('x', { status: 429 })) as typeof fetch).callTool(REQUEST);
    expect(r).toMatchObject({ ok: false, reason: 'unavailable', detail: 'HttpError429' });
  });

  it('times out a hanging server', async () => {
    const hang = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    expect(await make(hang).callTool({ ...REQUEST, timeoutMs: 40 })).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('BedrockLlm.callTool', () => {
  const output = (content: unknown[]): ConverseCommandOutput => ({ output: { message: { role: 'assistant', content } }, $metadata: {} }) as ConverseCommandOutput;
  const fake = (result: ConverseCommandOutput) => {
    const send = vi.fn((_c: ConverseCommand, _o: { abortSignal: AbortSignal }) => Promise.resolve(result));
    return { client: { send } satisfies ConverseClient, send };
  };
  const make = (client: ConverseClient) => new BedrockLlm({ region: 'ap-south-1', modelId: 'model-x', client });

  it('offers every tool with toolChoice any and returns the validated call', async () => {
    const { client, send } = fake(output([{ toolUse: { toolUseId: '1', name: 'say', input: { reply: 'Ji.' } } }]));
    expect(await make(client).callTool(REQUEST)).toMatchObject({ ok: true, value: { name: 'say', args: { reply: 'Ji.' } } });
    const input = (send.mock.calls[0]?.[0] as ConverseCommand).input;
    expect(input.toolConfig?.toolChoice).toEqual({ any: {} });
    expect(input.toolConfig?.tools?.map((t) => t.toolSpec?.name)).toEqual(['record_payment', 'say']);
  });

  it('rejects text-only answers, unknown tools and bad arguments', async () => {
    for (const content of [[{ text: 'hello' }], [{ toolUse: { toolUseId: '1', name: 'nope', input: {} } }], [{ toolUse: { toolUseId: '1', name: 'record_payment', input: { amount: 'x' } } }]]) {
      expect(await make(fake(output(content)).client).callTool(REQUEST)).toMatchObject({ ok: false, reason: 'invalid_output' });
    }
  });
});

describe('NoLlm.callTool', () => {
  it('is not configured and never touches the network', async () => {
    expect(await new NoLlm().callTool()).toMatchObject({ ok: false, reason: 'not_configured' });
  });
});
