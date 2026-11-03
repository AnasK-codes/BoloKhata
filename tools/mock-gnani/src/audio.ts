/** Tiny PCM helpers shared by the mocks and by tests that need to feed them. */

export const STT_FRAME_BYTES = 1024;
export const STT_FRAME_SAMPLES = 512;

/** One 1,024-byte frame of a loud sine tone (counts as speech for the mock VAD). */
export function speechFrame(amplitude = 6000, frequencyHz = 220, sampleRate = 16_000): Uint8Array {
  const frame = new Uint8Array(STT_FRAME_BYTES);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < STT_FRAME_SAMPLES; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate));
    view.setInt16(i * 2, sample, true);
  }
  return frame;
}

/** One 1,024-byte frame of digital silence. */
export function silenceFrame(): Uint8Array {
  return new Uint8Array(STT_FRAME_BYTES);
}

/** Root-mean-square of a 16-bit little-endian PCM buffer, on the int16 scale (0 to 32768). */
export function rmsOfPcm16(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = Math.floor(pcm.byteLength / 2);
  if (samples === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / samples);
}

/** Fills `out` with a 440 Hz sine, continuing from absolute sample index `startSample`. */
export function writeSine(
  out: Uint8Array,
  startSample: number,
  sampleRate: number,
  amplitude = 8000,
  frequencyHz = 440,
): void {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const samples = Math.floor(out.byteLength / 2);
  for (let i = 0; i < samples; i++) {
    const sample = Math.round(
      amplitude * Math.sin((2 * Math.PI * frequencyHz * (startSample + i)) / sampleRate),
    );
    view.setInt16(i * 2, sample, true);
  }
}

/** 44-byte canonical WAV header for mono 16-bit PCM. */
export function wavHeader(dataBytes: number, sampleRate: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}
