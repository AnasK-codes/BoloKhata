import { MAX_TURN_ID, saved, type DraftMessage, type ServerMessage, type TimingSpan } from '@bolbill/shared';
import type { Degradation, Effect, TurnError, TurnEvent, TurnRecord, TurnState, TurnTransition } from './types';

export const HISTORY_LIMIT = 20;

export function initialTurnState(overrides: Partial<TurnState> = {}): TurnState {
  return {
    phase: 'idle',
    turnId: null,
    nextTurnId: 1,
    mode: 'held',
    connected: false,
    transcript: null,
    heard: false,
    replacement: null,
    draft: null,
    pending: null,
    degraded: [],
    error: null,
    turns: [],
    ...overrides,
  };
}

const IN_FLIGHT = new Set(['listening', 'finishing', 'transcribing', 'drafting', 'speaking']);
const AFTER_RELEASE = new Set(['finishing', 'transcribing', 'drafting']);

const OFFLINE: TurnError = {
  code: 'OFFLINE',
  message: 'Connection nahi hai. Reconnecting, please wait a moment.',
  retryable: true,
};
const DISCONNECTED: TurnError = {
  code: 'DISCONNECTED',
  message: 'Connection toot gaya. Reconnecting, then try again.',
  retryable: true,
};

/** Where to rest when nothing is happening: reviewing a pending bill, or idle. */
function settled(state: TurnState): TurnState['phase'] {
  return state.pending ? 'reviewing' : 'idle';
}

/** A bill needs items that all resolved; a payment needs a known customer. */
export function isConfirmable(draft: DraftMessage): boolean {
  if (draft.intent === 'create_bill') return (draft.bill?.items.length ?? 0) > 0 && draft.unresolved.length === 0;
  if (draft.intent === 'record_payment') return draft.customer?.id !== undefined && draft.payment !== undefined;
  return false;
}

function nextId(id: number): number {
  return id >= MAX_TURN_ID ? 1 : id + 1;
}

function withSpan(
  turns: TurnRecord[],
  turnId: number,
  side: 'browser' | 'gateway',
  span: TimingSpan,
  value: number,
  overwrite = false,
): TurnRecord[] {
  return turns.map((record) => {
    if (record.turnId !== turnId) return record;
    if (!overwrite && record[side][span] !== undefined) return record;
    return { ...record, [side]: { ...record[side], [span]: value } };
  });
}

/** Records a browser span for the current turn, as milliseconds since its press. */
function stamp(state: TurnState, span: TimingSpan, at: number): TurnRecord[] {
  const record = state.turns.find((r) => r.turnId === state.turnId);
  if (!record || state.turnId === null) return state.turns;
  return withSpan(state.turns, state.turnId, 'browser', span, Math.max(0, at - record.pressAt));
}

function fail(state: TurnState, error: TurnError, effects: Effect[]): TurnTransition {
  return { state: { ...state, phase: 'error', error, turnId: null, mode: 'held' }, effects };
}

/** Effects that silence an old turn before a new one begins. */
function stopOld(state: TurnState): Effect[] {
  const old = state.turnId;
  if (old === null) return [];
  if (state.phase === 'listening') return [{ type: 'abort_turn', turnId: old }];
  if (AFTER_RELEASE.has(state.phase) || state.phase === 'speaking') {
    return [{ type: 'flush_playback' }, { type: 'interrupt', turnId: old }];
  }
  return [];
}

function press(state: TurnState, at: number): TurnTransition {
  if (state.phase === 'listening') return { state, effects: [] }; // double press
  if (!state.connected) return fail(state, OFFLINE, []);

  const turnId = state.nextTurnId;
  const effectsOld = stopOld(state);
  const record: TurnRecord = {
    turnId,
    pressAt: at,
    browser: { press: 0 },
    gateway: {},
    ...(effectsOld.some((e) => e.type === 'flush_playback') && state.phase === 'speaking' ? { bargeIn: true } : {}),
  };
  return {
    state: {
      ...state,
      phase: 'listening',
      turnId,
      nextTurnId: nextId(turnId),
      mode: 'held',
      transcript: null,
      heard: false,
      draft: null,
      degraded: [],
      error: null,
      turns: [...state.turns, record].slice(-HISTORY_LIMIT),
    },
    effects: [...effectsOld, { type: 'start_turn', turnId }],
  };
}

function release(state: TurnState, at: number): TurnTransition {
  if (state.phase !== 'listening' || state.turnId === null) return { state, effects: [] };
  return {
    state: { ...state, phase: 'finishing', turns: stamp(state, 'release', at) },
    effects: [{ type: 'end_turn', turnId: state.turnId }],
  };
}

function cancel(state: TurnState): TurnTransition {
  if (!IN_FLIGHT.has(state.phase)) return { state, effects: [] };
  const effects = stopOld(state);
  const next = { ...state, turnId: null, mode: 'held' as const };
  return { state: { ...next, phase: settled(next) }, effects };
}

function serverMessage(state: TurnState, message: ServerMessage, at: number): TurnTransition {
  if (message.type === 'timing') {
    const spans = message.spans as Partial<Record<TimingSpan, number>>;
    const turns = state.turns.map((r) =>
      r.turnId === message.turnId
        ? { ...r, gateway: { ...r.gateway, ...spans }, ...(message.parseSource ? { parseSource: message.parseSource } : {}) }
        : r,
    );
    return { state: { ...state, turns }, effects: [] };
  }

  if (message.type === 'error' && message.turnId === undefined) {
    // Not about any turn (for example a rejected message): only matters while one is waiting on the gateway.
    if (!AFTER_RELEASE.has(state.phase) || !message.retryable) return { state, effects: [] };
    return fail(state, errorOf(message), stopOld(state));
  }

  if (!('turnId' in message)) return { state, effects: [] }; // ready, limit, pong: not turn events
  if (message.turnId !== state.turnId) return { state, effects: [] }; // stale: another turn, or none

  switch (message.type) {
    case 'processing':
      return {
        state: {
          ...state,
          phase: state.phase === 'finishing' ? 'transcribing' : state.phase,
          turns: stamp(state, 'processing', at),
        },
        effects: [],
      };
    case 'transcript':
      return {
        state: {
          ...state,
          transcript: message.text,
          phase: state.phase === 'finishing' || state.phase === 'transcribing' ? 'drafting' : state.phase,
          turns: stamp(state, 'transcript', at),
        },
        effects: [],
      };
    case 'draft':
      return draft(state, message, at);
    case 'tts_start': {
      if (state.phase === 'listening') return { state, effects: [] };
      return {
        state: { ...state, phase: 'speaking', turns: stamp(state, 'tts_start_received', at) },
        effects: [{ type: 'play_start', turnId: message.turnId, sampleRate: message.sampleRate }],
      };
    }
    case 'tts_end':
      // The gateway has sent everything, but the speaker may still be playing it: stay in
      // `speaking` until the playback worklet reports it finished.
      return { state, effects: [{ type: 'play_end', turnId: message.turnId }] };
    case 'error':
      return turnError(state, message);
    case 'speech_start':
      return { state: { ...state, heard: true }, effects: [] };
    default:
      return { state, effects: [] };
  }
}

function errorOf(message: Extract<ServerMessage, { type: 'error' }>): TurnError {
  return { code: message.code, message: message.message, retryable: message.retryable };
}

function turnError(state: TurnState, message: Extract<ServerMessage, { type: 'error' }>): TurnTransition {
  // The README marks these two as non-fatal: a draft was already sent, so keep it on screen.
  if (message.code === 'LLM_TIMEOUT' || message.code === 'TTS_UNAVAILABLE') {
    const flag: Degradation = message.code === 'LLM_TIMEOUT' ? 'llm_timeout' : 'tts_unavailable';
    const degraded = state.degraded.includes(flag) ? state.degraded : [...state.degraded, flag];
    // No audio is coming, so do not wait in `speaking`.
    const phase = message.code === 'TTS_UNAVAILABLE' && state.phase === 'speaking' ? settled(state) : state.phase;
    return { state: { ...state, degraded, phase }, effects: [] };
  }
  const effects: Effect[] = state.phase === 'listening' && state.turnId !== null
    ? [{ type: 'abort_turn', turnId: state.turnId }]
    : [{ type: 'flush_playback' }];
  return fail(state, errorOf(message), effects);
}

function draft(state: TurnState, message: DraftMessage, at: number): TurnTransition {
  const turns = stamp(state, 'draft', at);
  const base = { ...state, draft: message, turns };
  const rest = (s: TurnState) => (s.phase === 'speaking' || s.phase === 'listening' ? s.phase : settled(s));

  switch (message.intent) {
    case 'create_bill':
    case 'record_payment': {
      // Something is already waiting and this is a different bill: ask before replacing it.
      if (state.pending && state.pending.draftId !== message.draftId && isConfirmable(message)) {
        const next = { ...base, replacement: message };
        return { state: { ...next, phase: rest(next) }, effects: [] };
      }
      const next = { ...base, pending: isConfirmable(message) ? message : state.pending };
      return { state: { ...next, phase: rest(next) }, effects: [] };
    }
    case 'confirm': {
      // A spoken "haan" names the gateway's pending draft, which may be the replacement the
      // user has not yet answered the dialog for: saying yes accepts it.
      if (state.replacement?.draftId === message.draftId) {
        const next = { ...base, pending: null, replacement: null };
        return { state: { ...next, phase: rest(next) }, effects: [{ type: 'save_draft', draft: state.replacement }] };
      }
      // The gateway names the pending draft; the browser owns the save. A draftId we do not
      // know about means the bill was already saved or discarded: do nothing.
      if (state.pending?.draftId !== message.draftId) {
        return { state: { ...base, phase: rest(base) }, effects: [] };
      }
      const next = { ...base, pending: null };
      return {
        state: { ...next, phase: rest(next) },
        effects: [{ type: 'save_draft', draft: state.pending }],
      };
    }
    case 'cancel': {
      if (state.replacement?.draftId === message.draftId) {
        const next = { ...base, replacement: null };
        return { state: { ...next, phase: rest(next) }, effects: [] };
      }
      if (state.pending?.draftId !== message.draftId) {
        return { state: { ...base, phase: rest(base) }, effects: [] };
      }
      const next = { ...base, pending: null };
      return {
        state: { ...next, phase: rest(next) },
        effects: [{ type: 'discard_draft', draft: state.pending }],
      };
    }
    default:
      return { state: { ...base, phase: rest(base) }, effects: [] };
  }
}

function connection(state: TurnState, connected: boolean): TurnTransition {
  if (connected === state.connected) return { state, effects: [] };
  if (connected) {
    const recovered =
      state.phase === 'error' && (state.error?.code === 'OFFLINE' || state.error?.code === 'DISCONNECTED');
    const next = { ...state, connected: true, ...(recovered ? { error: null } : {}) };
    return { state: recovered ? { ...next, phase: settled(next) } : next, effects: [] };
  }
  const down = { ...state, connected: false };
  if (!IN_FLIGHT.has(state.phase)) return { state: down, effects: [] };
  // The gateway session is gone, so its half of the turn is too. Make sure the gate and speaker stop.
  const effects: Effect[] =
    state.phase === 'listening' && state.turnId !== null
      ? [{ type: 'abort_turn', turnId: state.turnId }, { type: 'flush_playback' }]
      : [{ type: 'flush_playback' }];
  return fail(down, DISCONNECTED, effects);
}

/** The user changed the draft on screen. It becomes confirmable (by tap) as soon as it is complete. */
function editDraft(state: TurnState, edited: DraftMessage): TurnTransition {
  const ownsPending = state.pending === null || state.pending.draftId === edited.draftId;
  let pending = state.pending;
  if (ownsPending) pending = isConfirmable(edited) ? edited : null;
  const replacement = state.replacement?.draftId === edited.draftId ? edited : state.replacement;
  const draft = state.draft?.draftId === edited.draftId || state.draft === null ? edited : state.draft;
  const next = { ...state, draft, pending, replacement };
  const phase = state.phase === 'idle' || state.phase === 'reviewing' ? settled(next) : state.phase;
  return { state: { ...next, phase }, effects: [] };
}

function confirm(state: TurnState): TurnTransition {
  const pending = state.pending;
  if (!pending) return { state, effects: [] };
  const effects: Effect[] = [...stopOld(state), { type: 'save_draft', draft: pending }];
  const turnId = state.nextTurnId;
  const next = { ...state, pending: null, replacement: null, turnId: null as number | null, mode: 'held' as const };
  if (state.connected) {
    // A short spoken confirmation, on a turn of its own so the readback it replaces is dropped.
    effects.push({ type: 'speak', turnId, text: saved()[0] ?? 'Save ho gaya.' });
    return { state: { ...next, turnId, nextTurnId: nextId(turnId), phase: 'idle' }, effects };
  }
  return { state: { ...next, phase: 'idle' }, effects };
}

function discard(state: TurnState): TurnTransition {
  const pending = state.pending;
  if (!pending) return { state, effects: [] };
  const next = { ...state, pending: null };
  return {
    state: { ...next, phase: IN_FLIGHT.has(state.phase) ? state.phase : 'idle' },
    effects: [{ type: 'discard_draft', draft: pending }],
  };
}

/** Pure: the same state and event always give the same result. */
export function reduce(state: TurnState, event: TurnEvent): TurnTransition {
  switch (event.type) {
    case 'press':
      return press(state, event.at);
    case 'latch':
      return state.phase === 'listening'
        ? { state: { ...state, mode: 'latched' }, effects: [] }
        : { state, effects: [] };
    case 'release':
      return release(state, event.at);
    case 'cancel':
      return cancel(state);
    case 'frame_sent':
      if (event.turnId !== state.turnId) return { state, effects: [] };
      return { state: { ...state, turns: stamp(state, 'first_frame_sent', event.at) }, effects: [] };
    case 'connection':
      return connection(state, event.connected);
    case 'fault':
      // Also valid while idle: pressing with no usable microphone is a fault with nothing to stop.
      return fail(state, event.error, stopOld(state));
    case 'server':
      return serverMessage(state, event.message, event.at);
    case 'playback_started': {
      if (event.turnId !== state.turnId || state.turnId === null) return { state, effects: [] };
      const record = state.turns.find((r) => r.turnId === state.turnId);
      if (!record) return { state, effects: [] };
      return {
        state: {
          ...state,
          turns: withSpan(state.turns, state.turnId, 'browser', 'first_audible', Math.max(0, event.at - record.pressAt)),
        },
        effects: [],
      };
    }
    case 'playback_finished':
      if (event.turnId !== state.turnId || state.phase !== 'speaking') return { state, effects: [] };
      return { state: { ...state, phase: settled(state) }, effects: [] };
    case 'timeout':
      if (event.turnId !== state.turnId || !AFTER_RELEASE.has(state.phase)) return { state, effects: [] };
      return fail(
        state,
        { code: 'TIMEOUT', message: 'Gateway ne jawab nahi diya. Please try again.', retryable: true },
        stopOld(state),
      );
    case 'silenced': {
      const record = state.turns.find((r) => r.turnId === state.turnId);
      if (!record?.bargeIn || record.pressToSilenceMs !== undefined || state.turnId === null) return { state, effects: [] };
      const value = Math.max(0, event.at - record.pressAt);
      return {
        state: { ...state, turns: state.turns.map((r) => (r.turnId === record.turnId ? { ...r, pressToSilenceMs: value } : r)) },
        effects: [],
      };
    }
    case 'edit_draft':
      return editDraft(state, event.draft);
    case 'accept_replacement': {
      if (!state.replacement) return { state, effects: [] };
      return { state: { ...state, pending: state.replacement, replacement: null }, effects: [] };
    }
    case 'keep_pending':
      return { state: { ...state, replacement: null, draft: state.pending ?? state.draft }, effects: [] };
    case 'confirm':
      return confirm(state);
    case 'discard':
      return discard(state);
    case 'dismiss_error':
      if (state.phase !== 'error') return { state, effects: [] };
      return { state: { ...state, phase: settled(state), error: null }, effects: [] };
  }
}
