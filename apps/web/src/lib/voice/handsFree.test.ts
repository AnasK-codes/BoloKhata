import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnController } from '../turn/controller';
import { World, draftMessage } from '../turn/testing';
import { attachHandsFree } from './handsFree';

let world: World;
let controller: TurnController;
let enabled: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  enabled = true;
  world = new World();
  controller = new TurnController({ client: world.client, capture: world.capture, playback: world.playback });
  controller.handleConnection({ status: 'ready', sessionId: 's', maxUtteranceSeconds: 20, maxSessionMinutes: 5, rttMs: 1 });
  attachHandsFree(controller, () => enabled);
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

/** A bill that was read back and is still waiting. */
async function readBack(): Promise<number> {
  controller.press();
  const id = controller.state.turnId as number;
  controller.release();
  await vi.advanceTimersByTimeAsync(0);
  controller.handleServerMessage({ type: 'transcript', turnId: id, text: 'x' });
  controller.handleServerMessage(draftMessage(id));
  controller.handleServerMessage({ type: 'tts_start', turnId: id, sampleRate: 24000, format: 'pcm_s16le' });
  controller.handlePlaybackFinished(id);
  return id;
}

describe('hands-free confirm window', () => {
  it('opens a short listening turn after the readback and sends it by itself', async () => {
    const id = await readBack();
    expect(controller.state.phase).toBe('listening');
    expect(controller.state.turnId).toBe(id + 1);
    await vi.advanceTimersByTimeAsync(4100);
    expect(controller.state.phase).toBe('finishing');
    expect(world.gateOpen).toBe(false);
  });

  it('stays off when the setting is off', async () => {
    enabled = false;
    await readBack();
    expect(controller.state.phase).toBe('reviewing');
  });

  it('hides the "nothing heard" error of a silent window', async () => {
    const id = await readBack();
    await vi.advanceTimersByTimeAsync(4100);
    controller.handleServerMessage({ type: 'error', turnId: id + 1, code: 'NO_TRANSCRIPT', message: 'Nothing heard.', retryable: true });
    expect(controller.state.phase).toBe('reviewing');
    expect(controller.state.error).toBeNull();
  });

  it('does not release a turn the user took over', async () => {
    await readBack();
    controller.release(); // the user pressed and released themselves
    controller.press();
    const mine = controller.state.turnId;
    await vi.advanceTimersByTimeAsync(4100);
    expect(controller.state.turnId).toBe(mine);
    expect(controller.state.phase).toBe('listening');
  });
});
