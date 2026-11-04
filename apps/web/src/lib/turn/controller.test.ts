import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnController, type ControllerDeps } from './controller';
import { World, draftMessage } from './testing';

let world: World;
let controller: TurnController;
let saved: unknown[];

function make(overrides: Partial<ControllerDeps> = {}) {
  world = new World();
  saved = [];
  controller = new TurnController({
    client: world.client,
    capture: world.capture,
    playback: world.playback,
    handlers: { saveDraft: (d) => saved.push(d.draftId) },
    now: () => performance.now(),
    ...overrides,
  });
  controller.handleConnection({ status: 'ready', sessionId: 's', maxUtteranceSeconds: 20, maxSessionMinutes: 10, rttMs: 5 });
  return controller;
}

const frame = () => new ArrayBuffer(1024);
const flush = () => vi.advanceTimersByTimeAsync(0);
const tts = (turnId: number) => ({ type: 'tts_start' as const, turnId, sampleRate: 24000, format: 'pcm_s16le' as const });

beforeEach(() => {
  vi.useFakeTimers();
  make();
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe('a turn from press to release', () => {
  it('sends ptt_start, then opens the gate, and forwards frames while it is open', async () => {
    controller.press();
    expect(world.log).toEqual(['ptt_start', 'gate_open']);
    controller.handleFrame(frame());
    controller.handleFrame(frame());
    expect(world.audio).toHaveLength(2);
    expect(controller.state.turns[0]?.browser.first_frame_sent).toBeDefined();
  });

  it('records only the first frame as "first frame sent"', () => {
    controller.press();
    controller.handleFrame(frame());
    const first = controller.state.turns[0]?.browser.first_frame_sent;
    vi.advanceTimersByTime(200);
    controller.handleFrame(frame());
    expect(controller.state.turns[0]?.browser.first_frame_sent).toBe(first);
  });

  it('closes the gate and waits for its last frame BEFORE sending ptt_end', async () => {
    world.holdGateClose = true;
    controller.press();
    controller.release();
    await flush();
    expect(world.log).toEqual(['ptt_start', 'gate_open']); // ptt_end must not have gone yet

    controller.handleFrame(frame()); // the zero-padded tail frame still goes out
    expect(world.audio).toHaveLength(1);
    world.gateClosing?.();
    await flush();
    expect(world.log).toEqual(['ptt_start', 'gate_open', 'gate_closed', 'ptt_end']);

    controller.handleFrame(frame()); // anything after that is dropped
    expect(world.audio).toHaveLength(1);
  });

  it('sends no frames when no turn is live', () => {
    controller.handleFrame(frame());
    expect(world.audio).toHaveLength(0);
  });
});

describe('server messages', () => {
  it('drives the phases and the playback from gateway events', async () => {
    controller.press();
    const id = controller.state.turnId as number;
    controller.release();
    await flush();
    controller.handleServerMessage({ type: 'processing', turnId: id });
    controller.handleServerMessage({ type: 'transcript', turnId: id, text: 'do kilo aata' });
    controller.handleServerMessage(draftMessage(id));
    controller.handleServerMessage(tts(id));
    controller.handleTtsAudio(id, new Uint8Array(480));
    controller.handleTtsAudio(id, new Uint8Array(480));
    controller.handleServerMessage({ type: 'tts_end', turnId: id });
    controller.handlePlaybackStarted(id, performance.now() + 5);
    expect(controller.state.phase).toBe('speaking');
    controller.handlePlaybackFinished(id);

    expect(controller.state.phase).toBe('reviewing');
    expect(world.played).toEqual([`begin:${id}:24000`, `pcm:${id}:480`, `pcm:${id}:480`, `end:${id}`]);
    expect(controller.state.turns[0]?.browser.first_audible).toBeDefined();
  });
});

describe('barge-in', () => {
  it('flushes the speaker, interrupts the old turn and starts the new one, in that order', async () => {
    controller.press();
    const old = controller.state.turnId as number;
    controller.release();
    await flush();
    controller.handleServerMessage({ type: 'processing', turnId: old });
    controller.handleServerMessage({ type: 'transcript', turnId: old, text: 'x' });
    controller.handleServerMessage(draftMessage(old));
    controller.handleServerMessage(tts(old));
    world.log = [];

    controller.press();
    await flush();
    expect(world.log).toEqual(['flush', 'interrupt', 'ptt_start', 'gate_open']);
    expect(world.sent.filter((m) => m.type === 'interrupt')).toEqual([{ type: 'interrupt', turnId: old }]);
    expect(world.sent.at(-1)).toEqual({ type: 'ptt_start', turnId: old + 1 });
  });

  it('keeps protocol order when pressed again before the gate has finished closing', async () => {
    world.holdGateClose = true;
    controller.press();
    controller.release();
    await flush();
    controller.press(); // impatient: the old turn is still finishing
    await flush();
    world.gateClosing?.();
    await flush();
    expect(world.sent.map((m) => m.type)).toEqual(['ptt_start', 'ptt_end', 'interrupt', 'ptt_start']);
  });

  it('drops late audio of the interrupted turn', async () => {
    controller.press();
    const old = controller.state.turnId as number;
    controller.release();
    await flush();
    controller.handleServerMessage(tts(old));
    controller.press();
    controller.handleServerMessage({ type: 'tts_end', turnId: old });
    expect(world.played.at(-1)).toBe('flush');
  });
});

describe('the gate never stays open', () => {
  it('closes on cancel', async () => {
    controller.press();
    controller.cancel();
    await flush();
    expect(world.gateOpen).toBe(false);
    expect(world.sent.map((m) => m.type)).toEqual(['ptt_start', 'interrupt']);
    controller.handleFrame(frame());
    expect(world.audio).toHaveLength(0);
  });

  it('closes when the connection drops mid-turn', async () => {
    controller.press();
    world.connected = false;
    controller.handleConnection({ status: 'reconnecting', attempt: 0, delayMs: 500 });
    await flush();
    expect(world.gateOpen).toBe(false);
    expect(controller.state.phase).toBe('error');
    controller.handleFrame(frame());
    expect(world.audio).toHaveLength(0);
  });

  it('closes when the microphone is lost mid-turn', async () => {
    controller.press();
    controller.handleMicLost();
    await flush();
    expect(world.gateOpen).toBe(false);
    expect(controller.state.error?.code).toBe('MIC_UNAVAILABLE');
  });

  it('releases by itself at the longest allowed utterance', async () => {
    make({ maxUtteranceSeconds: () => 5 });
    controller.press();
    await vi.advanceTimersByTimeAsync(4900);
    expect(controller.state.phase).toBe('listening');
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.state.phase).toBe('finishing');
    expect(world.gateOpen).toBe(false);
    expect(world.sent.map((m) => m.type)).toEqual(['ptt_start', 'ptt_end']);
  });

  it('does not open the gate when the press cannot be announced', async () => {
    world.connected = false;
    controller.handleConnection({ status: 'reconnecting', attempt: 0, delayMs: 1 });
    controller.press();
    await flush();
    expect(world.gateOpen).toBe(false);
    expect(controller.state.error?.code).toBe('OFFLINE');
  });

  it('turns a failed ptt_start into an offline error with the gate shut', async () => {
    world.connected = false; // the state still says connected: the link died a moment ago
    controller.press();
    await flush();
    expect(world.gateOpen).toBe(false);
    expect(controller.state.phase).toBe('error');
  });
});

describe('microphone not ready', () => {
  it('asks for audio and shows an error instead of sending a press', async () => {
    const ensureAudio = vi.fn();
    make({ ensureAudio, isMicLive: () => false });
    controller.press();
    await flush();
    expect(ensureAudio).toHaveBeenCalledOnce();
    expect(controller.state.error?.code).toBe('MIC_UNAVAILABLE');
    expect(world.sent).toEqual([]);
    expect(world.gateOpen).toBe(false);
  });

  it('ignores a lost microphone when not listening', () => {
    controller.handleMicLost();
    expect(controller.state.phase).toBe('idle');
  });
});

describe('giving up on a silent gateway', () => {
  it('fails the turn after the response timeout', async () => {
    make({ responseTimeoutMs: 3000 });
    controller.press();
    controller.release();
    await vi.advanceTimersByTimeAsync(2900);
    expect(controller.state.phase).toBe('finishing');
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.state.error?.code).toBe('TIMEOUT');
  });

  it('does not fire once the draft has arrived', async () => {
    make({ responseTimeoutMs: 3000 });
    controller.press();
    const id = controller.state.turnId as number;
    controller.release();
    await flush();
    controller.handleServerMessage({ type: 'transcript', turnId: id, text: 'x' });
    controller.handleServerMessage(draftMessage(id));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.state.phase).toBe('reviewing');
  });
});

describe('confirm', () => {
  it('hands the draft to the save handler and speaks a confirmation', async () => {
    controller.press();
    const id = controller.state.turnId as number;
    controller.release();
    await flush();
    controller.handleServerMessage({ type: 'transcript', turnId: id, text: 'x' });
    controller.handleServerMessage(draftMessage(id));
    controller.confirm();
    expect(saved).toEqual([`d${id}`]);
    expect(world.sent.at(-1)).toMatchObject({ type: 'speak', turnId: id + 1 });
  });
});

describe('double confirm', () => {
  it('two quick taps on Confirm save once and speak once', async () => {
    controller.press();
    const id = controller.state.turnId as number;
    controller.release();
    await flush();
    controller.handleServerMessage({ type: 'transcript', turnId: id, text: 'x' });
    controller.handleServerMessage(draftMessage(id));
    controller.confirm();
    controller.confirm();
    expect(saved).toEqual([`d${id}`]);
    expect(world.sent.filter((m) => m.type === 'speak')).toHaveLength(1);
  });
});
