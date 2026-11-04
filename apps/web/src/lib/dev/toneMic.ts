import { AUDIO_FRAME_BYTES, AUDIO_FRAME_MS, AUDIO_FRAME_SAMPLES, AUDIO_SAMPLE_RATE } from '@bolbill/shared';
import type { MicPort } from '../session/createSession';
import type { MicState } from '../audio/micCapture';

/**
 * DEV ONLY, and always labelled in the UI: stands in for the microphone with a synthetic
 * 220 Hz tone, so the browser pipeline (gate, 1,024-byte frames, socket, gateway) can be
 * exercised on a machine with no usable microphone. It is not speech and must never be
 * presented as a real recording.
 */
export class ToneMic implements MicPort {
  private state: MicState = { status: 'off', live: false };
  private readonly listeners = new Set<(state: MicState) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private phase = 0;

  constructor(private readonly onFrame: (frame: ArrayBuffer) => void) {}

  getState(): MicState {
    return this.state;
  }

  subscribe(listener: (state: MicState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.set({ status: 'live', live: true });
  }

  openGate(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.onFrame(this.nextFrame()), AUDIO_FRAME_MS);
  }

  async closeGate(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private nextFrame(): ArrayBuffer {
    const buffer = new ArrayBuffer(AUDIO_FRAME_BYTES);
    const samples = new Int16Array(buffer);
    for (let i = 0; i < AUDIO_FRAME_SAMPLES; i++) {
      samples[i] = Math.round(6000 * Math.sin(this.phase));
      this.phase += (2 * Math.PI * 220) / AUDIO_SAMPLE_RATE;
    }
    return buffer;
  }

  private set(state: MicState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
