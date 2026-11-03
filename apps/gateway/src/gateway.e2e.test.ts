import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import { DailyCreditGuard } from './guard/creditGuard';
import { WsTestClient, sleep } from './testing/client';
import { HELLO, startGateway, type Harness } from './testing/harness';

/**
 * End to end with a scripted client (no UI): browser protocol on one side, the mock Gnani
 * servers on the other. Nothing here touches the real Gnani API.
 */
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

const upstreamEnv = () => ({
  GNANI_STT_URL: mock!.stt.url,
  GNANI_TTS_URL: mock!.tts.url,
});

async function talk(client: WsTestClient, turnId: number, frames = 8): Promise<void> {
  client.sendJson({ type: 'ptt_start', turnId });
  const frame = speechFrame();
  for (let i = 0; i < frames; i++) client.sendBinary(frame);
  client.sendJson({ type: 'ptt_end', turnId });
}

describe('speech to transcript through the gateway', () => {
  it('streams frames, commits on release and returns the transcript with timing', async () => {
    mock!.stt.queueTranscripts('do kilo cheeni Sharma ji ko udhaar');
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();

    await talk(client, 1);
    const transcript = await client.next('transcript');
    expect(transcript).toMatchObject({ turnId: 1, text: 'do kilo cheeni Sharma ji ko udhaar' });
    expect(await client.next('timing')).toMatchObject({ turnId: 1 });
    const timing = client.messages.find((m) => m['type'] === 'timing') as {
      spans: Record<string, number>;
    };
    expect(Object.keys(timing.spans)).toEqual(
      expect.arrayContaining(['release', 'commit_sent', 'transcript']),
    );

    const connection = mock!.stt.connections[0]!;
    expect(connection.frames).toBe(8);
    expect(connection.violations).toEqual([]);
    expect(connection.commits).toBe(1);
    expect(client.has('speech_start')).toBe(true);
    expect(client.has('processing')).toBe(true);
  });

  it('pre-warms the Gnani connection as soon as hello arrives', async () => {
    gateway = await startGateway(upstreamEnv());
    await gateway.ready();
    await sleep(100);
    expect(mock!.stt.connections).toHaveLength(1);
    const keyterms = mock!.stt.connections[0]!.headers['keyterms'] ?? '';
    expect(keyterms).toContain('Aata');
    expect(keyterms).toContain('Sharma ji');
  });

  it('handles two turns back to back on one connection', async () => {
    mock!.stt.queueTranscripts('pehla', 'doosra');
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();
    await talk(client, 1);
    expect(await client.next('transcript')).toMatchObject({ turnId: 1, text: 'pehla' });
    await talk(client, 2);
    expect(await client.next('transcript')).toMatchObject({ turnId: 2, text: 'doosra' });
    expect(mock!.stt.connections).toHaveLength(1);
  });

  it('tells the client when speech recognition is down, with the turn id', async () => {
    gateway = await startGateway({
      ...upstreamEnv(),
      GNANI_STT_URL: 'ws://127.0.0.1:1/stt/v3/stream', // nothing listens here
    });
    const client = await gateway.ready();
    client.sendJson({ type: 'ptt_start', turnId: 5 });
    const error = await client.next('error', 12_000);
    expect(error).toMatchObject({ code: 'STT_UNAVAILABLE', turnId: 5, retryable: true });
  }, 15_000);

  it('refuses new turns with a limit message when the STT budget is gone', async () => {
    const guard = new DailyCreditGuard({ stt_seconds: 5, tts_chars: 1000 });
    gateway = await startGateway(upstreamEnv(), { guard });
    const client = await gateway.connect();
    client.sendJson(HELLO);
    await client.next('ready');
    client.sendJson({ type: 'ptt_start', turnId: 1 }); // reserves 30 s > the 5 s cap
    const limit = await client.next('limit');
    expect(limit).toMatchObject({ reason: 'budget' });
    expect(typeof limit['resetAt']).toBe('string');
    client.sendBinary(speechFrame());
    await sleep(100);
    expect(mock!.stt.connections[0]?.frames ?? 0).toBe(0);
  });

  it('records the audio really streamed against the credit guard', async () => {
    mock!.stt.queueTranscripts('hisaab');
    const guard = new DailyCreditGuard({ stt_seconds: 1000, tts_chars: 1000 });
    gateway = await startGateway(upstreamEnv(), { guard });
    const client = await gateway.ready();
    await talk(client, 1, 10);
    await client.next('transcript');
    await sleep(50);
    expect(guard.usage().stt_seconds).toBeCloseTo(0.32, 2); // 10 frames x 32 ms, not the 30 s reserved
  });

  it('never writes the transcript to the logs', async () => {
    mock!.stt.queueTranscripts('SECRET_TRANSCRIPT_WORDS');
    const { captureLogs } = await import('./testing/harness');
    const logs = captureLogs();
    gateway = await startGateway({ ...upstreamEnv(), LOG_LEVEL: 'debug' }, { logStream: logs.stream });
    const client = await gateway.ready();
    await talk(client, 1);
    await client.next('transcript');
    await gateway.close();
    gateway = undefined;
    expect(logs.text().length).toBeGreaterThan(0);
    expect(logs.text()).not.toContain('SECRET_TRANSCRIPT_WORDS');
  });
});

describe('text to speech through the gateway', () => {
  const frames = (client: WsTestClient) =>
    client.binary.map((b) => ({
      tag: b[0],
      turnId: b.readUInt32BE(1),
      pcmBytes: b.byteLength - 5,
    }));

  it('speak returns tts_start, binary frames with the shared header, then tts_end', async () => {
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();
    client.sendJson({ type: 'speak', turnId: 7, text: 'Namaste ji, kya haal hai?' });

    expect(await client.next('tts_start')).toMatchObject({
      turnId: 7,
      sampleRate: 24000,
      format: 'pcm_s16le',
    });
    const end = await client.next('tts_end');
    expect(end).toMatchObject({ turnId: 7 });
    expect(end['interrupted']).toBeUndefined();

    expect(client.binary.length).toBeGreaterThan(0);
    for (const f of frames(client)) {
      expect(f.tag).toBe(0x01);
      expect(f.turnId).toBe(7);
      expect(f.pcmBytes % 2).toBe(0);
    }
    const totalPcm = frames(client).reduce((sum, f) => sum + f.pcmBytes, 0);
    const chars = 'Namaste ji, kya haal hai?'.length;
    expect(totalPcm).toBe(Math.round((24000 * 2 * Math.max(200, chars * 60)) / 1000 / 2) * 2);
    expect(mock!.tts.requests).toHaveLength(1);
    expect(mock!.tts.rejectedConcurrent).toBe(0);
  });

  it('runs the whole loop: talk, get the transcript, then have the reply spoken', async () => {
    mock!.stt.queueTranscripts('do kilo cheeni');
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();

    await talk(client, 1);
    expect(await client.next('transcript')).toMatchObject({ turnId: 1, text: 'do kilo cheeni' });
    client.sendJson({ type: 'speak', turnId: 1, text: 'Bill ek sau rupaye ka hai.' });
    await client.next('tts_start');
    await client.next('tts_end');

    const timings = client.messages.filter((m) => m['type'] === 'timing') as {
      spans: Record<string, number>;
    }[];
    const last = timings.at(-1)!;
    expect(Object.keys(last.spans)).toEqual(
      expect.arrayContaining(['release', 'commit_sent', 'transcript', 'tts_request', 'tts_first_chunk']),
    );
    expect(last.spans['tts_first_chunk']!).toBeGreaterThanOrEqual(last.spans['tts_request']!);
  });

  it('interrupt stops audio at once and no stale chunk ever reaches the client', async () => {
    await mock!.close();
    mock = await startMockGnani({ tts: { chunkBytes: 2400, interChunkDelayMs: 25 } });
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();

    client.sendJson({
      type: 'speak',
      turnId: 3,
      text: 'Yeh ek bahut lamba jawab hai jo beech mein rok diya jayega, dhyan se suniye.',
    });
    await client.next('tts_start');
    await client.waitBinary(3);
    client.sendJson({ type: 'interrupt', turnId: 3 });

    const end = await client.next('tts_end');
    expect(end).toMatchObject({ turnId: 3, interrupted: true });
    const framesAtEnd = client.binary.length;
    await sleep(400);
    expect(client.binary.length).toBe(framesAtEnd); // nothing arrives after tts_end
    expect(framesAtEnd).toBeLessThan(25);
    await sleep(50);
    expect(mock!.tts.requests[0]!.aborted).toBe(true);

    // the session is still healthy: a new reply works
    client.sendJson({ type: 'speak', turnId: 4, text: 'Naya jawab.' });
    const start = await client.next('tts_start');
    expect(start).toMatchObject({ turnId: 4 });
    expect((await client.next('tts_end'))['interrupted']).toBeUndefined();
  });

  it('pressing the button while the shop is speaking silences it (barge-in)', async () => {
    await mock!.close();
    mock = await startMockGnani({ tts: { chunkBytes: 2400, interChunkDelayMs: 25 } });
    mock.stt.queueTranscripts('bolna shuru');
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();

    client.sendJson({ type: 'speak', turnId: 1, text: 'Bahut lamba jawab jo kabhi khatam nahi hota is demo mein dekho.' });
    await client.waitBinary(2);
    await talk(client, 2); // ptt_start interrupts the speech in flight
    expect(await client.next('tts_end')).toMatchObject({ turnId: 1, interrupted: true });
    const n = client.binary.length;
    await sleep(300);
    expect(client.binary.length).toBe(n);
    expect(await client.next('transcript')).toMatchObject({ turnId: 2, text: 'bolna shuru' });
  });

  it('rejects empty speech and keeps the session open', async () => {
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();
    client.sendJson({ type: 'speak', turnId: 1, text: '<tag>' });
    expect(await client.next('error')).toMatchObject({ code: 'BAD_MESSAGE', turnId: 1 });
    expect(client.closed).toBeUndefined();
    expect(mock!.tts.requests).toHaveLength(0);
  });

  it('says TTS_UNAVAILABLE (text-only mode) when synthesis fails', async () => {
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();
    mock!.tts.failNextRequest('boom');
    client.sendJson({ type: 'speak', turnId: 9, text: 'Yeh fail hoga.' });
    expect(await client.next('error')).toMatchObject({
      code: 'TTS_UNAVAILABLE',
      turnId: 9,
      retryable: true,
    });
  });

  it('sends a budget limit and calls no upstream once the TTS character cap is reached', async () => {
    const guard = new DailyCreditGuard({ stt_seconds: 100, tts_chars: 10 });
    gateway = await startGateway(upstreamEnv(), { guard });
    const client = await gateway.connect();
    client.sendJson(HELLO);
    await client.next('ready');
    client.sendJson({ type: 'speak', turnId: 1, text: 'Yeh vaakya das akshar se lamba hai.' });
    expect(await client.next('limit')).toMatchObject({ reason: 'budget' });
    expect(mock!.tts.requests).toHaveLength(0);
  });

  it('never writes spoken text to the logs', async () => {
    const { captureLogs } = await import('./testing/harness');
    const logs = captureLogs();
    gateway = await startGateway({ ...upstreamEnv(), LOG_LEVEL: 'debug' }, { logStream: logs.stream });
    const client = await gateway.ready();
    client.sendJson({ type: 'speak', turnId: 1, text: 'SECRET_SPOKEN_REPLY' });
    await client.next('tts_end');
    await gateway.close();
    gateway = undefined;
    expect(logs.text()).not.toContain('SECRET_SPOKEN_REPLY');
  });

  it('closes both upstream sockets when the client leaves', async () => {
    gateway = await startGateway(upstreamEnv());
    const client = await gateway.ready();
    await sleep(100);
    client.close();
    await sleep(200);
    expect(mock!.stt.connections.every((c) => c.closeCode !== undefined)).toBe(true);
    expect(gateway.app.gateway.sessions.size).toBe(0);
  });
});
