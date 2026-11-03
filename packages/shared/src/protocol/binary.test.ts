import { describe, expect, it } from 'vitest';
import { decodeTtsFrame, encodeTtsFrame, isValidAudioFrame, writeTtsHeader } from './binary';
import {
  AUDIO_FRAME_BYTES,
  AUDIO_FRAME_MS,
  AUDIO_FRAME_SAMPLES,
  AUDIO_SAMPLE_RATE,
  TTS_FRAME_TYPE,
  TTS_HEADER_BYTES,
} from './constants';
import { TIMING_SPANS } from './timing';

const pcm = (...samples: number[]) => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return bytes;
};

describe('audio frame constants', () => {
  it('describes 512 samples of 16-bit PCM at 16 kHz (32 ms)', () => {
    expect(AUDIO_FRAME_SAMPLES).toBe(512);
    expect(AUDIO_FRAME_BYTES).toBe(1024);
    expect(AUDIO_SAMPLE_RATE).toBe(16000);
    expect(AUDIO_FRAME_MS).toBe(32);
  });
});

describe('isValidAudioFrame', () => {
  it('accepts exactly 1,024 bytes in any binary container', () => {
    expect(isValidAudioFrame(new Uint8Array(1024))).toBe(true);
    expect(isValidAudioFrame(new ArrayBuffer(1024))).toBe(true);
    expect(isValidAudioFrame(new Int16Array(512))).toBe(true);
    expect(isValidAudioFrame(Buffer.alloc(1024))).toBe(true);
  });

  it.each([0, 1, 1023, 1025, 2048])('rejects %i bytes', (size) => {
    expect(isValidAudioFrame(new Uint8Array(size))).toBe(false);
  });
});

describe('TTS frame header', () => {
  it('writes the tag then the turn ID big-endian', () => {
    const frame = encodeTtsFrame(0x01020304, pcm(1));
    expect(Array.from(frame.subarray(0, TTS_HEADER_BYTES))).toEqual([TTS_FRAME_TYPE, 1, 2, 3, 4]);
  });

  it('round-trips turn IDs including the extremes', () => {
    for (const turnId of [0, 1, 255, 256, 65_535, 65_536, 0x7fff_ffff, 0xffff_ffff]) {
      const decoded = decodeTtsFrame(encodeTtsFrame(turnId, pcm(100, -100)));
      expect(decoded?.turnId).toBe(turnId);
    }
  });

  it('round-trips the PCM payload byte for byte', () => {
    const original = pcm(0, 1, -1, 32767, -32768);
    const decoded = decodeTtsFrame(encodeTtsFrame(9, original));
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!.pcm)).toEqual(Array.from(original));
  });

  it('decodes without copying: the PCM is a view over the input buffer', () => {
    const frame = encodeTtsFrame(5, pcm(1, 2, 3));
    const decoded = decodeTtsFrame(frame);
    expect(decoded!.pcm.buffer).toBe(frame.buffer);
    expect(decoded!.pcm.byteOffset).toBe(TTS_HEADER_BYTES);
  });

  it('decodes a plain ArrayBuffer and a view with a non-zero offset', () => {
    const frame = encodeTtsFrame(77, pcm(4, 5));
    expect(decodeTtsFrame(frame.buffer as ArrayBuffer)?.turnId).toBe(77);

    const padded = new Uint8Array(frame.byteLength + 6);
    padded.set(frame, 3);
    const view = padded.subarray(3, 3 + frame.byteLength);
    const decoded = decodeTtsFrame(view);
    expect(decoded?.turnId).toBe(77);
    expect(decoded?.pcm.byteLength).toBe(4);
  });

  it('writeTtsHeader fills reserved headroom so no per-chunk allocation is needed', () => {
    const reusable = new Uint8Array(TTS_HEADER_BYTES + 4);
    reusable.set(pcm(10, 20), TTS_HEADER_BYTES);
    writeTtsHeader(reusable, 1234);
    const decoded = decodeTtsFrame(reusable);
    expect(decoded?.turnId).toBe(1234);
    expect(Array.from(decoded!.pcm)).toEqual(Array.from(pcm(10, 20)));
  });

  it('returns null (never throws) for malformed frames', () => {
    expect(decodeTtsFrame(new Uint8Array(0))).toBeNull();
    expect(decodeTtsFrame(new Uint8Array(3))).toBeNull();
    expect(decodeTtsFrame(new Uint8Array([TTS_FRAME_TYPE, 0, 0, 0, 1]))).toBeNull(); // header only
    expect(decodeTtsFrame(new Uint8Array([0x02, 0, 0, 0, 1, 0, 0]))).toBeNull(); // wrong tag
    expect(decodeTtsFrame(new Uint8Array([TTS_FRAME_TYPE, 0, 0, 0, 1, 0]))).toBeNull(); // odd PCM
  });

  it('rejects invalid turn IDs when encoding', () => {
    expect(() => encodeTtsFrame(-1, pcm(1))).toThrow(RangeError);
    expect(() => encodeTtsFrame(0x1_0000_0000, pcm(1))).toThrow(RangeError);
    expect(() => encodeTtsFrame(1.5, pcm(1))).toThrow(RangeError);
    expect(() => writeTtsHeader(new Uint8Array(2), 1)).toThrow(RangeError);
  });
});

describe('timing span names', () => {
  it('lists the agreed spans exactly once each, in order', () => {
    expect([...TIMING_SPANS]).toEqual([
      'press',
      'first_frame_sent',
      'release',
      'commit_sent',
      'processing',
      'transcript',
      'rules_done',
      'llm_done',
      'draft',
      'tts_request',
      'tts_first_chunk',
      'tts_start_received',
      'first_audible',
    ]);
    expect(new Set(TIMING_SPANS).size).toBe(TIMING_SPANS.length);
  });
});
