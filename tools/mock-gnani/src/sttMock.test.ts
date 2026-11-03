import { afterEach, describe, expect, it } from 'vitest';
import { silenceFrame, speechFrame } from './audio';
import { startMockStt, type MockSttOptions, type MockSttServer, type SttViolation } from './sttMock';
import { TestClient, sleep } from './testClient';

const KEY = { 'x-api-key-id': 'test-key' };
const V3 = { ...KEY, model: 'prisma-v3.0', language_code: 'hi-IN,en-IN' };

let server: MockSttServer | undefined;
const clients: TestClient[] = [];

function current(): MockSttServer {
  if (server === undefined) throw new Error('call setup() first');
  return server;
}

async function setup(options: MockSttOptions = {}) {
  // Tests send frames faster than real time on purpose, so the cadence check is relaxed
  // unless a test is specifically about cadence.
  server = await startMockStt({ frameToleranceMs: 60_000, ...options });
  return server;
}

async function connect(headers: Record<string, string> = V3) {
  const client = await TestClient.connect(current().url, headers);
  clients.push(client);
  return client;
}

function sendFrames(client: TestClient, count: number, kind: 'speech' | 'silence') {
  const frame = kind === 'speech' ? speechFrame() : silenceFrame();
  for (let i = 0; i < count; i++) client.sendBinary(frame);
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server?.close();
  server = undefined;
});

describe('mock STT: handshake', () => {
  it('refuses a missing API key with HTTP 401', async () => {
    await setup();
    await expect(TestClient.connect(current().url, { language_code: 'hi-IN' })).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('refuses a wrong API key when one is required', async () => {
    await setup({ validApiKey: 'right' });
    await expect(TestClient.connect(current().url, { 'x-api-key-id': 'wrong' })).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('answers 404 on an unknown path', async () => {
    await setup();
    const url = current().url.replace('/stt/v3/stream', '/nope');
    await expect(TestClient.connect(url, V3)).rejects.toThrow('HTTP 404');
  });

  it('sends `connected` with v3.0 details and never records the API key', async () => {
    await setup();
    const client = await connect({ ...V3, format: 'codemix' });
    const connected = await client.next('connected');
    expect(connected['request_id']).toEqual(expect.any(String));
    expect(connected['config']).toMatchObject({
      sample_rate: 16000,
      chunk_size: 512,
      language_code: 'hi-IN,en-IN',
      format: 'codemix',
      language_candidates: ['hi-IN', 'en-IN'],
    });
    expect(current().connections[0]?.headers['x-api-key-id']).toBe('[redacted]');
    expect(JSON.stringify(current().connections)).not.toContain('test-key');
  });

  it('falls back to prisma-v2.5 for unknown models, without request_id', async () => {
    await setup();
    const client = await connect({ ...KEY, model: 'prisma-v9', language_code: 'hi-IN' });
    const connected = await client.next('connected');
    expect(connected['request_id']).toBeUndefined();
    expect(current().connections[0]?.model).toBe('prisma-v2.5');
  });

  it('missing language_code sends an error then closes 1008', async () => {
    await setup();
    const client = await connect(KEY);
    const error = await client.next('error');
    expect(error['message']).toEqual(expect.any(String));
    expect((await client.waitClosed()).code).toBe(1008);
  });

  it('allows a missing language_code for v3.0 with format=transliterate', async () => {
    await setup();
    const client = await connect({ ...KEY, model: 'prisma-v3.0', format: 'transliterate' });
    await client.next('connected');
    expect(client.closed).toBeUndefined();
  });

  it('rejects v3-only formats on v2.5 with 1008', async () => {
    await setup();
    const client = await connect({
      ...KEY,
      model: 'prisma-v2.5',
      language_code: 'hi-IN',
      format: 'codemix',
    });
    await client.next('error');
    expect((await client.waitClosed()).code).toBe(1008);
  });

  it('rejects more than four language codes', async () => {
    await setup();
    const client = await connect({ ...V3, language_code: 'hi-IN,en-IN,ta-IN,te-IN,kn-IN' });
    await client.next('error');
    expect((await client.waitClosed()).code).toBe(1008);
  });
});

describe('mock STT: segments', () => {
  it('detects speech, then silence, and returns the scripted transcript with all documented fields', async () => {
    await setup();
    current().queueTranscripts('do kilo aata');
    const client = await connect();
    await client.next('connected');

    sendFrames(client, 10, 'speech');
    sendFrames(client, 17, 'silence'); // 17 x 32 ms >= 500 ms default min silence

    const start = await client.next('speech_start');
    expect(start['utterance_id']).toEqual(expect.any(String));
    expect(start['timestamp']).toBeUndefined(); // docs list no timestamp on speech_start
    await client.next('processing');
    const transcript = await client.next('transcript');
    expect(transcript).toMatchObject({
      text: 'do kilo aata',
      segment_index: 1,
      is_final: true,
      detected_language_code: 'hi-IN',
      audio_duration_ms: expect.any(Number),
      latency: 0,
    });
    expect(transcript['segment_id']).toMatch(/-seg-1$/);
    expect(transcript['utterance_id']).toBe(start['utterance_id']);
  });

  it('commit closes the utterance immediately without waiting for silence', async () => {
    await setup();
    current().queueTranscripts('ek Maggi');
    const client = await connect();
    await client.next('connected');

    sendFrames(client, 10, 'speech');
    client.sendJson({ type: 'commit' });

    await client.next('processing');
    expect((await client.next('transcript'))['text']).toBe('ek Maggi');
    expect(current().connections[0]?.commits).toBe(1);
  });

  it('commit with no speech produces nothing', async () => {
    await setup();
    const client = await connect();
    await client.next('connected');
    sendFrames(client, 5, 'silence');
    client.sendJson({ type: 'commit' });
    await sleep(80);
    expect(client.messages.map((m) => m['type'])).toEqual(['connected']);
  });

  it('keeps one-word answers: a short utterance plus commit still yields a transcript', async () => {
    await setup();
    current().queueTranscripts('haan');
    const client = await connect();
    await client.next('connected');
    sendFrames(client, 5, 'speech'); // 160 ms
    client.sendJson({ type: 'commit' });
    expect((await client.next('transcript'))['text']).toBe('haan');
  });

  it('drops segments shorter than x-min-segment-ms (why that header must stay low)', async () => {
    await setup();
    const client = await connect({ ...V3, 'x-min-segment-ms': '1000' });
    await client.next('connected');
    sendFrames(client, 10, 'speech'); // 320 ms < 1000 ms
    client.sendJson({ type: 'commit' });
    await sleep(80);
    expect(client.messages.some((m) => m['type'] === 'transcript')).toBe(false);
    expect(current().connections[0]?.droppedSegments).toBe(1);
  });

  it('numbers segments per session and keeps the socket reusable', async () => {
    await setup();
    current().queueTranscripts('pehla', 'doosra');
    const client = await connect();
    await client.next('connected');

    sendFrames(client, 8, 'speech');
    client.sendJson({ type: 'commit' });
    const first = await client.next('transcript');
    sendFrames(client, 8, 'speech');
    client.sendJson({ type: 'commit' });
    const second = await client.next('transcript');

    expect([first['segment_index'], second['segment_index']]).toEqual([1, 2]);
    expect([first['text'], second['text']]).toEqual(['pehla', 'doosra']);
    expect(current().connections[0]?.segments).toHaveLength(2);
  });

  it('uses the default transcript function when the queue is empty', async () => {
    await setup({ defaultTranscript: (ctx) => `segment ${ctx.segmentIndex}` });
    const client = await connect();
    await client.next('connected');
    sendFrames(client, 8, 'speech');
    client.sendJson({ type: 'commit' });
    expect((await client.next('transcript'))['text']).toBe('segment 1');
  });

  it('applies the configured artificial latency and reports it', async () => {
    await setup({ transcriptLatencyMs: 120 });
    const client = await connect();
    await client.next('connected');
    sendFrames(client, 8, 'speech');
    client.sendJson({ type: 'commit' });

    await client.next('processing');
    const processingAt = Date.now();
    const transcript = await client.next('transcript');
    expect(Date.now() - processingAt).toBeGreaterThanOrEqual(100);
    expect(transcript['latency']).toBe(120);
  });

  it('v2.5 transcripts carry no utterance_id or detected_language_code', async () => {
    await setup();
    const client = await connect({ ...KEY, model: 'prisma-v2.5', language_code: 'hi-IN' });
    await client.next('connected');
    sendFrames(client, 8, 'speech');
    client.sendJson({ type: 'commit' });
    const transcript = await client.next('transcript');
    expect(transcript['utterance_id']).toBeUndefined();
    expect(transcript['detected_language_code']).toBeUndefined();
  });
});

describe('mock STT: frame contract', () => {
  it('records frames that are not exactly 1,024 bytes and does not count them', async () => {
    await setup();
    const seen: SttViolation[] = [];
    current().onViolation((v) => seen.push(v));
    const client = await connect();
    await client.next('connected');

    client.sendBinary(new Uint8Array(1023));
    client.sendBinary(new Uint8Array(2048));
    client.sendBinary(speechFrame());
    await sleep(80);

    const record = current().connections[0];
    expect(record?.frames).toBe(1);
    expect(record?.violations.map((v) => (v.kind === 'wrong_size' ? v.size : -1))).toEqual([
      1023, 2048,
    ]);
    expect(seen).toHaveLength(2);
  });

  it('flags frames that arrive faster than real time beyond the tolerance', async () => {
    await setup({ frameToleranceMs: 150 });
    const client = await connect();
    await client.next('connected');

    sendFrames(client, 30, 'silence'); // a 960 ms burst, delivered in microseconds
    await sleep(100);

    const violations = current().connections[0]?.violations ?? [];
    expect(violations.filter((v) => v.kind === 'too_fast').length).toBeGreaterThan(10);
  });

  it('accepts a small pre-roll burst inside the tolerance', async () => {
    await setup({ frameToleranceMs: 300 });
    const client = await connect();
    await client.next('connected');
    sendFrames(client, 5, 'silence'); // about 160 ms
    await sleep(100);
    expect(current().connections[0]?.violations).toEqual([]);
  });

  it('accepts frames paced at 32 ms', async () => {
    await setup({ frameToleranceMs: 150 });
    const client = await connect();
    await client.next('connected');
    for (let i = 0; i < 12; i++) {
      client.sendBinary(silenceFrame());
      await sleep(32);
    }
    expect(current().connections[0]?.violations).toEqual([]);
    expect(current().connections[0]?.frames).toBe(12);
  });
});

describe('mock STT: session limits and failures', () => {
  it('enforces the concurrent session cap with an error then close 1001', async () => {
    await setup({ maxSessions: 1 });
    const first = await connect();
    await first.next('connected');

    const second = await connect();
    const error = await second.next('error');
    expect(String(error['message'])).toContain('limit');
    expect((await second.waitClosed()).code).toBe(1001);
    expect(first.closed).toBeUndefined();
  });

  it('frees the slot when a session ends', async () => {
    await setup({ maxSessions: 1 });
    const first = await connect();
    await first.next('connected');
    first.close();
    await sleep(60);
    const second = await connect();
    await second.next('connected');
  });

  it('closes an idle session', async () => {
    await setup({ idleTimeoutMs: 100 });
    const client = await connect();
    await client.next('connected');
    const closed = await client.waitClosed();
    expect(closed.reason).toBe('idle timeout');
  });

  it('closes with 1001 when the session cap is exceeded', async () => {
    await setup({ maxSessionMs: 100 });
    const client = await connect();
    await client.next('connected');
    await client.next('error');
    expect((await client.waitClosed()).code).toBe(1001);
  });

  it('sendError pushes an error and leaves the session open', async () => {
    await setup();
    const client = await connect();
    await client.next('connected');
    current().sendError('simulated failure');
    expect((await client.next('error'))['message']).toBe('simulated failure');
    expect(client.closed).toBeUndefined();
  });

  it('dropConnections closes sockets like an upstream outage', async () => {
    await setup();
    const client = await connect();
    await client.next('connected');
    current().dropConnections(1011);
    expect((await client.waitClosed()).code).toBe(1011);
  });
});

describe('mock STT: update_settings', () => {
  it('applies a valid update and confirms with settings_updated', async () => {
    await setup();
    const client = await connect();
    await client.next('connected');
    client.sendJson({
      type: 'update_settings',
      language_code: 'en-IN',
      format: 'transcribe',
      substitution: { enabled: true, map: [] },
      bias: { list: ['Maggi', 'aata'], score: 1.5 },
    });
    const updated = await client.next('settings_updated');
    expect(updated['config']).toMatchObject({
      language_code: 'en-IN',
      format: 'transcribe',
      substitution_enabled: true,
      bias_word_count: 2,
      bias_score: 1.5,
    });
  });

  it('ignores an update that touches VAD settings', async () => {
    await setup();
    const client = await connect();
    await client.next('connected');
    client.sendJson({ type: 'update_settings', language_code: 'en-IN', 'x-min-silence-ms': 900 });
    await sleep(80);
    expect(client.messages.some((m) => m['type'] === 'settings_updated')).toBe(false);
  });

  it('ignores an invalid update as a whole', async () => {
    await setup();
    const client = await connect({ ...KEY, model: 'prisma-v2.5', language_code: 'hi-IN' });
    await client.next('connected');
    client.sendJson({ type: 'update_settings', language_code: 'en-IN', format: 'codemix' });
    await sleep(80);
    expect(client.messages.some((m) => m['type'] === 'settings_updated')).toBe(false);
  });
});
