import { describe, expect, it } from 'vitest';
import { LinearResampler } from './resampler';
import { amplitudeAt, seeded, sine, toInt16 } from './testUtils';

function resample(src: Int16Array, from: number, to: number, chunker?: () => number): Float32Array {
  const r = new LinearResampler(from, to);
  const out = new Float32Array(r.maxOutputFor(src.length) + 8);
  let written = 0;
  if (chunker === undefined) return out.slice(0, r.process(src, 0, src.length, out, 0));
  for (let offset = 0; offset < src.length; ) {
    const n = Math.min(src.length - offset, Math.max(1, Math.floor(chunker() * 500)));
    written += r.process(src, offset, n, out, written);
    offset += n;
  }
  return out.slice(0, written);
}

describe('LinearResampler', () => {
  const tone = toInt16(sine(440, 24000, 24000), 16000);

  it.each([48000, 44100, 24000, 16000])('keeps a 440 Hz tone intact at %i Hz', (to) => {
    const out = resample(tone, 24000, to);
    expect(out.length).toBeGreaterThan((to * 0.99) | 0);
    const amplitude = amplitudeAt(out, 440, to, 100);
    expect(Math.abs(amplitude - 16000 / 32768)).toBeLessThan(0.01);
  });

  // The read position is a double carried across chunks, so results can differ in the last
  // float32 bit; what matters is no glitch (a dropped or repeated sample would be ~1e-1).
  it.each([48000, 44100])('is continuous across chunk boundaries (to %i Hz)', (to) => {
    const whole = resample(tone, 24000, to);
    const pieces = resample(tone, 24000, to, seeded(3));
    expect(pieces.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(pieces[i]).toBeCloseTo(whole[i] as number, 5);
  });

  it('survives single-sample chunks', () => {
    const short = tone.slice(0, 600);
    const whole = resample(short, 24000, 44100);
    const bytes = resample(short, 24000, 44100, () => 0); // one sample per call
    expect(bytes.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(bytes[i]).toBeCloseTo(whole[i] as number, 5);
  });

  it('can be restarted at a new source rate', () => {
    const r = new LinearResampler(24000, 48000);
    const out = new Float32Array(64);
    r.process(Int16Array.from([1000, 2000, 3000]), 0, 3, out, 0);
    r.reset(16000);
    const n = r.process(Int16Array.from([0, 3276, 6552, 9828]), 0, 4, out, 0);
    expect(n).toBe(9); // 16 kHz to 48 kHz: three outputs per source sample, last interval open
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(3276 / 3 / 32768, 5);
  });
});
