import { describe, expect, it } from 'vitest';
import { HOLD_THRESHOLD_MS, HoldOrLatch, bindPageGuards, type StopReason } from './holdOrLatch';

function setup() {
  let time = 0;
  const calls: string[] = [];
  const gesture = new HoldOrLatch(
    {
      onStart: () => calls.push('start'),
      onLatch: () => calls.push('latch'),
      onStop: (reason: StopReason) => calls.push(`stop:${reason}`),
    },
    () => time,
  );
  return { gesture, calls, wait: (ms: number) => (time += ms) };
}

describe('hold to talk', () => {
  it('starts on press and stops on release after a hold', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    wait(HOLD_THRESHOLD_MS + 100);
    gesture.pointerUp(1);
    expect(calls).toEqual(['start', 'stop:release']);
    expect(gesture.active).toBe(false);
  });

  it('treats exactly the threshold as a hold', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    wait(HOLD_THRESHOLD_MS);
    gesture.pointerUp(1);
    expect(calls).toEqual(['start', 'stop:release']);
  });

  it('can be used again straight away', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    wait(900);
    gesture.pointerUp(1);
    gesture.pointerDown(2);
    wait(900);
    gesture.pointerUp(2);
    expect(calls).toEqual(['start', 'stop:release', 'start', 'stop:release']);
  });
});

describe('tap to latch', () => {
  it('latches on a short tap and stops on the next tap, ignoring that tap\'s release', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    wait(120);
    gesture.pointerUp(1);
    expect(calls).toEqual(['start', 'latch']);
    expect(gesture.active).toBe(true);
    expect(gesture.latched).toBe(true);

    wait(5000);
    gesture.pointerDown(2);
    expect(calls).toEqual(['start', 'latch', 'stop:tap']);
    expect(gesture.active).toBe(false);
    wait(50);
    gesture.pointerUp(2);
    expect(calls).toEqual(['start', 'latch', 'stop:tap']); // the release started nothing new
  });

  it('starts a fresh turn on the tap after that', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    gesture.pointerUp(1);
    gesture.pointerDown(2);
    gesture.pointerUp(2);
    wait(10);
    gesture.pointerDown(3);
    expect(calls).toEqual(['start', 'latch', 'stop:tap', 'start']);
  });

  it('lets a long second touch stop the latched turn too', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    gesture.pointerUp(1);
    gesture.pointerDown(2);
    wait(2000);
    gesture.pointerUp(2);
    expect(calls).toEqual(['start', 'latch', 'stop:tap']);
  });
});

describe('interruptions never leave a turn running', () => {
  it('aborts when the pointer is cancelled mid-hold', () => {
    const { gesture, calls } = setup();
    gesture.pointerDown(1);
    gesture.pointerCancel(1);
    expect(calls).toEqual(['start', 'stop:abort']);
    expect(gesture.active).toBe(false);
  });

  it('ignores the release that may still arrive after a cancel', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    gesture.pointerCancel(1);
    wait(1000);
    gesture.pointerUp(1);
    expect(calls).toEqual(['start', 'stop:abort']);
  });

  it('aborts a latched turn', () => {
    const { gesture, calls } = setup();
    gesture.pointerDown(1);
    gesture.pointerUp(1);
    gesture.abort();
    expect(calls).toEqual(['start', 'latch', 'stop:abort']);
    expect(gesture.active).toBe(false);
  });

  it('aborts only once, however often it is asked', () => {
    const { gesture, calls } = setup();
    gesture.pointerDown(1);
    gesture.abort();
    gesture.abort();
    gesture.pointerCancel(1);
    expect(calls).toEqual(['start', 'stop:abort']);
  });

  it('does nothing when idle', () => {
    const { gesture, calls } = setup();
    gesture.abort();
    gesture.pointerCancel(1);
    gesture.pointerUp(1);
    expect(calls).toEqual([]);
  });

  it('is idle again after an abort, ready for the next press', () => {
    const { gesture, calls } = setup();
    gesture.pointerDown(1);
    gesture.abort();
    gesture.pointerDown(2);
    expect(calls).toEqual(['start', 'stop:abort', 'start']);
  });

  it('a lost-capture style cancel after a normal release does nothing', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    wait(800);
    gesture.pointerUp(1);
    gesture.pointerCancel(1);
    expect(calls).toEqual(['start', 'stop:release']);
  });
});

describe('multi-touch and keyboard', () => {
  it('ignores a second finger and a release from a finger that is not the one holding', () => {
    const { gesture, calls, wait } = setup();
    gesture.pointerDown(1);
    gesture.pointerDown(2);
    gesture.pointerUp(2);
    gesture.pointerCancel(2);
    wait(900);
    expect(gesture.active).toBe(true);
    gesture.pointerUp(1);
    expect(calls).toEqual(['start', 'stop:release']);
  });

  it('works from the keyboard and ignores auto-repeat', () => {
    const { gesture, calls, wait } = setup();
    gesture.keyDown(false);
    gesture.keyDown(true);
    gesture.keyDown(true);
    wait(900);
    gesture.keyUp();
    expect(calls).toEqual(['start', 'stop:release']);
  });
});

describe('page guards', () => {
  function page() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    return { doc, win };
  }
  const bind = (gesture: HoldOrLatch, p: ReturnType<typeof page>) =>
    bindPageGuards(gesture, p.doc as unknown as Document, p.win as unknown as Window);

  it.each(['blur', 'pagehide'])('aborts on window %s', (name) => {
    const { gesture, calls } = setup();
    const p = page();
    bind(gesture, p);
    gesture.pointerDown(1);
    p.win.dispatchEvent(new Event(name));
    expect(calls).toEqual(['start', 'stop:abort']);
  });

  it('aborts when the page becomes hidden, but not when it becomes visible', () => {
    const { gesture, calls } = setup();
    const p = page();
    bind(gesture, p);
    gesture.pointerDown(1);
    p.doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual(['start']);
    p.doc.visibilityState = 'hidden';
    p.doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual(['start', 'stop:abort']);
  });

  it('aborts a latched turn when the window loses focus', () => {
    const { gesture, calls } = setup();
    const p = page();
    bind(gesture, p);
    gesture.pointerDown(1);
    gesture.pointerUp(1);
    p.win.dispatchEvent(new Event('blur'));
    expect(calls).toEqual(['start', 'latch', 'stop:abort']);
  });

  it('stops listening once disposed', () => {
    const { gesture, calls } = setup();
    const p = page();
    const dispose = bind(gesture, p);
    dispose();
    gesture.pointerDown(1);
    p.win.dispatchEvent(new Event('blur'));
    expect(calls).toEqual(['start']);
  });
});
