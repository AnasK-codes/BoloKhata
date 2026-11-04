import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnController } from '../turn/controller';
import { World } from '../turn/testing';
import { HoldOrLatch, bindPageGuards } from './holdOrLatch';

/**
 * The promise the whole stack makes: the microphone gate is never left open. These tests wire
 * the real gesture to the real controller (with a fake microphone) and break the press in every
 * way a phone can.
 */
let world: World;
let controller: TurnController;
let gesture: HoldOrLatch;
let time: number;
let win: EventTarget;
let doc: EventTarget & { visibilityState: DocumentVisibilityState };

beforeEach(() => {
  vi.useFakeTimers();
  time = 0;
  world = new World();
  controller = new TurnController({ client: world.client, capture: world.capture, playback: world.playback });
  controller.handleConnection({ status: 'ready', sessionId: 's', maxUtteranceSeconds: 20, maxSessionMinutes: 10, rttMs: 1 });
  gesture = new HoldOrLatch(
    {
      onStart: () => controller.press(),
      onLatch: () => controller.latch(),
      onStop: (reason) => (reason === 'abort' ? controller.cancel() : controller.release()),
    },
    () => time,
  );
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  bindPageGuards(gesture, doc as unknown as Document, win as unknown as Window);
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the gate after a normal press', () => {
  it('is open while held and closed after release, then ptt_end follows', async () => {
    gesture.pointerDown(1);
    expect(world.gateOpen).toBe(true);
    time += 800;
    gesture.pointerUp(1);
    await settle();
    expect(world.gateOpen).toBe(false);
    expect(world.sent.map((m) => m.type)).toEqual(['ptt_start', 'ptt_end']);
  });

  it('stays open while latched and closes on the next tap', async () => {
    gesture.pointerDown(1);
    time += 100;
    gesture.pointerUp(1);
    await settle();
    expect(world.gateOpen).toBe(true);
    expect(controller.state.mode).toBe('latched');
    gesture.pointerDown(2);
    await settle();
    expect(world.gateOpen).toBe(false);
    expect(controller.state.phase).toBe('finishing');
  });
});

describe('the gate after something goes wrong', () => {
  it('closes on pointer cancel, and the turn is discarded rather than sent', async () => {
    gesture.pointerDown(1);
    gesture.pointerCancel(1);
    await settle();
    expect(world.gateOpen).toBe(false);
    expect(world.sent.map((m) => m.type)).toEqual(['ptt_start', 'interrupt']);
    expect(controller.state.phase).toBe('idle');
  });

  it('closes when the window loses focus mid-hold', async () => {
    gesture.pointerDown(1);
    win.dispatchEvent(new Event('blur'));
    await settle();
    expect(world.gateOpen).toBe(false);
    expect(controller.state.phase).toBe('idle');
  });

  it('closes when the page is hidden mid-hold', async () => {
    gesture.pointerDown(1);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(world.gateOpen).toBe(false);
  });

  it('closes a latched recording when the page is hidden', async () => {
    gesture.pointerDown(1);
    time += 100;
    gesture.pointerUp(1);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(world.gateOpen).toBe(false);
  });

  it('closes when the page is put in the back/forward cache', async () => {
    gesture.pointerDown(1);
    win.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(world.gateOpen).toBe(false);
  });

  it('closes by itself if the finger is never lifted and nothing else fires', async () => {
    gesture.pointerDown(1);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(world.gateOpen).toBe(false);
    expect(controller.state.phase).toBe('finishing');
  });

  it('sends no audio after the page was hidden', async () => {
    gesture.pointerDown(1);
    controller.handleFrame(new ArrayBuffer(1024));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    controller.handleFrame(new ArrayBuffer(1024));
    expect(world.audio).toHaveLength(1);
  });

  it('can record again right after an abort', async () => {
    gesture.pointerDown(1);
    win.dispatchEvent(new Event('blur'));
    await settle();
    gesture.pointerDown(2);
    expect(world.gateOpen).toBe(true);
    expect(world.sent.map((m) => m.type)).toEqual(['ptt_start', 'interrupt', 'ptt_start']);
  });
});
