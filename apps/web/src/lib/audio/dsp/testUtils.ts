/** Signal helpers shared by the DSP tests. */

export function sine(freq: number, rate: number, length: number, amplitude = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

/** Amplitude of the `freq` component (a single-bin DFT), ignoring the first `skip` samples. */
export function amplitudeAt(samples: ArrayLike<number>, freq: number, rate: number, skip = 0): number {
  let re = 0;
  let im = 0;
  const n = samples.length - skip;
  for (let i = skip; i < samples.length; i++) {
    const w = (2 * Math.PI * freq * i) / rate;
    re += (samples[i] as number) * Math.cos(w);
    im -= (samples[i] as number) * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / n;
}

/** A tiny deterministic generator so "random" chunk sizes are reproducible. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export function toInt16(samples: Float32Array, gain = 16000): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.round((samples[i] as number) * gain);
  return out;
}
