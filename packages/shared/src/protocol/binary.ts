import { AUDIO_FRAME_BYTES, MAX_TURN_ID, TTS_FRAME_TYPE, TTS_HEADER_BYTES } from './constants';

type BinaryInput = ArrayBuffer | ArrayBufferView;

function byteLengthOf(data: BinaryInput): number {
  return data.byteLength;
}

/** True when `data` is exactly one microphone frame (1,024 bytes). Anything else is dropped. */
export function isValidAudioFrame(data: BinaryInput): boolean {
  return byteLengthOf(data) === AUDIO_FRAME_BYTES;
}

/**
 * Writes the 5-byte TTS header into the start of `target`: the type tag, then the turn ID as a
 * big-endian uint32. Hot-path friendly: the gateway reserves 5 bytes of headroom in a reusable
 * buffer, writes PCM after it, and calls this instead of allocating a new frame per chunk.
 */
export function writeTtsHeader(target: Uint8Array, turnId: number): void {
  if (target.byteLength < TTS_HEADER_BYTES) {
    throw new RangeError('target too small for TTS header');
  }
  if (!Number.isInteger(turnId) || turnId < 0 || turnId > MAX_TURN_ID) {
    throw new RangeError('turnId must be an unsigned 32-bit integer');
  }
  target[0] = TTS_FRAME_TYPE;
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(1, turnId, false);
}

/** Convenience encoder: one allocation and one copy. Prefer `writeTtsHeader` on the hot path. */
export function encodeTtsFrame(turnId: number, pcm: Uint8Array): Uint8Array {
  const frame = new Uint8Array(TTS_HEADER_BYTES + pcm.byteLength);
  writeTtsHeader(frame, turnId);
  frame.set(pcm, TTS_HEADER_BYTES);
  return frame;
}

export interface DecodedTtsFrame {
  turnId: number;
  /**
   * Raw 16-bit little-endian PCM. A zero-copy view over the input buffer, starting at byte 5,
   * so it is NOT 2-byte aligned: read it with a DataView (or copy it) rather than `new Int16Array`.
   */
  pcm: Uint8Array;
}

/** Returns null for anything that is not a well-formed TTS frame. Never throws. */
export function decodeTtsFrame(data: BinaryInput): DecodedTtsFrame | null {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  if (bytes.byteLength <= TTS_HEADER_BYTES) return null; // header only, no audio
  if (bytes[0] !== TTS_FRAME_TYPE) return null;
  const pcmBytes = bytes.byteLength - TTS_HEADER_BYTES;
  if (pcmBytes % 2 !== 0) return null; // 16-bit samples come in pairs of bytes

  const turnId = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, false);
  return { turnId, pcm: bytes.subarray(TTS_HEADER_BYTES) };
}
