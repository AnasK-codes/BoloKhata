import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import { WsTestClient, sleep } from './testing/client';
import { HELLO, startGateway, type Harness } from './testing/harness';

/**
 * Failure drills that are not covered elsewhere. (Gnani dropping or erroring mid-utterance, TTS
 * failure and timeout, LLM timeout, a client that leaves mid-turn and an empty recording have
 * their own tests in gnani/*.test.ts and session/turnEngine.test.ts; docs/TESTING.md lists them.)
 */
let gateway: Harness | undefined;
let mock: MockGnani | undefined;

beforeEach(async () => {
  mock = await startMockGnani({ stt: { transcriptLatencyMs: 20 }, tts: { msPerChar: 10, minAudioMs: 100 } });
});
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  await mock?.close();
  mock = undefined;
});

const env = (extra: Record<string, string> = {}) => ({ GNANI_STT_URL: mock!.stt.url, GNANI_TTS_URL: mock!.tts.url, ...extra });

async function say(client: WsTestClient, turnId: number, text: string) {
  mock!.stt.queueTranscripts(text);
  client.sendJson({ type: 'ptt_start', turnId });
  for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
  client.sendJson({ type: 'ptt_end', turnId });
  const draft = await client.next('draft');
  await client.next('tts_end');
  return draft;
}

describe('double confirmation', () => {
  it('a second spoken "haan" finds nothing pending and saves nothing again', async () => {
    gateway = await startGateway(env());
    const client = await gateway.ready(HELLO);
    const bill = await say(client, 1, 'Sharma ji ko do kilo aata');
    const first = await say(client, 2, 'haan');
    expect(first).toMatchObject({ intent: 'confirm', draftId: bill['draftId'] });
    const second = await say(client, 3, 'haan');
    expect(second['intent']).not.toBe('confirm');
    expect(second['draftId']).not.toBe(bill['draftId']);
  }, 30_000);
});

describe('a client that misbehaves', () => {
  it('is closed with 1008 after too many bad messages, and frees its slot', async () => {
    gateway = await startGateway(env());
    const client = await gateway.ready(HELLO);
    for (let i = 0; i < 40; i++) client.ws.send('not json');
    expect((await client.waitClosed(5000)).code).toBe(1008);
    await sleep(100);
    expect(gateway.app.gateway.sessions.size).toBe(0);
  });
});

describe('the longest allowed utterance', () => {
  it('25 seconds of speech at real-time pace is transcribed in full (limit is 30 s)', async () => {
    gateway = await startGateway(env());
    mock!.stt.queueTranscripts('Sharma ji ko do kilo aata');
    const client = await gateway.ready(HELLO);
    client.sendJson({ type: 'ptt_start', turnId: 1 });
    const frames = Math.round(25_000 / 32);
    const frame = speechFrame();
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      client.sendBinary(frame);
      const wait = start + (i + 1) * 32 - performance.now();
      if (wait > 0) await sleep(wait);
    }
    client.sendJson({ type: 'ptt_end', turnId: 1 });
    expect(await client.next('transcript', 8000)).toMatchObject({ turnId: 1 });
    const upstream = mock!.stt.connections[0]!;
    expect(upstream.violations).toEqual([]);
    expect(upstream.frames).toBeGreaterThanOrEqual(frames - 2);
    expect(client.messages.some((m) => m['type'] === 'error')).toBe(false);
  }, 60_000);

  it('audio past the limit fails the turn with UTTERANCE_TOO_LONG and the next turn still works', async () => {
    gateway = await startGateway(env({ MAX_UTTERANCE_SECONDS: '2' }));
    const client = await gateway.ready(HELLO);
    client.sendJson({ type: 'ptt_start', turnId: 1 });
    for (let i = 0; i < 120; i++) client.sendBinary(speechFrame()); // about 3.8 s
    client.sendJson({ type: 'ptt_end', turnId: 1 });
    expect(await client.next('error')).toMatchObject({ code: 'UTTERANCE_TOO_LONG', turnId: 1 });
    const next = await say(client, 2, 'Sharma ji ko do kilo aata');
    expect(next['intent']).toBe('create_bill');
  }, 30_000);
});
