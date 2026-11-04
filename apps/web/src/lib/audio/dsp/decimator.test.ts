import { describe, expect, it } from 'vitest';
import { Decimator } from './decimator';
import { amplitudeAt, seeded, sine } from './testUtils';

function run(input: Float32Array, inRate: number, chunker?: () => number): Float32Array {
  const d = new Decimator(inRate, 16000);
  const out = new Float32Array(d.maxOutputFor(input.length) + 16);
  let produced = 0;
  if (chunker === undefined) {
    produced = d.process(input, 0, input.length, out, 0);
  } else {
    for (let offset = 0; offset < input.length; ) {
      const n = Math.min(input.length - offset, Math.max(1, Math.floor(chunker() * 300)));
      produced += d.process(input, offset, n, out, produced);
      offset += n;
    }
  }
  return out.slice(0, produced);
}

describe.each([48000, 44100])('decimator from %i Hz', (inRate) => {
  const seconds = 1;
  const n = inRate * seconds;
  const skip = 400; // filter start-up

  it.each([300, 1000, 3000, 6000])('passes a %i Hz tone at unit gain', (freq) => {
    const out = run(sine(freq, inRate, n), inRate);
    expect(amplitudeAt(out, freq, 16000, skip)).toBeCloseTo(1, 1);
    expect(Math.abs(amplitudeAt(out, freq, 16000, skip) - 1)).toBeLessThan(0.02);
  });

  // Tones above 8 kHz fold into the band if not filtered: 9.5 kHz would appear at 6.5 kHz.
  it.each([
    [9500, 6500],
    [10000, 6000],
    [12000, 4000],
    [15000, 1000],
  ])('suppresses %i Hz so it does not alias to %i Hz', (freq, alias) => {
    const out = run(sine(freq, inRate, n), inRate);
    expect(amplitudeAt(out, alias, 16000, skip)).toBeLessThan(0.003); // below -50 dB
  });

  it('produces one output sample per 16 kHz tick', () => {
    const out = run(sine(1000, inRate, n), inRate);
    expect(out.length).toBeGreaterThan(16000 * seconds - 120);
    expect(out.length).toBeLessThanOrEqual(16000 * seconds);
  });

  it('has unit DC gain', () => {
    const out = run(new Float32Array(n).fill(0.5), inRate);
    for (let i = 400; i < out.length - 10; i++) expect(out[i]).toBeCloseTo(0.5, 4);
  });

  it('gives identical output however the input is chunked', () => {
    const input = sine(777, inRate, 20000);
    const whole = run(input, inRate);
    const pieces = run(input, inRate, seeded(7));
    expect(pieces.length).toBe(whole.length);
    expect(Array.from(pieces)).toEqual(Array.from(whole));
  });
});

it('handles input blocks larger than its working buffer', () => {
  const input = sine(1000, 48000, 5000);
  const whole = run(input, 48000);
  expect(Math.abs(amplitudeAt(whole, 1000, 16000, 400) - 1)).toBeLessThan(0.02);
});

it('restarts from silence after reset', () => {
  const d = new Decimator(48000, 16000);
  const out = new Float32Array(d.maxOutputFor(4800) + 4);
  d.process(sine(1000, 48000, 4800), 0, 4800, out, 0);
  d.reset();
  const n = d.process(new Float32Array(4800), 0, 4800, out, 0);
  for (let i = 0; i < n; i++) expect(out[i]).toBe(0);
});
