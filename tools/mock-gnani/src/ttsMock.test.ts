import { afterEach, describe, expect, it } from 'vitest';
import { startMockTts, type MockTtsOptions, type MockTtsServer } from './ttsMock';
import { TestClient, sleep, type Msg } from './testClient';

const KEY = { 'x-api-key-id': 'test-key' };
const RAW_24K = { sample_rate: 24000, container: 'raw', encoding: 'linear_pcm' };

let server: MockTtsServer | undefined;
const clients: TestClient[] = [];

function current(): MockTtsServer {
  if (server === undefined) throw new Error('call setup() first');
  return server;
}

async function setup(options: MockTtsOptions = {}) {
  server = await startMockTts({ firstChunkDelayMs: 5, interChunkDelayMs: 1, ...options });
}

async function connect() {
  const client = await TestClient.connect(current().url, KEY);
  clients.push(client);
  return client;
}

function request(text: string, audioConfig: unknown = RAW_24K): Msg {
  return {
    text,
    model: 'timbre-v2.5',
    voice: 'Nalini',
    language: 'hi-IN',
    ...(audioConfig === null ? {} : { audio_config: audioConfig }),
  };
}

/** Reads `start`, every `audio` chunk and `complete` for one request. */
async function synthesize(client: TestClient, body: Msg) {
  client.sendJson(body);
  const start = await client.next('start');
  const chunks: Buffer[] = [];
  const indexes: number[] = [];
  for (;;) {
    const message = await client.nextAny(['audio', 'complete'], 1000);
    if (message['type'] === 'complete') {
      return { start, chunks, indexes, complete: message };
    }
    const data = message['data'] as { chunk_index: number; audio: string; is_final: boolean };
    expect(data.is_final).toBe(false);
    indexes.push(data.chunk_index);
    chunks.push(Buffer.from(data.audio, 'base64'));
  }
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server?.close();
  server = undefined;
});

describe('mock TTS: handshake', () => {
  it('refuses a missing API key with HTTP 401', async () => {
    await setup();
    await expect(TestClient.connect(current().url, {})).rejects.toThrow('HTTP 401');
  });

  it('refuses a wrong key when one is required', async () => {
    await setup({ validApiKey: 'right' });
    await expect(TestClient.connect(current().url, { 'x-api-key-id': 'wrong' })).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('answers 404 on an unknown path', async () => {
    await setup();
    const url = current().url.replace('/api/v1/tts', '/nope');
    await expect(TestClient.connect(url, KEY)).rejects.toThrow('HTTP 404');
  });
});

describe('mock TTS: streaming', () => {
  it('replies with start, ordered audio chunks, then complete', async () => {
    await setup({ chunkCount: 4 });
    const client = await connect();
    const result = await synthesize(client, request('teen sau rupaye'));

    expect(result.start['request_id']).toEqual(expect.any(String));
    expect(result.indexes).toEqual([1, 2, 3, 4]);
    expect(result.complete['data']).toEqual({ chunk_index: 5, audio: '', is_final: true });

    const types = client.messages.map((m) => m['type']);
    expect(types[0]).toBe('start');
    expect(types.at(-1)).toBe('complete');
    expect(types.filter((t) => t === 'audio')).toHaveLength(4);
  });

  it('makes longer text produce more audio', async () => {
    await setup();
    const client = await connect();
    const short = await synthesize(client, request('haan'));
    const long = await synthesize(client, request('Sharma ji ka bill teen sau bayalis rupaye ka hai'));
    const bytes = (chunks: Buffer[]) => chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(bytes(long.chunks)).toBeGreaterThan(bytes(short.chunks));
  });

  it('raw container streams headerless 16-bit PCM of the expected length', async () => {
    await setup({ msPerChar: 100, minAudioMs: 0 });
    const client = await connect();
    const text = 'x'.repeat(10); // 10 chars x 100 ms = 1 s at 24 kHz mono 16-bit = 48,000 bytes
    const result = await synthesize(client, request(text));
    const total = result.chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(total).toBe(48_000);
    expect(total % 2).toBe(0);
    expect(result.chunks[0]?.toString('ascii', 0, 4)).not.toBe('RIFF');
  });

  it('wav container (the documented default) starts with a RIFF header', async () => {
    await setup({ msPerChar: 100, minAudioMs: 0 });
    const client = await connect();
    const result = await synthesize(client, request('x'.repeat(10), { sample_rate: 24000 }));
    const all = Buffer.concat(result.chunks);
    expect(all.toString('ascii', 0, 4)).toBe('RIFF');
    expect(all.readUInt32LE(24)).toBe(24_000);
    expect(all.readUInt32LE(40)).toBe(48_000);
    expect(all.byteLength).toBe(44 + 48_000);
  });

  it('defaults to 48 kHz wav when audio_config is omitted', async () => {
    await setup();
    const client = await connect();
    await synthesize(client, request('haan', null));
    expect(current().requests[0]).toMatchObject({ sampleRate: 48_000, container: 'wav' });
  });

  it('honours chunkBytes and chunkCount', async () => {
    await setup({ chunkBytes: 1000, msPerChar: 100, minAudioMs: 0 });
    const client = await connect();
    const bySize = await synthesize(client, request('x'.repeat(10)));
    expect(bySize.chunks[0]?.byteLength).toBe(1000);
    expect(bySize.chunks.length).toBe(48);
  });

  it('records the request details', async () => {
    await setup();
    const client = await connect();
    await synthesize(client, {
      ...request('haan'),
      voice: 'Nalini',
      model: 'timbre-v3.0',
      speed: 'fast',
    });
    expect(current().requests[0]).toMatchObject({
      text: 'haan',
      model: 'timbre-v3.0',
      voice: 'Nalini',
      language: 'hi-IN',
      speed: 1.15,
      completed: true,
      aborted: false,
    });
  });
});

describe('mock TTS: request rules', () => {
  it.each([
    ['empty text', { ...request('x'), text: '' }],
    ['unknown model', { ...request('x'), model: 'timbre-v9' }],
    ['missing voice', { ...request('x'), voice: undefined }],
    ['unknown language', { ...request('x'), language: 'xx-XX' }],
    ['speed out of range', { ...request('x'), speed: 2 }],
    ['bad sample rate', request('x', { sample_rate: 12345, container: 'raw' })],
    ['unsupported container', request('x', { container: 'mp3' })],
  ])('rejects %s with an error and stays usable', async (_name, body) => {
    await setup();
    const client = await connect();
    client.sendJson(body);
    const error = await client.next('error');
    expect(error['message']).toEqual(expect.any(String));
    expect(client.closed).toBeUndefined();

    const ok = await synthesize(client, request('haan'));
    expect(ok.chunks.length).toBeGreaterThan(0);
  });

  it('rejects non-JSON input with an error', async () => {
    await setup();
    const client = await connect();
    client.ws.send('this is not json');
    await client.next('error');
  });

  it('rejects a second request while one is streaming (so queue logic is exercised)', async () => {
    await setup({ chunkCount: 6, interChunkDelayMs: 20 });
    const client = await connect();
    client.sendJson(request('pehla request'));
    await client.next('start');
    client.sendJson(request('doosra request'));

    const error = await client.next('error');
    expect(String(error['message'])).toContain('already active');
    await client.next('complete');
    expect(current().rejectedConcurrent).toBe(1);
    expect(current().requests).toHaveLength(1);
  });

  it('accepts sequential requests on one socket', async () => {
    await setup();
    const client = await connect();
    await synthesize(client, request('pehla'));
    await synthesize(client, request('doosra'));
    expect(current().requests.map((r) => r.text)).toEqual(['pehla', 'doosra']);
    expect(current().rejectedConcurrent).toBe(0);
  });

  it('failNextRequest fails exactly one request', async () => {
    await setup();
    const client = await connect();
    current().failNextRequest('boom');
    client.sendJson(request('haan'));
    expect((await client.next('error'))['message']).toBe('boom');
    const ok = await synthesize(client, request('haan'));
    expect(ok.chunks.length).toBeGreaterThan(0);
  });
});

describe('mock TTS: disconnects', () => {
  it('marks the request aborted when the client leaves mid-stream', async () => {
    await setup({ chunkCount: 10, interChunkDelayMs: 30 });
    const client = await connect();
    client.sendJson(request('lamba sa jumla jo beech mein kat jayega'));
    await client.next('audio');
    client.close();
    await sleep(100);
    expect(current().requests[0]).toMatchObject({ completed: false, aborted: true });
  });

  it('dropConnections closes sockets like an upstream outage', async () => {
    await setup();
    const client = await connect();
    current().dropConnections(1011);
    expect((await client.waitClosed()).code).toBe(1011);
  });
});
