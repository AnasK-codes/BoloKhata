import type { CaptureCommand, CaptureEvent } from './worklets/messages';

export interface MicSettings {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

/** Defaults to be revisited after testing on real phones (see the manual test list). */
export const DEFAULT_MIC_SETTINGS: MicSettings = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
};

export type MicStatus = 'off' | 'acquiring' | 'live' | 'error';
export type MicErrorKind = 'unsupported' | 'denied' | 'no_device' | 'failed';

export interface MicState {
  status: MicStatus;
  error?: MicErrorKind;
  /** True only while the stream is open and the capture worklet is attached. */
  live: boolean;
}

export interface MicCaptureOptions {
  settings?: MicSettings;
  /**
   * One 1,024-byte frame. The buffer is handed back to the worklet as soon as this returns,
   * so use it synchronously (WebSocket.send copies) and never keep a reference.
   */
  onFrame: (frame: ArrayBuffer) => void;
  onLevel?: (rms: number) => void;
  /** How long the page may stay hidden before the microphone is released. */
  hiddenReleaseMs?: number;
}

const GATE_ACK_TIMEOUT_MS = 100;
const DEFAULT_HIDDEN_RELEASE_MS = 3000;
const WORKLET_URL = '/worklets/capture.js';

/**
 * Microphone to 16 kHz frames. The stream stays open (warm) while the page is visible so a
 * press starts sending at once, but the worklet posts nothing until a `gate` message opens it.
 * When the page has been hidden for a moment the stream is released (the browser's recording
 * indicator goes away) and it is re-acquired when the page comes back.
 */
export class MicCapture {
  private state: MicState = { status: 'off', live: false };
  private readonly listeners = new Set<(state: MicState) => void>();
  private settings: MicSettings;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private moduleLoaded = false;
  private wanted = false;
  private gateOpen = false;
  private seq = 0;
  private readonly acks = new Map<number, () => void>();
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private acquiring: Promise<void> | null = null;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(
    private readonly context: AudioContext,
    private readonly options: MicCaptureOptions,
  ) {
    this.settings = options.settings ?? DEFAULT_MIC_SETTINGS;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  getState(): MicState {
    return this.state;
  }

  subscribe(listener: (state: MicState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get isGateOpen(): boolean {
    return this.gateOpen;
  }

  /** Asks for the microphone. Call from a user gesture the first time. Safe to call again. */
  async start(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  /** Releases the microphone completely. */
  stop(): void {
    this.wanted = false;
    this.release();
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.node?.disconnect();
    this.node = null;
  }

  async updateSettings(settings: MicSettings): Promise<void> {
    this.settings = settings;
    if (!this.wanted) return;
    this.release();
    await this.acquire();
  }

  /** Frames start flowing to `onFrame`. A no-op when the microphone is not live. */
  openGate(): void {
    if (!this.state.live || this.node === null || this.gateOpen) return;
    this.gateOpen = true;
    this.send({ type: 'gate', open: true, seq: ++this.seq });
  }

  /**
   * Stops frames. Resolves once the worklet has posted its last (zero-padded) frame, so a
   * caller can send `ptt_end` knowing every frame is already on its way. Never rejects and
   * never waits more than 100 ms, because a stuck worklet must not hold up the turn.
   */
  closeGate(): Promise<void> {
    if (!this.gateOpen || this.node === null) {
      this.gateOpen = false;
      return Promise.resolve();
    }
    this.gateOpen = false;
    const seq = ++this.seq;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.acks.delete(seq);
        resolve();
      };
      const timer = setTimeout(done, GATE_ACK_TIMEOUT_MS);
      this.acks.set(seq, done);
      this.send({ type: 'gate', open: false, seq });
    });
  }

  private async acquire(): Promise<void> {
    if (this.state.live) return;
    this.acquiring ??= this.openStream().finally(() => {
      this.acquiring = null;
    });
    await this.acquiring;
  }

  private async openStream(): Promise<void> {
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      this.set({ status: 'error', error: 'unsupported', live: false });
      return;
    }
    this.set({ status: 'acquiring', live: false });
    try {
      if (!this.moduleLoaded) {
        await this.context.audioWorklet.addModule(WORKLET_URL);
        this.moduleLoaded = true;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, ...this.settings },
      });
      if (!this.wanted) {
        stream.getTracks().forEach((t) => t.stop());
        this.set({ status: 'off', live: false });
        return;
      }
      this.attach(stream);
      this.set({ status: 'live', live: true });
    } catch (error) {
      this.set({ status: 'error', error: classify(error), live: false });
    }
  }

  private attach(stream: MediaStream): void {
    if (this.node === null) {
      const node = new AudioWorkletNode(this.context, 'bolbill-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer | CaptureEvent>) =>
        this.onWorkletMessage(event.data);
      // Some browsers only run a node that reaches the destination; the worklet outputs silence
      // and the gain is zero, so nothing is audible.
      const mute = this.context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(this.context.destination);
      this.node = node;
    }
    this.stream = stream;
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.node);
    for (const track of stream.getAudioTracks()) {
      // Unplugged headset, revoked permission, or the OS taking the mic.
      track.onended = () => {
        if (this.stream === stream) this.release('no_device');
      };
    }
  }

  private release(error?: MicErrorKind): void {
    void this.closeGate();
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.set(error ? { status: 'error', error, live: false } : { status: 'off', live: false });
  }

  private onWorkletMessage(data: ArrayBuffer | CaptureEvent): void {
    if (data instanceof ArrayBuffer) {
      this.options.onFrame(data);
      // Return the buffer so the worklet can fill it again.
      const command: CaptureCommand = { type: 'recycle', buffer: data };
      this.node?.port.postMessage(command, [data]);
      return;
    }
    if (data.type === 'level') this.options.onLevel?.(data.rms);
    else if (data.type === 'gate_ack') this.acks.get(data.seq)?.();
  }

  private handleVisibility(): void {
    if (document.visibilityState === 'hidden') {
      // Frames must never keep flowing from a page nobody is looking at.
      void this.closeGate();
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = setTimeout(() => {
        if (this.wanted && document.visibilityState === 'hidden') this.release();
      }, this.options.hiddenReleaseMs ?? DEFAULT_HIDDEN_RELEASE_MS);
      return;
    }
    clearTimeout(this.hiddenTimer);
    if (this.wanted && !this.state.live) void this.acquire();
    if (this.context.state !== 'running') void this.context.resume().catch(() => undefined);
  }

  private send(command: CaptureCommand): void {
    this.node?.port.postMessage(command);
  }

  private set(state: MicState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function classify(error: unknown): MicErrorKind {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device';
  return 'failed';
}
