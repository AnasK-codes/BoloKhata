import { afterEach, describe, expect, it } from 'vitest';
import { silenceFrame, speechFrame, startMockStt, type MockSttServer } from '@bolbill/mock-gnani';
import { AUDIO_FRAME_BYTES } from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import { testConfig } from '../testConfig';
import { sleep } from '../testing/client';
import { buildSttHeaders, SttLink, STT_TOPIC, type SttFailure, type SttTranscript } from './sttLink';

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as ConstructorParameters<typeof SttLink>[0]['log'];

interface Harness {
  link: SttLink;
  transcripts: SttTranscript[];
  failures: SttFailure[];
  usage: { turnId: number; seconds: number }[];
  events: string[];
}

let mock: MockSttServer | undefined;
let link: SttLink | undefined;

afterEach(async () => {
  link?.close();
  link = undefined;
  await mock?.close();
  mock = undefined;
});

function gnaniConfig(
  url: string,
  stt: Partial<GatewayConfig['gnani']['stt']> = {},
  apiKey?: string,
): GatewayConfig['gnani'] {
  const base = testConfig({ GNANI_STT_URL: url }).gnani;
  return { ...base, ...(apiKey ? { apiKey } : {}), stt: { ...base.stt, ...stt } };
}

function makeLink(
  gnani: GatewayConfig['gnani'],
  extra: Partial<ConstructorParameters<typeof SttLink>[0]> = {},
): Harness {
  link = new SttLink({ gnani, keyterms: ['Aata', 'Sharma ji'], log: silentLog, ...extra });
  const harness: Harness = { link, transcripts: [], failures: [], usage: [], events: [] };
  link.on('transcript', (t) => harness.transcripts.push(t));
  link.on('failure', (f) => harness.failures.push(f));
  link.on('usage', (turnId, seconds) => harness.usage.push({ turnId, seconds }));
  link.on('speechStart', () => harness.events.push('speechStart'));
  link.on('processing', () => harness.events.push('processing'));
  link.on('commitSent', () => harness.events.push('commitSent'));
  return harness;
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(10);
  }
}

/** Holds the button for `frames` speech frames (they leave the pacer at real-time cadence). */
async function press(h: Harness, turnId: number, frames = 8): Promise<void> {
  h.link.beginTurn(turnId);
  const frame = speechFrame();
  for (let i = 0; i < frames; i++) h.link.pushFrame(frame);
  h.link.endTurn();
}

describe('buildSttHeaders', () => {
  it('sends config, VAD settings, topic and ASCII-escaped keyterms', () => {
    const gnani = testConfig().gnani;
    const headers = buildSttHeaders(gnani, ['Aata', 'आटा']);
    expect(headers['x-api-key-id']).toBe('test-key');
    expect(headers['model']).toBe('prisma-v3.0');
    expect(headers['language_code']).toBe('indic-auto');
    expect(headers['x-sample-rate']).toBe('16000');
    expect(headers['x-idle-timeout-sec']).toBe('900');
    expect(headers['x-min-segment-ms']).toBe('120');
    expect(headers['topic']).toBe(STT_TOPIC);
    expect(headers['keyterms']).toBe('["Aata","\\u0906\\u091f\\u093e"]');
    for (const value of Object.values(headers)) expect(value).toMatch(/^[\x20-\x7e]*$/);
  });

  it('omits keyterms and topic for prisma-v2.5, which does not support them', () => {
    const headers = buildSttHeaders(testConfig({ GNANI_STT_MODEL: 'prisma-v2.5', GNANI_STT_FORMAT: 'verbatim' }).gnani, ['Aata']);
    expect(headers['keyterms']).toBeUndefined();
    expect(headers['topic']).toBeUndefined();
  });

  it('omits the keyterms header when there are none', () => {
    expect(buildSttHeaders(testConfig().gnani, [])['keyterms']).toBeUndefined();
  });
});

describe('SttLink against the mock', () => {
  it('runs a turn: frames of exactly 1,024 bytes at real-time cadence, commit on release', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('do kilo cheeni');
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);

    await press(h, 1, 10);
    await until(() => h.transcripts.length === 1);

    expect(h.transcripts[0]).toMatchObject({ turnId: 1, text: 'do kilo cheeni' });
    const connection = mock.connections[0]!;
    expect(connection.violations).toEqual([]); // no wrong-size or too-fast frames
    expect(connection.frames).toBe(10);
    expect(connection.commits).toBe(1);
    const gaps = connection.frameArrivals.slice(1).map((t, i) => t - connection.frameArrivals[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(28);
    expect(mean).toBeLessThan(40);
    expect(h.events).toContain('speechStart');
    expect(h.events).toContain('processing');
    expect(h.events).toContain('commitSent');
    expect(h.usage).toEqual([{ turnId: 1, seconds: 0.32 }]);
  });

  it('sends the documented headers on the upgrade', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => mock!.connections.length === 1);
    const headers = mock.connections[0]!.headers;
    expect(headers['x-idle-timeout-sec']).toBe('900');
    expect(headers['topic']).toBe(STT_TOPIC);
    expect(headers['keyterms']).toBe('["Aata","Sharma ji"]');
    expect(headers['x-api-key-id']).toBe('[redacted]'); // the mock never stores the key
  });

  it('reuses one connection for two back-to-back turns, in order', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('pehla', 'doosra');
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);

    await press(h, 1);
    await until(() => h.transcripts.length === 1);
    await press(h, 2);
    await until(() => h.transcripts.length === 2);

    expect(h.transcripts.map((t) => [t.turnId, t.text])).toEqual([
      [1, 'pehla'],
      [2, 'doosra'],
    ]);
    expect(mock.connections).toHaveLength(1);
  });

  it('sends no audio when the button is not held', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('chhota sa');
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    h.link.pushFrame(speechFrame()); // no turn
    await press(h, 1, 5);
    await until(() => h.transcripts.length === 1);
    h.link.pushFrame(speechFrame()); // after release
    await sleep(100);
    expect(mock.connections[0]!.frames).toBe(5);
  });

  it('finishes at release without a commit when the VAD already closed the segment', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('vad ne band kar diya');
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);

    h.link.beginTurn(1);
    for (let i = 0; i < 6; i++) h.link.pushFrame(speechFrame());
    for (let i = 0; i < 20; i++) h.link.pushFrame(silenceFrame()); // 640 ms of silence > 500 ms
    await until(() => mock!.connections[0]!.segments.length === 1, 4000);
    h.link.endTurn();
    await until(() => h.transcripts.length === 1);

    expect(h.transcripts[0]!.text).toBe('vad ne band kar diya');
    expect(mock.connections[0]!.commits).toBe(0);
  });

  it('reports an empty transcript as NO_TRANSCRIPT, not an empty bill', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('');
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    await press(h, 1);
    await until(() => h.failures.length === 1);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'NO_TRANSCRIPT', retryable: true });
    expect(h.transcripts).toEqual([]);
  });

  it('fails a turn that is too long and ignores the rest of the press', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url, { maxUtteranceSeconds: 2 }));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    h.link.beginTurn(1);
    for (let i = 0; i < 80; i++) h.link.pushFrame(speechFrame());
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'UTTERANCE_TOO_LONG' });
    h.link.endTurn(); // harmless
    expect(h.failures).toHaveLength(1);
  });

  it('keeps working after a Gnani error mid-turn', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);

    h.link.beginTurn(1);
    for (let i = 0; i < 5; i++) h.link.pushFrame(speechFrame());
    await sleep(100);
    mock.sendError('transcription failed');
    await until(() => h.failures.length === 1);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'STT_ERROR', retryable: true });

    mock.queueTranscripts('theek hai');
    await until(() => h.link.isConnected);
    await press(h, 2);
    await until(() => h.transcripts.length === 1);
    expect(h.transcripts[0]).toMatchObject({ turnId: 2, text: 'theek hai' });
  });

  it('delivers a slow transcript within the timeout and reports Gnani latency', async () => {
    mock = await startMockStt({ transcriptLatencyMs: 250 });
    mock.queueTranscripts('der se aaya');
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    await press(h, 1);
    await until(() => h.transcripts.length === 1);
    expect(h.transcripts[0]).toMatchObject({ text: 'der se aaya', sttMs: 250, language: 'hi-IN' });
  });

  it('times out a very slow upstream and never lets its late answer leak into the next turn', async () => {
    mock = await startMockStt({ transcriptLatencyMs: 800 });
    mock.queueTranscripts('purana jawab', 'naya jawab');
    const h = makeLink(gnaniConfig(mock.url), { transcriptTimeoutMs: 200 });
    h.link.prewarm();
    await until(() => h.link.isConnected);
    await press(h, 1);
    await until(() => h.failures.length === 1);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'NO_TRANSCRIPT', retryable: true });

    mock.setTranscriptLatency(0);
    await until(() => h.link.isConnected);
    await press(h, 2);
    await until(() => h.transcripts.length === 1);
    expect(h.transcripts[0]).toMatchObject({ turnId: 2, text: 'naya jawab' });
    await sleep(1000); // the 800 ms stale answer would have arrived by now
    expect(h.transcripts).toHaveLength(1);
  });

  it('discards a turn when the client disconnects mid-utterance, and still reports usage', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    h.link.beginTurn(1);
    for (let i = 0; i < 6; i++) h.link.pushFrame(speechFrame());
    await sleep(120);
    h.link.close();
    await sleep(100);
    expect(h.transcripts).toEqual([]);
    expect(h.usage).toHaveLength(1);
    expect(h.usage[0]!.seconds).toBeGreaterThan(0);
    expect(mock.connections.every((c) => c.closeCode !== undefined)).toBe(true);
  });

  it('reconnects after Gnani drops the socket', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url), { backoff: { baseMs: 20, maxMs: 100, maxAttempts: 5 } });
    h.link.prewarm();
    await until(() => h.link.isConnected);
    mock.dropConnections(1011, 'boom');
    await until(() => !h.link.isConnected);
    await until(() => h.link.isConnected);
    mock.queueTranscripts('wapas aa gaya');
    await press(h, 1);
    await until(() => h.transcripts.length === 1);
    expect(mock.connections.length).toBeGreaterThanOrEqual(2);
    expect(h.transcripts[0]!.text).toBe('wapas aa gaya');
  });

  it('fails the turn in flight when the socket drops mid-utterance', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url), { backoff: { baseMs: 20, maxMs: 100, maxAttempts: 5 } });
    h.link.prewarm();
    await until(() => h.link.isConnected);
    h.link.beginTurn(1);
    for (let i = 0; i < 4; i++) h.link.pushFrame(speechFrame());
    await sleep(60);
    mock.dropConnections(1011, 'boom');
    await until(() => h.failures.length === 1);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'STT_ERROR', retryable: true });
  });

  it('rotates to a fresh connection in the background before the session cap', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('rotation ke baad');
    const h = makeLink(gnaniConfig(mock.url, { rotateAfterMs: 200 }));
    h.link.prewarm();
    await until(() => mock!.connections.length >= 2, 2000);
    await until(() => mock!.connections[0]!.closeCode === 1000, 2000); // old one retired cleanly
    expect(h.link.isConnected).toBe(true);

    await press(h, 1);
    await until(() => h.transcripts.length === 1);
    expect(h.transcripts[0]!.text).toBe('rotation ke baad');
  });

  it('postpones rotation until the turn in flight has finished', async () => {
    mock = await startMockStt();
    mock.queueTranscripts('beech mein');
    const h = makeLink(gnaniConfig(mock.url, { rotateAfterMs: 150 }));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    h.link.beginTurn(1);
    const frame = speechFrame();
    for (let i = 0; i < 12; i++) h.link.pushFrame(frame); // about 380 ms: rotation fires during it
    await sleep(250);
    expect(mock.connections[0]!.closeCode).toBeUndefined(); // still in use
    h.link.endTurn();
    await until(() => h.transcripts.length === 1);
    await until(() => mock!.connections[0]!.closeCode === 1000, 2000);
    expect(h.transcripts[0]!.text).toBe('beech mein');
  });

  it('spare strategy opens a fresh connection after each turn', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url, { strategy: 'spare' }));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    await press(h, 1);
    await until(() => h.transcripts.length === 1);
    await until(() => mock!.connections.length === 2);
    await until(() => mock!.connections[0]!.closeCode === 1000);
    await press(h, 2);
    await until(() => h.transcripts.length === 2);
    expect(h.failures).toEqual([]);
  });

  it('treats a rejected API key as unavailable and does not retry', async () => {
    mock = await startMockStt({ validApiKey: 'right-key' });
    const h = makeLink(gnaniConfig(mock.url, {}, 'wrong-key'));
    h.link.beginTurn(1);
    await until(() => h.failures.length === 1);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'STT_UNAVAILABLE', retryable: false });
    await sleep(600);
    expect(mock.connections).toHaveLength(0); // the mock records only accepted connections
    h.link.beginTurn(2);
    expect(h.failures[1]).toMatchObject({ turnId: 2, code: 'STT_UNAVAILABLE', retryable: false });
  });

  it('degrades with a clear error when Gnani is unreachable', async () => {
    mock = await startMockStt();
    const url = mock.url;
    await mock.close();
    mock = undefined;
    const h = makeLink(gnaniConfig(url), { backoff: { baseMs: 10, maxMs: 30, maxAttempts: 2 } });
    h.link.beginTurn(1);
    await until(() => h.failures.length >= 1, 4000);
    expect(h.failures[0]).toMatchObject({ turnId: 1, code: 'STT_UNAVAILABLE', retryable: true });
  });

  it('closes cleanly: no listeners fire and the socket is closed', async () => {
    mock = await startMockStt();
    const h = makeLink(gnaniConfig(mock.url));
    h.link.prewarm();
    await until(() => h.link.isConnected);
    h.link.close();
    await until(() => mock!.connections[0]!.closeCode !== undefined);
    expect(h.link.isConnected).toBe(false);
    h.link.beginTurn(1); // ignored after close
    expect(h.failures).toEqual([]);
  });
});

describe('frame size contract', () => {
  it('the test frame is exactly one Gnani frame', () => {
    expect(speechFrame().byteLength).toBe(AUDIO_FRAME_BYTES);
  });
});
