import { AUDIO_FRAME_SAMPLES } from '@bolbill/shared';
import { CaptureCore, type CaptureSink } from '../dsp/captureCore';
import type { CaptureCommand, CaptureEvent } from './messages';

/** Frame buffers are recycled, so the steady state allocates nothing in process(). */
const POOL_SIZE = 16;
const POOL_MAX = 32;

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly pool: Int16Array[] = [];
  private overruns = 0;
  private readonly core: CaptureCore;

  constructor() {
    super();
    for (let i = 0; i < POOL_SIZE; i++) this.pool.push(new Int16Array(AUDIO_FRAME_SAMPLES));

    const sink: CaptureSink = {
      acquire: () => {
        const frame = this.pool.pop();
        if (frame !== undefined) return frame;
        // The main thread stopped returning buffers (it is stalled). Allocating beats dropping audio.
        this.overruns++;
        return new Int16Array(AUDIO_FRAME_SAMPLES);
      },
      emit: (frame) => this.post(frame.buffer as ArrayBuffer, true),
      level: (rms) => this.send({ type: 'level', rms, overruns: this.overruns }),
    };
    this.core = new CaptureCore(sampleRate, sink);

    this.port.onmessage = (event: MessageEvent<CaptureCommand>) => {
      const message = event.data;
      if (message.type === 'gate') {
        this.core.setGate(message.open);
        this.send({ type: 'gate_ack', open: message.open, seq: message.seq });
      } else if (this.pool.length < POOL_MAX) {
        this.pool.push(new Int16Array(message.buffer));
      }
    };
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel !== undefined) this.core.process(channel);
    return true;
  }

  private post(buffer: ArrayBuffer, transfer: boolean): void {
    this.port.postMessage(buffer, transfer ? [buffer] : []);
  }

  private send(event: CaptureEvent): void {
    this.port.postMessage(event);
  }
}

registerProcessor('bolbill-capture', CaptureProcessor);
