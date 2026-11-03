import { readFileSync } from 'node:fs';

export const STT_FRAME_BYTES = 1024;
export const STT_SAMPLE_RATE = 16_000;

export class WavError extends Error {}

/** Reads a 16 kHz mono 16-bit PCM WAV and returns its samples, zero-padded to whole 1,024-byte frames. */
export function readClipPcm(path: string): Buffer {
  const file = readFileSync(path);
  if (file.length < 44 || file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new WavError('not a RIFF/WAVE file');
  }
  let offset = 12;
  let format: { channels: number; rate: number; bits: number; tag: number } | null = null;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        tag: file.readUInt16LE(body),
        channels: file.readUInt16LE(body + 2),
        rate: file.readUInt32LE(body + 4),
        bits: file.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format) throw new WavError('data chunk before fmt chunk');
      if (format.tag !== 1 || format.channels !== 1 || format.rate !== STT_SAMPLE_RATE || format.bits !== 16) {
        throw new WavError(
          `need 16 kHz mono 16-bit PCM, got ${format.rate} Hz, ${format.channels} ch, ${format.bits}-bit`,
        );
      }
      const data = file.subarray(body, Math.min(body + size, file.length));
      const frames = Math.ceil(data.length / STT_FRAME_BYTES);
      const padded = Buffer.alloc(frames * STT_FRAME_BYTES);
      data.copy(padded);
      return padded;
    }
    offset = body + size + (size % 2);
  }
  throw new WavError('no data chunk');
}

/** Wraps raw 16-bit mono PCM in a WAV header so a human can listen to it. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function clipSeconds(pcm: Buffer): number {
  return pcm.length / 2 / STT_SAMPLE_RATE;
}
