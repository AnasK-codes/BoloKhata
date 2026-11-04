import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { helloSchema } from '@bolbill/shared';
import { startMockGnani, speechFrame, type MockGnani } from '@bolbill/mock-gnani';
import { HELLO, TEST_ORIGIN, startGateway, type Harness } from '../../../../gateway/src/testing/harness';
import { RealtimeClient } from '../realtime/client';
import { TurnController, type CapturePort, type PlaybackPort } from './controller';
import { turnMetrics } from './timing';

/**
 * The browser's realtime layer against the real gateway, which talks to the mock Gnani
 * servers. Only the microphone and the speaker are replaced: a fake microphone produces
 * 1,024-byte speech frames every 32 ms while its gate is open, and a fake speaker records
 * what it is asked to play. No real Gnani API is involved.
 */
class FakeMic implements CapturePort {
  gateOpen = false;
  gateOpenings = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly onFrame: (frame: ArrayBuffer) => void) {}

  openGate(): void {
    this.gateOpen = true;
    this.gateOpenings++;
    const frame = speechFrame();
    this.timer = setInterval(() => {
      this.onFrame(frame.slice().buffer);
    }, 32);
  }
  async closeGate(): Promise<void> {
    clearInterval(this.timer);
    this.gateOpen = false;
  }
}

class FakeSpeaker implements PlaybackPort {
  events: string[] = [];
  bytes = 0;
  private activeTurn = -1;
  constructor(private readonly onEnded: (turnId: number) => void) {}
  beginTurn(turnId: number, rate: number) {
    this.activeTurn = turnId;
    this.events.push(`begin:${turnId}:${rate}`);
  }
  pushPcm(turnId: number, pcm: Uint8Array) {
    // Match PlaybackEngine: flush invalidates the turn, including packets already in transit.
    if (turnId !== this.activeTurn) return;
    this.bytes += pcm.byteLength;
    if (this.events.at(-1) !== `pcm:${turnId}`) this.events.push(`pcm:${turnId}`);
  }
  endTurn(turnId: number) {
    if (turnId !== this.activeTurn) return;
    this.events.push(`end:${turnId}`);
    queueMicrotask(() => this.onEnded(turnId)); // pretend it played out instantly
  }
  flush() {
    this.activeTurn = -1;
    this.events.push('flush');
  }
}

let mock: MockGnani;
let gateway: Harness;
let client: RealtimeClient;
let controller: TurnController;
let mic: FakeMic;
let speaker: FakeSpeaker;
let saved: string[];

async function until(check: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; phase=${controller.state.phase}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  mock = await startMockGnani({ stt: { transcriptLatencyMs: 40 }, tts: { msPerChar: 40 } });
  gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url });
  saved = [];

  const dispatchOf = () => controller;
  mic = new FakeMic((frame) => dispatchOf().handleFrame(frame));
  speaker = new FakeSpeaker((turnId) => dispatchOf().handlePlaybackFinished(turnId));
  client = new RealtimeClient(
    { gatewayUrl: gateway.baseUrl, getCatalog: () => helloSchema.parse(HELLO).catalog },
    {
      onState: (state) => controller.handleConnection(state),
      onMessage: (message) => controller.handleServerMessage(message),
      onTtsAudio: (turnId, pcm) => controller.handleTtsAudio(turnId, pcm),
    },
    {
      // Browsers set Origin themselves; Node's fetch lets us do it, and the gateway checks it.
      fetch: (url, init) =>
        fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: TEST_ORIGIN } }),
    },
  );
  controller = new TurnController({
    client,
    capture: mic,
    playback: speaker,
    handlers: { saveDraft: (draft) => saved.push(draft.draftId) },
  });
  client.connect();
  await until(() => controller.state.connected, 'the gateway to be ready');
});

afterEach(async () => {
  controller.dispose();
  client.close();
  await gateway.close();
  await mock.close();
});

async function speakFor(ms: number, minimumFrames = 0): Promise<number> {
  const framesBefore = client.stats.audioFramesSent;
  controller.press();
  const turnId = controller.state.turnId as number;
  await sleep(ms);
  // Busy hosts can skip interval callbacks: wait for the frames this test asserts, not just wall time.
  if (minimumFrames > 0) await until(() => client.stats.audioFramesSent - framesBefore >= minimumFrames, 'microphone frames');
  controller.release();
  return turnId;
}

describe('a full turn through the real gateway', () => {
  it('sends exact frames, gets transcript and draft, plays the reply and records timings', async () => {
    mock.stt.queueTranscripts('Sharma ji ko do kilo cheeni udhaar likh do');

    const turnId = await speakFor(400, 9);
    // The gateway sends `timing` again after the voice ends, with the TTS spans.
    await until(() => controller.state.turns[0]?.gateway.tts_first_chunk !== undefined, 'the final timing message');
    const state = controller.state;

    // Audio out: only whole 1,024-byte frames, at real-time cadence, none after release.
    const upstream = mock.stt.connections[0]!;
    expect(upstream.violations).toEqual([]);
    expect(upstream.frames).toBeGreaterThan(8);
    expect(upstream.frames).toBe(client.stats.audioFramesSent);
    expect(upstream.commits).toBe(1);
    expect(mic.gateOpen).toBe(false);

    // Results back.
    expect(state.transcript).toBe('Sharma ji ko do kilo cheeni udhaar likh do');
    expect(state.draft?.intent).toBe('create_bill');
    expect(state.draft?.bill?.items.map((i) => i.name)).toContain('Cheeni');
    expect(state.pending?.turnId).toBe(turnId);
    expect(state.phase).toBe('reviewing');

    // Voice: begun at the announced rate, bytes received, ended.
    expect(speaker.events[0]).toMatch(new RegExp(`^begin:${turnId}:\\d+$`));
    expect(speaker.events).toContain(`pcm:${turnId}`);
    expect(speaker.events.at(-1)).toBe(`end:${turnId}`);
    expect(speaker.bytes).toBeGreaterThan(1000);

    // Timing: every browser span, merged with the gateway's.
    const record = state.turns[0]!;
    expect(Object.keys(record.browser)).toEqual(
      expect.arrayContaining(['press', 'first_frame_sent', 'release', 'processing', 'transcript', 'draft', 'tts_start_received']),
    );
    expect(record.gateway.commit_sent).toBeDefined();
    const metrics = turnMetrics(record);
    expect(metrics.releaseToTranscript).toBeGreaterThan(0);
    expect(metrics.gatewayStt).toBeGreaterThan(0);
  });

  it('confirms a pending bill by voice: "haan" names the draft and the browser saves it once', async () => {
    mock.stt.queueTranscripts('Sharma ji ko do kilo cheeni udhaar likh do', 'haan');
    const first = await speakFor(400);
    await until(() => controller.state.pending?.turnId === first && controller.state.phase === 'reviewing', 'the bill');
    const draftId = controller.state.pending!.draftId;

    await speakFor(300);
    await until(() => saved.length > 0, 'the save');
    expect(saved).toEqual([draftId]);
    expect(controller.state.pending).toBeNull();
    await sleep(200);
    expect(saved).toHaveLength(1);
  });

  it('interrupts the spoken reply: playback is flushed and no old audio plays afterwards', async () => {
    mock.stt.queueTranscripts('Sharma ji ko do kilo cheeni udhaar likh do', 'Sharma ji ka kitna udhaar hai');
    const first = await speakFor(400);
    // The mock voice speaks at about real time, so the reply is still being delivered here.
    await until(() => speaker.events.includes(`pcm:${first}`), 'the voice to start');
    controller.handleServerMessage({ type: 'processing', turnId: 9999 }); // unrelated noise is ignored

    const eventsBefore = speaker.events.length;
    controller.press();
    expect(speaker.events.slice(eventsBefore)[0]).toBe('flush');
    const second = controller.state.turnId as number;
    expect(second).toBe(first + 1);
    const flushAt = speaker.events.length;
    await sleep(300);
    controller.release();
    await until(() => controller.state.transcript === 'Sharma ji ka kitna udhaar hai', 'the second transcript');

    const after = speaker.events.slice(flushAt);
    expect(after.some((e) => e === `pcm:${first}` || e === `end:${first}`)).toBe(false);
    expect(controller.state.pending?.turnId).toBe(first); // the unconfirmed bill survives the question
  });

  it('a gateway restart mid-session: the client reconnects by itself and the next turn works', async () => {
    const port = Number(new URL(gateway.baseUrl).port);
    controller.press();
    await sleep(150);
    await gateway.close();
    await until(() => controller.state.phase === 'error', 'the drop to be noticed');
    expect(mic.gateOpen).toBe(false);
    gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url }, {}, port);
    await until(() => controller.state.connected, 'the client to reconnect', 15_000);
    controller.dismissError();

    mock.stt.queueTranscripts('Sharma ji ko do kilo cheeni udhaar likh do');
    await speakFor(400);
    await until(() => controller.state.phase === 'reviewing', 'a bill after the restart');
    expect(controller.state.draft?.intent).toBe('create_bill');
  }, 30_000);

  it('never leaves the gate open when the gateway goes away mid-turn', async () => {
    controller.press();
    await sleep(150);
    expect(mic.gateOpen).toBe(true);
    await gateway.close();
    await until(() => controller.state.phase === 'error', 'the disconnect to be noticed');
    expect(mic.gateOpen).toBe(false);
    expect(controller.state.error?.code).toBe('DISCONNECTED');
    gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url }); // so afterEach can close it
  });
});
