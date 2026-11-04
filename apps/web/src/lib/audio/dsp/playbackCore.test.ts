import { describe, expect, it } from 'vitest';
import { PlaybackCore, type PlaybackEvents } from './playbackCore';
import { amplitudeAt, sine, toInt16 } from './testUtils';

const RATE = 48000;
const QUANTUM = 128;

function harness(prefillMs = 80) {
  const log: string[] = [];
  const started: { turnId: number; time: number }[] = [];
  const events: PlaybackEvents = {
    started: (turnId, time) => {
      log.push(`started:${turnId}`);
      started.push({ turnId, time });
    },
    finished: (turnId) => log.push(`finished:${turnId}`),
  };
  const core = new PlaybackCore(RATE, events, { prefillMs });
  let time = 0;
  /** Renders `quanta` render quanta and returns everything that was output. */
  const render = (quanta: number): Float32Array => {
    const out = new Float32Array(quanta * QUANTUM);
    for (let q = 0; q < quanta; q++) {
      core.render(out.subarray(q * QUANTUM, (q + 1) * QUANTUM), time);
      time += QUANTUM / RATE;
    }
    return out;
  };
  const tone = (ms: number, rate = 24000) => toInt16(sine(440, rate, Math.round((rate * ms) / 1000)));
  return { core, log, started, render, tone };
}

describe('PlaybackCore', () => {
  it('outputs silence and waits for the prefill before starting', () => {
    const h = harness(80);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(40));
    expect(h.render(10).every((v) => v === 0)).toBe(true);
    expect(h.log).toEqual([]);
    h.core.pushPcm(1, h.tone(60)); // now 100 ms buffered
    const out = h.render(4);
    expect(h.log).toEqual(['started:1']);
    expect(out.some((v) => v !== 0)).toBe(true);
  });

  it('reports the time of the first played sample', () => {
    const h = harness(20);
    h.core.begin(7, 24000);
    h.render(3);
    h.core.pushPcm(7, h.tone(100));
    h.render(1);
    expect(h.started).toHaveLength(1);
    expect(h.started[0]?.time).toBeCloseTo((3 * QUANTUM) / RATE, 9);
  });

  it('plays a resampled tone at the right pitch and level', () => {
    const h = harness(20);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(500));
    const out = h.render(Math.ceil((RATE * 0.4) / QUANTUM));
    expect(Math.abs(amplitudeAt(out, 440, RATE, 200) - 16000 / 32768)).toBeLessThan(0.01);
  });

  it('counts an underrun, outputs silence, and rebuffers before resuming', () => {
    const h = harness(40);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(60));
    h.render(Math.ceil((RATE * 0.06) / QUANTUM) + 2); // drain it all
    expect(h.core.underruns).toBe(1);
    h.core.pushPcm(1, h.tone(10)); // below the prefill: still waiting
    expect(h.render(4).every((v) => v === 0)).toBe(true);
    h.core.pushPcm(1, h.tone(50));
    expect(h.render(2).some((v) => v !== 0)).toBe(true);
    expect(h.core.underruns).toBe(1);
  });

  it('plays a short remainder after end and then reports it finished, with no underrun', () => {
    const h = harness(80);
    h.core.begin(2, 24000);
    h.core.pushPcm(2, h.tone(30)); // less than the prefill
    h.core.end(2);
    const out = h.render(40);
    expect(out.some((v) => v !== 0)).toBe(true);
    expect(h.log).toEqual(['started:2', 'finished:2']);
    expect(h.core.underruns).toBe(0);
    expect(h.core.activeTurn).toBe(-1);
  });

  it('ignores audio for a turn that is not active', () => {
    const h = harness(20);
    h.core.begin(5, 24000);
    expect(h.core.pushPcm(4, h.tone(100))).toBe(0);
    expect(h.core.pushPcm(6, h.tone(100))).toBe(0);
    h.core.end(4);
    expect(h.core.bufferedMs).toBe(0);
    expect(h.render(8).every((v) => v === 0)).toBe(true);
  });

  it('drops the previous turn when a new one begins', () => {
    const h = harness(20);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(300));
    h.render(2);
    h.core.begin(2, 24000);
    expect(h.core.bufferedMs).toBe(0);
    expect(h.core.pushPcm(1, h.tone(50))).toBe(0);
  });

  it('keeps the buffered audio when the same turn begins again', () => {
    const h = harness(20);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(100));
    const before = h.core.bufferedMs;
    h.core.begin(1, 24000);
    expect(h.core.bufferedMs).toBe(before);
  });

  it('flushes instantly: nothing but a two-millisecond fade comes out afterwards', () => {
    const h = harness(20);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(500));
    h.render(10);
    h.core.flush();
    expect(h.core.bufferedMs).toBe(0);
    const tail = h.render(4);
    const fadeSamples = Math.round(RATE * 0.002);
    expect(tail.subarray(fadeSamples).every((v) => v === 0)).toBe(true);
    expect(tail.subarray(0, fadeSamples).some((v) => v !== 0)).toBe(true);
    // The fade starts from the last played sample and only goes down.
    expect(Math.abs(tail[fadeSamples - 1] as number)).toBeLessThan(0.01);
  });

  it('accepts new audio right after a flush', () => {
    const h = harness(20);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(200));
    h.core.flush();
    expect(h.core.pushPcm(1, h.tone(100))).toBe(0); // old turn is gone
    h.core.begin(2, 24000);
    h.core.pushPcm(2, h.tone(100));
    expect(h.render(8).some((v) => v !== 0)).toBe(true);
  });

  it('counts source samples it had no room for', () => {
    const h = harness(20);
    h.core.begin(1, 24000);
    const accepted = h.core.pushPcm(1, h.tone(3000)); // the ring holds two seconds
    expect(accepted).toBeLessThan(24000 * 3);
    expect(h.core.overflowed).toBeGreaterThan(0);
    expect(h.core.bufferedMs).toBeLessThanOrEqual(h.core.capacityMs);
  });

  it('allows the prefill to be changed on the fly', () => {
    const h = harness(200);
    h.core.begin(1, 24000);
    h.core.pushPcm(1, h.tone(60));
    h.core.setPrefillMs(40);
    expect(h.render(2).some((v) => v !== 0)).toBe(true);
  });
});
