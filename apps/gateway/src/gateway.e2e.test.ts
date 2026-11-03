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
