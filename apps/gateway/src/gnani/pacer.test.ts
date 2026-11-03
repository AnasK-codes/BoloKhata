import { describe, expect, it } from 'vitest';
import { AUDIO_FRAME_BYTES } from '@bolbill/shared';
import { Pacer, type Clock } from './pacer';

/** Deterministic clock: time only moves when the test says so, timers fire in order. */
class FakeClock implements Clock {
  private ns = 1_000_000_000n;
  private timers: { at: bigint; fn: () => void; id: number }[] = [];
  private nextId = 1;

  nowNs(): bigint {
    return this.ns;
  }
  setTimer(fn: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.ns + BigInt(Math.round(delayMs * 1e6)), fn, id });
    return id;
  }
  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  get pending(): number {
    return this.timers.length;
  }
  advance(ms: number): void {
    const target = this.ns + BigInt(Math.round(ms * 1e6));
    for (;;) {
      this.timers.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.ns = next.at;
      next.fn();
    }
    this.ns = target;
  }
}

function frame(marker: number): Uint8Array {
  const f = new Uint8Array(AUDIO_FRAME_BYTES);
  f[0] = marker;
  return f;
}

function setup(drain: 'paced' | 'burst' = 'paced', capacityFrames?: number) {
  const clock = new FakeClock();
  const pacer = new Pacer({ clock, drain, ...(capacityFrames ? { capacityFrames } : {}) });
  const sent: { marker: number; atMs: number }[] = [];
  const start = clock.nowNs();
  pacer.setSink((f) => sent.push({ marker: f[0]!, atMs: Number(clock.nowNs() - start) / 1e6 }));
  return { clock, pacer, sent };
}

describe('Pacer cadence', () => {
  it('sends the first frame immediately and the rest 32 ms apart', () => {
    const { clock, pacer, sent } = setup();
    for (let i = 1; i <= 4; i++) pacer.push(frame(i));
    expect(sent.map((s) => s.marker)).toEqual([1]);
    clock.advance(200);
    expect(sent.map((s) => s.atMs)).toEqual([0, 32, 64, 96]);
    expect(sent.map((s) => s.marker)).toEqual([1, 2, 3, 4]);
  });

  it('absorbs a jittery arrival pattern into an even output', () => {
    const { clock, pacer, sent } = setup();
    // arrivals: a burst of 5, a stall, then a burst of 3
    for (let i = 1; i <= 5; i++) pacer.push(frame(i));
    clock.advance(400);
    for (let i = 6; i <= 8; i++) pacer.push(frame(i));
    clock.advance(400);
    const gaps = sent.slice(1).map((s, i) => s.atMs - sent[i]!.atMs);
    // within each burst the spacing is exactly one frame; the stall gap is the idle time
    expect(gaps.filter((g) => Math.abs(g - 32) < 0.01)).toHaveLength(6);
    expect(sent.map((s) => s.marker)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('does not drift: 100 frames take 99 intervals even when timers fire late', () => {
    const clock = new FakeClock();
    const pacer = new Pacer({ clock, drain: 'paced' });
    const times: number[] = [];
    const start = clock.nowNs();
    pacer.setSink(() => times.push(Number(clock.nowNs() - start) / 1e6));
    for (let i = 0; i < 100; i++) pacer.push(frame(i));
    // advance in coarse 40 ms steps so every timer fires late relative to its deadline
    for (let i = 0; i < 100; i++) clock.advance(40);
    expect(times).toHaveLength(100);
    // 99 * 32 = 3168 ms of schedule; the last send may be at most one coarse step late
    expect(times[99]!).toBeLessThanOrEqual(3168 + 40);
    expect(times[99]!).toBeGreaterThanOrEqual(3168);
  });

  it('does not burst after a long stall', () => {
    const { clock, pacer, sent } = setup();
    pacer.push(frame(1));
    clock.advance(1000); // long idle gap
    for (let i = 2; i <= 4; i++) pacer.push(frame(i));
    expect(sent.map((s) => s.marker)).toEqual([1, 2]);
    clock.advance(70);
    expect(sent.map((s) => s.marker)).toEqual([1, 2, 3, 4]);
  });
});

describe('Pacer backlog', () => {
  it('drops frames and counts them when the ring is full', () => {
    const { pacer } = setup('paced', 4);
    const results = Array.from({ length: 7 }, (_, i) => pacer.push(frame(i + 1)));
    // frame 1 leaves immediately, so 1 + 4 fit
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(pacer.framesDropped).toBe(2);
    expect(pacer.backlog).toBe(4);
  });

  it('keeps frame content intact through the ring across wrap-around', () => {
    const { clock, pacer, sent } = setup('paced', 3);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 3; i++) pacer.push(frame(round * 10 + i + 1));
      clock.advance(300);
    }
    expect(sent.map((s) => s.marker)).toEqual([1, 2, 3, 11, 12, 13, 21, 22, 23]);
  });

  it('pauses without a sink and resumes at cadence once one is set', () => {
    const clock = new FakeClock();
    const pacer = new Pacer({ clock, drain: 'paced' });
    const markers: number[] = [];
    for (let i = 1; i <= 3; i++) pacer.push(frame(i));
    clock.advance(500);
    expect(pacer.backlog).toBe(3);
    pacer.setSink((f) => markers.push(f[0]!));
    clock.advance(100);
    expect(markers).toEqual([1, 2, 3]);
  });

  it('reset empties the ring and cancels timers', () => {
    const { clock, pacer, sent } = setup();
    for (let i = 1; i <= 5; i++) pacer.push(frame(i));
    pacer.reset();
    expect(pacer.backlog).toBe(0);
    expect(clock.pending).toBe(0);
    clock.advance(500);
    expect(sent).toHaveLength(1);
  });
});

describe('Pacer drain on release', () => {
  it('calls done immediately when nothing is waiting', () => {
    const { pacer } = setup();
    pacer.push(frame(1)); // sent at once
    let done = 0;
    pacer.endUtterance(() => done++);
    expect(done).toBe(1);
  });

  it('paced drain keeps the cadence and calls done after the last frame', () => {
    const { clock, pacer, sent } = setup('paced');
    for (let i = 1; i <= 4; i++) pacer.push(frame(i));
    let doneAtFrames = -1;
    pacer.endUtterance(() => (doneAtFrames = sent.length));
    expect(doneAtFrames).toBe(-1);
    clock.advance(200);
    expect(doneAtFrames).toBe(4);
    expect(sent.map((s) => s.atMs)).toEqual([0, 32, 64, 96]);
  });

  it('burst drain sends the backlog at once, then calls done', () => {
    const { pacer, sent } = setup('burst');
    for (let i = 1; i <= 4; i++) pacer.push(frame(i));
    let doneAtFrames = -1;
    pacer.endUtterance(() => (doneAtFrames = sent.length));
    expect(doneAtFrames).toBe(4);
    expect(sent.every((s) => s.atMs === 0)).toBe(true);
  });

  it('waits for a sink before draining', () => {
    const clock = new FakeClock();
    const pacer = new Pacer({ clock, drain: 'paced' });
    pacer.push(frame(1));
    let done = false;
    pacer.endUtterance(() => (done = true));
    clock.advance(500);
    expect(done).toBe(false);
    const markers: number[] = [];
    pacer.setSink((f) => markers.push(f[0]!));
    clock.advance(10);
    expect(done).toBe(true);
    expect(markers).toEqual([1]);
  });

  it('reset discards a pending done callback', () => {
    const { clock, pacer } = setup();
    for (let i = 1; i <= 3; i++) pacer.push(frame(i));
    let done = false;
    pacer.endUtterance(() => (done = true));
    pacer.reset();
    clock.advance(500);
    expect(done).toBe(false);
  });
});
