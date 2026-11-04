import { PlaybackCore } from '../dsp/playbackCore';
import type { PlaybackCommand, PlaybackEvent } from './messages';

const STATS_EVERY_MS = 50;

class PlaybackProcessor extends AudioWorkletProcessor {
  private readonly core: PlaybackCore;
  private readonly statsEvery: number;
  private sinceStats = 0;
  private lastPlaying = false;

  constructor() {
    super();
    this.core = new PlaybackCore(sampleRate, {
      started: (turnId, contextTime) => this.send({ type: 'started', turnId, contextTime }),
      finished: (turnId) => this.send({ type: 'finished', turnId }),
    });
    this.statsEvery = Math.round((sampleRate * STATS_EVERY_MS) / 1000);

    this.port.onmessage = (event: MessageEvent<PlaybackCommand>) => {
      const message = event.data;
      switch (message.type) {
        case 'begin':
          this.core.begin(message.turnId, message.sampleRate);
          break;
        case 'chunk':
          this.core.pushPcm(message.turnId, new Int16Array(message.pcm));
          break;
        case 'end':
          this.core.end(message.turnId);
          break;
        case 'flush':
          this.core.flush();
          this.sendStats(); // tell the main thread right away that the buffer is empty
          break;
        case 'config':
          this.core.setPrefillMs(message.prefillMs);
          break;
      }
    };
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const first = output?.[0];
    if (output === undefined || first === undefined) return true;

    this.core.render(first, currentTime);
    for (let c = 1; c < output.length; c++) (output[c] as Float32Array).set(first);

    // Stats while audio is moving, plus once when it stops, so an idle page stays quiet.
    this.sinceStats += first.length;
    const playing = this.core.playing;
    if (this.sinceStats >= this.statsEvery && (playing || this.lastPlaying)) {
      this.sendStats();
    }
    this.lastPlaying = playing;
    return true;
  }

  private sendStats(): void {
    this.sinceStats = 0;
    this.send({
      type: 'stats',
      bufferedMs: this.core.bufferedMs,
      underruns: this.core.underruns,
      overflowed: this.core.overflowed,
      playing: this.core.playing,
    });
  }

  private send(event: PlaybackEvent): void {
    this.port.postMessage(event);
  }
}

registerProcessor('bolbill-playback', PlaybackProcessor);
