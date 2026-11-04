import { describe, expect, it } from 'vitest';
import { AUDIO_FRAME_BYTES, AUDIO_FRAME_SAMPLES } from '@bolbill/shared';
import { CaptureCore, type CaptureSink } from './captureCore';
import { amplitudeAt, sine } from './testUtils';

function harness(rate: number) {
  const frames: Int16Array[] = [];
  const levels: number[] = [];
  const sink: CaptureSink = {
    acquire: () => new Int16Array(AUDIO_FRAME_SAMPLES),
    emit: (frame) => frames.push(frame),
    level: (rms) => levels.push(rms),
  };
  const core = new CaptureCore(rate, sink);
  /** Feeds `seconds` of a tone in 128-sample render quanta, like the real worklet. */
  const feed = (signal: Float32Array) => {
    for (let i = 0; i + 128 <= signal.length; i += 128) core.process(signal.subarray(i, i + 128));
  };
  return { core, frames, levels, feed };
}

describe.each([48000, 44100, 16000])('CaptureCore at %i Hz', (rate) => {
  it('sends nothing while the gate is closed, but keeps the level meter alive', () => {
    const { frames, levels, feed } = harness(rate);
    feed(sine(440, rate, rate, 0.5));
    expect(frames).toHaveLength(0);
    // At most every ~50 ms; render quanta of 128 samples make the real spacing a little longer.
    expect(levels.length).toBeGreaterThanOrEqual(15);
    expect(levels.length).toBeLessThanOrEqual(21);
    expect(levels[3]).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('emits only exact 1,024-byte frames while the gate is open', () => {
    const { core, frames, feed } = harness(rate);
    core.setGate(true);
    feed(sine(1000, rate, rate));
    core.setGate(false);
    expect(frames.length).toBeGreaterThanOrEqual(30);
    expect(frames.length).toBeLessThanOrEqual(33);
    for (const frame of frames) {
      expect(frame.length).toBe(AUDIO_FRAME_SAMPLES);
      expect(frame.byteLength).toBe(AUDIO_FRAME_BYTES);
    }
  });

  it('carries the tone through at the right frequency and level', () => {
    const { core, frames, feed } = harness(rate);
    core.setGate(true);
    feed(sine(1000, rate, rate, 0.5));
    core.setGate(false);
    // Skip the zero-padded last frame; it would dilute the measurement.
    const all = Int16Array.from(frames.slice(0, -1).flatMap((f) => Array.from(f)));
    const amplitude = amplitudeAt(all, 1000, 16000, 512) / 32767;
    expect(Math.abs(amplitude - 0.5)).toBeLessThan(0.01);
  });

  it('pads and emits the last partial frame when the gate closes', () => {
    const { core, frames, feed } = harness(rate);
    core.setGate(true);
    feed(sine(1000, rate, 128 * Math.round((rate * 0.1) / 128))); // a little over 3 frames
    const before = frames.length;
    core.setGate(false);
    expect(frames.length).toBe(before + 1);
    expect(frames.at(-1)?.[AUDIO_FRAME_SAMPLES - 1]).toBe(0);
  });

  it('emits nothing on close when no samples are pending', () => {
    const { core, frames } = harness(rate);
    core.setGate(true);
    core.setGate(false);
    expect(frames).toHaveLength(0);
  });
});

it('starts a fresh stream each time the gate opens', () => {
  const { core, frames, feed } = harness(48000);
  core.setGate(true);
  feed(sine(1000, 48000, 4800));
  core.setGate(false);
  const first = frames.length;
  core.setGate(true);
  feed(new Float32Array(2048));
  core.setGate(false);
  const reopened = frames.slice(first);
  expect(reopened.length).toBeGreaterThan(0);
  expect(reopened[0]?.every((v) => v === 0)).toBe(true); // no leftover from the previous press
});

it('ignores repeated gate commands', () => {
  const { core, frames, feed } = harness(48000);
  core.setGate(true);
  core.setGate(true);
  feed(sine(1000, 48000, 4800));
  core.setGate(false);
  core.setGate(false);
  const count = frames.length;
  core.setGate(false);
  expect(frames).toHaveLength(count);
});
