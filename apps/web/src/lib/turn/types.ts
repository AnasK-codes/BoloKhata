import type { DraftMessage, ServerMessage, TimingSpan } from '@bolbill/shared';

/**
 * Where a turn is, from the shop owner's point of view.
 *
 *   idle         nothing happening, nothing waiting
 *   listening    the button is held (or latched) and audio is flowing
 *   finishing    released; waiting for the gateway to acknowledge the end of speech
 *   transcribing the gateway is turning speech into text
 *   drafting     text is in; waiting for the bill
 *   reviewing    a bill is on screen waiting for confirm (tap or "haan")
 *   speaking     the spoken readback is playing
 *   error        the turn failed; `error` says what to do
 */
export type Phase =
  | 'idle'
  | 'listening'
  | 'finishing'
  | 'transcribing'
  | 'drafting'
  | 'reviewing'
  | 'speaking'
  | 'error';

export interface TurnError {
  /** A gateway `ErrorCode`, or one of ours: OFFLINE, DISCONNECTED, MIC_UNAVAILABLE, TIMEOUT. */
  code: string;
  message: string;
  retryable: boolean;
}

export type Degradation = 'llm_timeout' | 'tts_unavailable';

/** Browser spans are milliseconds since `press`; gateway spans are since its `ptt_start`. */
export interface TurnRecord {
  turnId: number;
  /** `performance.now()` at press. */
  pressAt: number;
  browser: Partial<Record<TimingSpan, number>>;
  gateway: Partial<Record<TimingSpan, number>>;
  parseSource?: 'rules' | 'llm';
  /** The press interrupted a spoken reply. */
  bargeIn?: boolean;
  /** Press until the speaker was confirmed silent, for a barge-in. */
  pressToSilenceMs?: number;
}

export interface TurnState {
  phase: Phase;
  /** The turn that events are accepted for. `null` when nothing is in flight. */
  turnId: number | null;
  nextTurnId: number;
  mode: 'held' | 'latched';
  /** Whether the gateway link is usable right now. */
  connected: boolean;
  transcript: string | null;
  /** Speech was detected in the current turn (the gateway's `speech_start`). */
  heard: boolean;
  /** A newer bill that arrived while another was waiting; the user is asked which to keep. */
  replacement: DraftMessage | null;
  /** The latest draft of the current turn, whatever its intent. */
  draft: DraftMessage | null;
  /** The bill or payment waiting for confirmation; survives other turns until saved or discarded. */
  pending: DraftMessage | null;
  degraded: Degradation[];
  error: TurnError | null;
  /** The last 20 turns, oldest first. */
  turns: TurnRecord[];
}

export type TurnEvent =
  | { type: 'press'; at: number }
  /** A short tap: keep listening until the next tap. */
  | { type: 'latch' }
  | { type: 'release'; at: number }
  /** Abandon the turn without processing it (page hidden, pointer cancelled, user backed out). */
  | { type: 'cancel' }
  | { type: 'frame_sent'; turnId: number; at: number }
  | { type: 'connection'; connected: boolean }
  /** The microphone or another local part failed. */
  | { type: 'fault'; error: TurnError }
  | { type: 'server'; message: ServerMessage; at: number }
  | { type: 'playback_started'; turnId: number; at: number }
  | { type: 'playback_finished'; turnId: number }
  /** The gateway went quiet for too long after release. */
  | { type: 'timeout'; turnId: number }
  /** The speaker was confirmed silent after a flush (from the playback worklet). */
  | { type: 'silenced'; at: number }
  /** The user changed the displayed draft (item, quantity, customer, transcript). */
  | { type: 'edit_draft'; draft: DraftMessage }
  /** A bill started by hand (a quick tile). Ignored while another draft is waiting for confirmation. */
  | { type: 'start_draft'; draft: DraftMessage }
  | { type: 'accept_replacement' }
  | { type: 'keep_pending' }
  | { type: 'confirm' }
  | { type: 'discard' }
  | { type: 'dismiss_error' };

/** Things the reducer wants done. It never does them itself; the controller runs them in order. */
export type Effect =
  /** Send `ptt_start` and open the microphone gate. */
  | { type: 'start_turn'; turnId: number }
  /** Close the gate, wait for its last frame, then send `ptt_end`. */
  | { type: 'end_turn'; turnId: number }
  /** Close the gate now and send `interrupt`; nothing more is wanted from this turn. */
  | { type: 'abort_turn'; turnId: number }
  | { type: 'interrupt'; turnId: number }
  | { type: 'flush_playback' }
  | { type: 'play_start'; turnId: number; sampleRate: number }
  | { type: 'play_end'; turnId: number }
  | { type: 'save_draft'; draft: DraftMessage }
  | { type: 'discard_draft'; draft: DraftMessage }
  | { type: 'speak'; turnId: number; text: string };

export interface TurnTransition {
  state: TurnState;
  effects: Effect[];
}
