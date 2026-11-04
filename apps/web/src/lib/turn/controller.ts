import type { ClientMessage, DraftMessage, ServerMessage } from '@bolbill/shared';
import type { ConnectionState } from '../realtime/types';
import { createTurnStore, type TurnStore } from './store';
import type { Effect, TurnEvent } from './types';

export interface ClientPort {
  send(message: ClientMessage): boolean;
  sendAudio(frame: ArrayBuffer): boolean;
}

export interface CapturePort {
  openGate(): void;
  /** Resolves after the last frame has been posted. */
  closeGate(): Promise<void>;
}

export interface PlaybackPort {
  beginTurn(turnId: number, sampleRate: number): void;
  pushPcm(turnId: number, pcm: Uint8Array): void;
  endTurn(turnId: number): void;
  flush(): void;
}

export interface TurnHandlers {
  /** Persist a confirmed draft (the local ledger). */
  saveDraft?: (draft: DraftMessage) => void;
  discardDraft?: (draft: DraftMessage) => void;
}

export interface ControllerDeps {
  client: ClientPort;
  capture: CapturePort;
  playback: PlaybackPort;
  handlers?: TurnHandlers;
  now?: () => number;
  /** Asks for the microphone and resumes audio; called synchronously from the press gesture. */
  ensureAudio?: () => void;
  isMicLive?: () => boolean;
  /** Longest a single press may last, from the gateway's `ready` limits. */
  maxUtteranceSeconds?: () => number;
  /** How long to wait for the gateway after release before giving up on the turn. */
  responseTimeoutMs?: number;
}

const DEFAULT_MAX_UTTERANCE_SECONDS = 20;
const DEFAULT_RESPONSE_TIMEOUT_MS = 15_000;
const AWAITING_GATEWAY = new Set(['finishing', 'transcribing', 'drafting']);

/**
 * Connects the pure turn machine to the real world. Events come in (button, gateway messages,
 * playback, connection); the reducer decides; this class performs the resulting effects in
 * order: opening and closing the microphone gate, sending protocol messages, driving playback.
 *
 * Invariant it guards: the gate is open only between a turn's `start_turn` and its
 * `end_turn` / `abort_turn`, so no audio leaves the browser for any other reason.
 */
export class TurnController {
  readonly store: TurnStore;
  private readonly now: () => number;
  private readonly queue: Effect[] = [];
  private draining = false;
  /** True while microphone frames belong to a live turn and may be sent. */
  private sending = false;
  private sendingTurn = 0;
  private firstFrameSent = false;
  private utteranceTimer: ReturnType<typeof setTimeout> | undefined;
  private responseTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.store = createTurnStore((effects) => this.run(effects));
    this.store.subscribe((state) => {
      if (!AWAITING_GATEWAY.has(state.phase)) clearTimeout(this.responseTimer);
    });
  }

  get state() {
    return this.store.getState();
  }

  // ---- input from the UI ------------------------------------------------------------------

  /** Call from the pointer-down handler: audio and microphone permission need the gesture. */
  press(): void {
    this.deps.ensureAudio?.();
    if (this.deps.isMicLive && !this.deps.isMicLive()) {
      this.dispatch({
        type: 'fault',
        error: {
          code: 'MIC_UNAVAILABLE',
          message: 'Mic ready nahi hai. Allow the microphone and try again.',
          retryable: true,
        },
      });
      return;
    }
    this.dispatch({ type: 'press', at: this.now() });
  }

  release(): void {
    this.dispatch({ type: 'release', at: this.now() });
  }

  latch(): void {
    this.dispatch({ type: 'latch' });
  }

  /** Abandon the turn: close the gate and tell the gateway to drop it. */
  cancel(): void {
    this.dispatch({ type: 'cancel' });
  }

  confirm(): void {
    this.dispatch({ type: 'confirm' });
  }

  discard(): void {
    this.dispatch({ type: 'discard' });
  }

  dismissError(): void {
    this.dispatch({ type: 'dismiss_error' });
  }

  // ---- input from the lower layers --------------------------------------------------------

  /** Hot path (about 31 times a second while talking). */
  handleFrame(frame: ArrayBuffer): void {
    if (!this.sending) return;
    if (!this.deps.client.sendAudio(frame) || this.firstFrameSent) return;
    this.firstFrameSent = true;
    this.dispatch({ type: 'frame_sent', turnId: this.sendingTurn, at: this.now() });
  }

  handleServerMessage(message: ServerMessage): void {
    this.dispatch({ type: 'server', message, at: this.now() });
  }

  handleTtsAudio(turnId: number, pcm: Uint8Array): void {
    this.deps.playback.pushPcm(turnId, pcm);
  }

  handleConnection(state: ConnectionState): void {
    this.dispatch({ type: 'connection', connected: state.status === 'ready' });
  }

  handlePlaybackStarted(turnId: number, perfMs: number): void {
    this.dispatch({ type: 'playback_started', turnId, at: perfMs });
  }

  handleSilenced(perfMs: number): void {
    this.dispatch({ type: 'silenced', at: perfMs });
  }

  /** Applies a user edit to the displayed draft. */
  editDraft(draft: DraftMessage): void {
    this.dispatch({ type: 'edit_draft', draft });
  }

  acceptReplacement(): void {
    this.dispatch({ type: 'accept_replacement' });
  }

  keepPending(): void {
    this.dispatch({ type: 'keep_pending' });
  }

  handlePlaybackFinished(turnId: number): void {
    this.dispatch({ type: 'playback_finished', turnId });
  }

  /** The microphone went away (unplugged, permission revoked). Only matters mid-turn. */
  handleMicLost(): void {
    if (this.state.phase !== 'listening') return;
    this.dispatch({
      type: 'fault',
      error: { code: 'MIC_UNAVAILABLE', message: 'Mic band ho gaya. Please try again.', retryable: true },
    });
  }

  dispose(): void {
    clearTimeout(this.utteranceTimer);
    clearTimeout(this.responseTimer);
    this.sending = false;
  }

  // ---- effects ----------------------------------------------------------------------------

  private dispatch(event: TurnEvent): void {
    this.store.getState().dispatch(event);
  }

  /**
   * Effects run strictly in order. Most are synchronous and run immediately; `end_turn` waits
   * for the microphone's last frame, and anything queued behind it (an interrupt, the next
   * press) waits too, so the gateway always sees ptt_end before the next ptt_start.
   */
  private run(effects: Effect[]): void {
    this.queue.push(...effects);
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (let effect = this.queue.shift(); effect !== undefined; effect = this.queue.shift()) {
        const pending = this.perform(effect);
        if (pending !== undefined) await pending;
      }
    } finally {
      this.draining = false;
    }
  }

  private perform(effect: Effect): Promise<void> | void {
    const { client, capture, playback, handlers } = this.deps;
    switch (effect.type) {
      case 'start_turn':
        if (!client.send({ type: 'ptt_start', turnId: effect.turnId })) {
          this.dispatch({
            type: 'fault',
            error: { code: 'OFFLINE', message: 'Connection nahi hai. Please try again.', retryable: true },
          });
          return;
        }
        this.sending = true;
        this.sendingTurn = effect.turnId;
        this.firstFrameSent = false;
        capture.openGate();
        this.utteranceTimer = setTimeout(
          () => this.release(),
          (this.deps.maxUtteranceSeconds?.() ?? DEFAULT_MAX_UTTERANCE_SECONDS) * 1000,
        );
        return;
      case 'end_turn':
        clearTimeout(this.utteranceTimer);
        return capture
          .closeGate()
          .catch(() => undefined)
          .then(() => {
            this.sending = false;
            client.send({ type: 'ptt_end', turnId: effect.turnId });
            clearTimeout(this.responseTimer);
            this.responseTimer = setTimeout(
              () => this.dispatch({ type: 'timeout', turnId: effect.turnId }),
              this.deps.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
            );
          });
      case 'abort_turn':
        clearTimeout(this.utteranceTimer);
        this.sending = false;
        void capture.closeGate().catch(() => undefined);
        client.send({ type: 'interrupt', turnId: effect.turnId });
        return;
      case 'interrupt':
        client.send({ type: 'interrupt', turnId: effect.turnId });
        return;
      case 'flush_playback':
        playback.flush();
        return;
      case 'play_start':
        playback.beginTurn(effect.turnId, effect.sampleRate);
        return;
      case 'play_end':
        playback.endTurn(effect.turnId);
        return;
      case 'save_draft':
        handlers?.saveDraft?.(effect.draft);
        return;
      case 'discard_draft':
        handlers?.discardDraft?.(effect.draft);
        return;
      case 'speak':
        client.send({ type: 'speak', turnId: effect.turnId, text: effect.text });
        return;
    }
  }
}
