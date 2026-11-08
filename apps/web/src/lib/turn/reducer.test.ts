import { describe, expect, it } from 'vitest';
import { MAX_TURN_ID } from '@bolbill/shared';
import { HISTORY_LIMIT, initialTurnState, isConfirmable, reduce } from './reducer';
import { Sim, draftMessage } from './testing';

describe('a normal turn', () => {
  it('walks idle, listening, finishing, transcribing, drafting, reviewing, speaking, reviewing', () => {
    const sim = new Sim();
    const phases: string[] = [sim.phase];
    const note = () => phases.push(sim.phase);

    sim.press();
    note();
    const turnId = sim.state.turnId as number;
    sim.release();
    note();
    sim.server({ type: 'processing', turnId });
    note();
    sim.server({ type: 'transcript', turnId, text: 'do kilo aata' });
    note();
    sim.server(draftMessage(turnId));
    note();
    sim.server({ type: 'tts_start', turnId, sampleRate: 24000, format: 'pcm_s16le' });
    note();
    sim.server({ type: 'tts_end', turnId });
    note(); // the speaker is still playing what was buffered
    sim.send({ type: 'playback_finished', turnId });
    note();

    expect(phases).toEqual([
      'idle', 'listening', 'finishing', 'transcribing', 'drafting', 'reviewing', 'speaking', 'speaking', 'reviewing',
    ]);
    expect(sim.state.transcript).toBe('do kilo aata');
    expect(sim.state.pending?.draftId).toBe(`d${turnId}`);
    expect(sim.types()).toEqual(['start_turn', 'end_turn', 'play_start', 'play_end']);
  });

  it('rests in idle, not reviewing, when the turn leaves nothing pending', () => {
    const sim = new Sim();
    const turnId = sim.speak();
    sim.server(draftMessage(turnId, { intent: 'query_balance', balance: { balance: 120 }, bill: undefined }));
    expect(sim.phase).toBe('idle');
    expect(sim.state.pending).toBeNull();
    expect(sim.state.draft?.intent).toBe('query_balance');
  });

  it('allocates increasing client turn ids, wrapping before 2^32', () => {
    const sim = new Sim();
    sim.press();
    sim.release();
    sim.send({ type: 'cancel' });
    sim.press();
    expect(sim.state.turns.map((t) => t.turnId)).toEqual([1, 2]);
    const edge = new Sim({ nextTurnId: MAX_TURN_ID });
    edge.press();
    expect(edge.state.turnId).toBe(MAX_TURN_ID);
    expect(edge.state.nextTurnId).toBe(1);
  });
});

describe('press', () => {
  it('ignores a second press while listening', () => {
    const sim = new Sim();
    sim.press();
    const before = sim.state;
    expect(sim.press()).toEqual([]);
    expect(sim.state).toBe(before);
    expect(sim.types()).toEqual(['start_turn']);
  });

  it('refuses without a connection and starts nothing', () => {
    const sim = new Sim({ connected: false });
    sim.press();
    expect(sim.phase).toBe('error');
    expect(sim.state.error?.code).toBe('OFFLINE');
    expect(sim.effects).toEqual([]);
    expect(sim.state.turns).toEqual([]);
  });

  it('clears the error and recovers when the connection returns', () => {
    const sim = new Sim({ connected: false });
    sim.press();
    sim.send({ type: 'connection', connected: true });
    expect(sim.phase).toBe('idle');
    expect(sim.state.error).toBeNull();
    sim.press();
    expect(sim.phase).toBe('listening');
  });

  it('keeps a pending bill when a new utterance starts (the "haan" needs it)', () => {
    const sim = new Sim();
    const first = sim.draft();
    sim.press();
    expect(sim.state.pending?.draftId).toBe(`d${first}`);
    expect(sim.phase).toBe('listening');
  });

  it('keeps a bill on screen while the answer to its question is spoken', () => {
    const sim = new Sim();
    const turnId = sim.speak();
    sim.server(draftMessage(turnId, { draftId: 'dq', unresolved: [{ kind: 'item', spoken: 'kesar', candidates: [] }], clarification: { slot: 'item', spoken: 'kesar', attempts: 1, fallback: false, transcript: 'kesar' } }));
    sim.press();
    expect(sim.state.draft?.draftId).toBe('dq');
    expect(sim.phase).toBe('listening');
  });

  it('latches on a short tap', () => {
    const sim = new Sim();
    sim.press();
    sim.send({ type: 'latch' });
    expect(sim.state.mode).toBe('latched');
    sim.release();
    expect(sim.state.mode).toBe('latched'); // the mode only matters while listening
    sim.send({ type: 'latch' });
    expect(sim.phase).toBe('finishing');
  });
});

describe('barge-in', () => {
  it('flushes playback, interrupts the old turn and starts the new one, in that order', () => {
    const sim = new Sim();
    const old = sim.draft();
    sim.server({ type: 'tts_start', turnId: old, sampleRate: 24000, format: 'pcm_s16le' });
    expect(sim.phase).toBe('speaking');
    sim.effects = [];
    sim.press();
    expect(sim.effects).toEqual([
      { type: 'flush_playback' },
      { type: 'interrupt', turnId: old },
      { type: 'start_turn', turnId: old + 1 },
    ]);
    expect(sim.phase).toBe('listening');
  });

  it('also supersedes a turn still waiting on the gateway', () => {
    const sim = new Sim();
    sim.press();
    sim.release();
    const old = sim.state.turnId as number;
    sim.effects = [];
    sim.press();
    expect(sim.effects.map((e) => e.type)).toEqual(['flush_playback', 'interrupt', 'start_turn']);
    expect(sim.state.turnId).toBe(old + 1);
  });

  it('drops late events of the superseded turn', () => {
    const sim = new Sim();
    const old = sim.speak();
    sim.press();
    const before = sim.state;
    expect(sim.server(draftMessage(old))).toEqual([]);
    expect(sim.server({ type: 'tts_start', turnId: old, sampleRate: 24000, format: 'pcm_s16le' })).toEqual([]);
    expect(sim.server({ type: 'transcript', turnId: old, text: 'late' })).toEqual([]);
    expect(sim.state.draft).toBeNull();
    expect(sim.state.transcript).toBeNull();
    expect(sim.state.phase).toBe(before.phase);
    expect(sim.state.pending).toBeNull();
  });
});

describe('cancellation', () => {
  it('aborts while listening: gate closed, gateway told, back to rest', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    sim.effects = [];
    sim.send({ type: 'cancel' });
    expect(sim.effects).toEqual([{ type: 'abort_turn', turnId: id }]);
    expect(sim.phase).toBe('idle');
    expect(sim.state.turnId).toBeNull();
  });

  it('ignores a draft that arrives after the cancel', () => {
    const sim = new Sim();
    const id = sim.speak();
    sim.send({ type: 'cancel' });
    expect(sim.server(draftMessage(id))).toEqual([]);
    expect(sim.phase).toBe('idle');
    expect(sim.state.pending).toBeNull();
  });

  it('does nothing when there is nothing to cancel', () => {
    const sim = new Sim();
    expect(sim.send({ type: 'cancel' })).toEqual([]);
    const reviewing = new Sim();
    reviewing.draft();
    expect(reviewing.send({ type: 'cancel' })).toEqual([]);
    expect(reviewing.phase).toBe('reviewing');
  });

  it('rests in reviewing when a bill is still pending', () => {
    const sim = new Sim();
    sim.draft();
    sim.press();
    sim.send({ type: 'cancel' });
    expect(sim.phase).toBe('reviewing');
  });
});

describe('confirm and discard', () => {
  it('saves the pending draft when the gateway reports a spoken "haan" for it', () => {
    const sim = new Sim();
    const bill = sim.draft();
    const yes = sim.speak();
    sim.effects = [];
    sim.server(draftMessage(yes, { intent: 'confirm', draftId: `d${bill}`, bill: undefined, customer: undefined }));
    expect(sim.effects).toEqual([{ type: 'save_draft', draft: expect.objectContaining({ draftId: `d${bill}` }) }]);
    expect(sim.state.pending).toBeNull();
    expect(sim.phase).toBe('idle');
  });

  it('does not save twice if the same "haan" is reported again', () => {
    const sim = new Sim();
    const bill = sim.draft();
    const yes = sim.speak();
    const confirm = draftMessage(yes, { intent: 'confirm', draftId: `d${bill}` });
    sim.server(confirm);
    sim.effects = [];
    sim.server(confirm);
    expect(sim.effects).toEqual([]);
  });

  it('does not save a draft id it does not hold', () => {
    const sim = new Sim();
    sim.draft();
    const yes = sim.speak();
    sim.effects = [];
    sim.server(draftMessage(yes, { intent: 'confirm', draftId: 'some-other-bill' }));
    expect(sim.effects).toEqual([]);
    expect(sim.state.pending).not.toBeNull();
  });

  it('discards on a spoken "nahi"', () => {
    const sim = new Sim();
    const bill = sim.draft();
    const no = sim.speak();
    sim.effects = [];
    sim.server(draftMessage(no, { intent: 'cancel', draftId: `d${bill}` }));
    expect(sim.effects.map((e) => e.type)).toEqual(['discard_draft']);
    expect(sim.state.pending).toBeNull();
  });

  it('saves on a tap and speaks a short confirmation on a new turn', () => {
    const sim = new Sim();
    const bill = sim.draft();
    sim.effects = [];
    sim.send({ type: 'confirm' });
    expect(sim.effects).toEqual([
      { type: 'save_draft', draft: expect.objectContaining({ draftId: `d${bill}` }) },
      { type: 'speak', turnId: bill + 1, text: expect.any(String) },
    ]);
    expect(sim.state.pending).toBeNull();
    // Its audio belongs to the speak turn and is accepted.
    sim.server({ type: 'tts_start', turnId: bill + 1, sampleRate: 24000, format: 'pcm_s16le' });
    expect(sim.phase).toBe('speaking');
  });

  it('cuts off the readback when confirmed by tap while it is still playing', () => {
    const sim = new Sim();
    const bill = sim.draft();
    sim.server({ type: 'tts_start', turnId: bill, sampleRate: 24000, format: 'pcm_s16le' });
    sim.effects = [];
    sim.send({ type: 'confirm' });
    expect(sim.effects.map((e) => e.type)).toEqual(['flush_playback', 'interrupt', 'save_draft', 'speak']);
    expect(sim.server({ type: 'tts_end', turnId: bill })).toEqual([]);
  });

  it('saves silently when offline', () => {
    const sim = new Sim();
    sim.draft();
    sim.send({ type: 'connection', connected: false });
    sim.effects = [];
    sim.send({ type: 'confirm' });
    expect(sim.effects.map((e) => e.type)).toEqual(['save_draft']);
  });

  it('discards on a tap and ignores taps with nothing pending', () => {
    const sim = new Sim();
    expect(sim.send({ type: 'confirm' })).toEqual([]);
    expect(sim.send({ type: 'discard' })).toEqual([]);
    sim.draft();
    sim.send({ type: 'discard' });
    expect(sim.state.pending).toBeNull();
    expect(sim.types().at(-1)).toBe('discard_draft');
    expect(sim.phase).toBe('idle');
  });

  it('replaces the pending bill only after the user accepts the newer one', () => {
    const sim = new Sim();
    sim.draft();
    const second = sim.draft();
    sim.send({ type: 'accept_replacement' });
    expect(sim.state.pending?.draftId).toBe(`d${second}`);
  });
});

describe('errors', () => {
  it('fails the turn on a fatal gateway error and recovers on dismiss', () => {
    const sim = new Sim();
    const id = sim.speak();
    sim.server({ type: 'error', turnId: id, code: 'STT_ERROR', message: 'Speech service failed.', retryable: true });
    expect(sim.phase).toBe('error');
    expect(sim.state.error).toMatchObject({ code: 'STT_ERROR', retryable: true });
    expect(sim.types().at(-1)).toBe('flush_playback');
    sim.send({ type: 'dismiss_error' });
    expect(sim.phase).toBe('idle');
  });

  it('allows a press straight out of the error state', () => {
    const sim = new Sim();
    const id = sim.speak();
    sim.server({ type: 'error', turnId: id, code: 'NO_TRANSCRIPT', message: 'Nothing heard.', retryable: true });
    sim.press();
    expect(sim.phase).toBe('listening');
    expect(sim.state.error).toBeNull();
  });

  it('treats LLM_TIMEOUT as non-fatal: the rules draft stays, flagged for review', () => {
    const sim = new Sim();
    const id = sim.speak();
    sim.server({ type: 'error', turnId: id, code: 'LLM_TIMEOUT', message: 'Model slow.', retryable: false });
    expect(sim.phase).toBe('drafting');
    sim.server(draftMessage(id));
    expect(sim.phase).toBe('reviewing');
    expect(sim.state.degraded).toEqual(['llm_timeout']);
  });

  it('treats TTS_UNAVAILABLE as non-fatal and does not wait for audio that will not come', () => {
    const sim = new Sim();
    const id = sim.draft();
    sim.server({ type: 'tts_start', turnId: id, sampleRate: 24000, format: 'pcm_s16le' });
    sim.server({ type: 'error', turnId: id, code: 'TTS_UNAVAILABLE', message: 'No voice.', retryable: true });
    expect(sim.phase).toBe('reviewing');
    expect(sim.state.pending).not.toBeNull();
    expect(sim.state.degraded).toEqual(['tts_unavailable']);
  });

  it('ignores errors for stale turns', () => {
    const sim = new Sim();
    const old = sim.speak();
    sim.press();
    sim.server({ type: 'error', turnId: old, code: 'STT_ERROR', message: 'late', retryable: true });
    expect(sim.phase).toBe('listening');
  });

  it('ignores turn-less errors unless a turn is waiting on a retryable failure', () => {
    const sim = new Sim();
    sim.server({ type: 'error', code: 'BAD_MESSAGE', message: 'x', retryable: false });
    expect(sim.phase).toBe('idle');
    sim.speak();
    sim.server({ type: 'error', code: 'BAD_MESSAGE', message: 'x', retryable: false });
    expect(sim.phase).toBe('drafting');
    sim.server({ type: 'error', code: 'INTERNAL', message: 'x', retryable: true });
    expect(sim.phase).toBe('error');
  });

  it('times out a turn the gateway never answers', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    sim.release();
    sim.send({ type: 'timeout', turnId: id });
    expect(sim.state.error?.code).toBe('TIMEOUT');
    // A timeout for a turn that has moved on does nothing.
    const other = new Sim();
    const done = other.draft();
    expect(other.send({ type: 'timeout', turnId: done })).toEqual([]);
    expect(other.phase).toBe('reviewing');
  });

  it('fails the turn if the microphone dies while listening, and closes the gate', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    sim.effects = [];
    sim.send({ type: 'fault', error: { code: 'MIC_UNAVAILABLE', message: 'Mic band ho gaya.', retryable: true } });
    expect(sim.phase).toBe('error');
    expect(sim.effects).toEqual([{ type: 'abort_turn', turnId: id }]);
  });
});

describe('disconnects', () => {
  it.each(['listening', 'finishing', 'transcribing', 'drafting', 'speaking'] as const)(
    'mid-turn in %s: stops everything and shows a reconnecting error',
    (stage) => {
      const sim = new Sim();
      sim.press();
      const id = sim.state.turnId as number;
      if (stage !== 'listening') sim.release();
      if (stage === 'transcribing' || stage === 'drafting' || stage === 'speaking') sim.server({ type: 'processing', turnId: id });
      if (stage === 'drafting' || stage === 'speaking') sim.server({ type: 'transcript', turnId: id, text: 'x' });
      if (stage === 'speaking') {
        sim.server({ type: 'tts_start', turnId: id, sampleRate: 24000, format: 'pcm_s16le' });
      }
      expect(sim.phase).toBe(stage);
      sim.effects = [];
      sim.send({ type: 'connection', connected: false });
      expect(sim.phase).toBe('error');
      expect(sim.state.error?.code).toBe('DISCONNECTED');
      expect(sim.state.turnId).toBeNull();
      expect(sim.effects.map((e) => e.type)).toContain(stage === 'listening' ? 'abort_turn' : 'flush_playback');
    },
  );

  it('keeps a pending bill through a disconnect and goes back to reviewing on return', () => {
    const sim = new Sim();
    sim.draft();
    sim.press();
    sim.send({ type: 'connection', connected: false });
    expect(sim.state.pending).not.toBeNull();
    sim.send({ type: 'connection', connected: true });
    expect(sim.phase).toBe('reviewing');
  });

  it('is a quiet no-op while idle', () => {
    const sim = new Sim();
    expect(sim.send({ type: 'connection', connected: false })).toEqual([]);
    expect(sim.phase).toBe('idle');
    expect(sim.state.connected).toBe(false);
  });

  it('does not clear an unrelated error when the connection returns', () => {
    const sim = new Sim();
    const id = sim.speak();
    sim.server({ type: 'error', turnId: id, code: 'STT_ERROR', message: 'x', retryable: true });
    sim.send({ type: 'connection', connected: false });
    sim.send({ type: 'connection', connected: true });
    expect(sim.state.error?.code).toBe('STT_ERROR');
  });
});

describe('release races', () => {
  it('ignores a release when not listening', () => {
    const sim = new Sim();
    expect(sim.release()).toEqual([]);
    sim.press();
    sim.release();
    expect(sim.release()).toEqual([]); // double release
    expect(sim.types()).toEqual(['start_turn', 'end_turn']);
  });

  it('tolerates the transcript arriving before the release acknowledgement', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    sim.release();
    sim.server({ type: 'transcript', turnId: id, text: 'fast' });
    expect(sim.phase).toBe('drafting');
    sim.server({ type: 'processing', turnId: id });
    expect(sim.phase).toBe('drafting'); // a late processing never moves the turn backwards
  });

  it('keeps early events while the button is still held without leaving listening', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    sim.server({ type: 'transcript', turnId: id, text: 'half' });
    expect(sim.phase).toBe('listening');
    expect(sim.state.transcript).toBe('half');
  });

  it('ignores a repeated tts_start for a stale turn and an unknown turn id', () => {
    const sim = new Sim();
    sim.press();
    expect(sim.server({ type: 'tts_start', turnId: 999, sampleRate: 24000, format: 'pcm_s16le' })).toEqual([]);
    expect(sim.phase).toBe('listening');
  });
});

describe('timing records', () => {
  it('collects browser spans relative to the press and merges the gateway timing', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    sim.send({ type: 'frame_sent', turnId: id, at: sim.tick(30) });
    sim.send({ type: 'frame_sent', turnId: id, at: sim.tick(500) }); // only the first counts
    sim.release();
    sim.server({ type: 'processing', turnId: id });
    sim.server({ type: 'transcript', turnId: id, text: 'x' });
    sim.server(draftMessage(id));
    sim.server({ type: 'tts_start', turnId: id, sampleRate: 24000, format: 'pcm_s16le' });
    sim.send({ type: 'playback_started', turnId: id, at: sim.tick(20) });
    sim.server({ type: 'timing', turnId: id, spans: { commit_sent: 3, transcript: 310, draft: 316 }, parseSource: 'rules' });

    const record = sim.state.turns[0]!;
    expect(Object.keys(record.browser).sort()).toEqual(
      ['draft', 'first_audible', 'first_frame_sent', 'press', 'processing', 'release', 'transcript', 'tts_start_received'].sort(),
    );
    expect(record.browser.press).toBe(0);
    expect(record.browser.first_frame_sent).toBe(30);
    expect(record.browser.release).toBeGreaterThan(record.browser.first_frame_sent as number);
    expect(record.browser.first_audible).toBeGreaterThan(record.browser.tts_start_received as number);
    expect(record.gateway).toEqual({ commit_sent: 3, transcript: 310, draft: 316 });
    expect(record.parseSource).toBe('rules');
  });

  it('merges a late timing message into the older turn it belongs to', () => {
    const sim = new Sim();
    const first = sim.speak();
    sim.press();
    sim.server({ type: 'timing', turnId: first, spans: { transcript: 250 } });
    expect(sim.state.turns.find((t) => t.turnId === first)?.gateway.transcript).toBe(250);
  });

  it('ignores timing for a turn it never recorded', () => {
    const sim = new Sim();
    const before = sim.state.turns;
    sim.server({ type: 'timing', turnId: 55, spans: { transcript: 1 } });
    expect(sim.state.turns).toEqual(before);
  });

  it('keeps only the last 20 turns', () => {
    const sim = new Sim();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      sim.press();
      sim.send({ type: 'cancel' });
    }
    expect(sim.state.turns).toHaveLength(HISTORY_LIMIT);
    expect(sim.state.turns[0]?.turnId).toBe(6);
    expect(sim.state.turns.at(-1)?.turnId).toBe(HISTORY_LIMIT + 5);
  });

  it('records playback start only for the current turn', () => {
    const sim = new Sim();
    const old = sim.speak();
    sim.press();
    sim.send({ type: 'playback_started', turnId: old, at: sim.tick() });
    expect(sim.state.turns.find((t) => t.turnId === old)?.browser.first_audible).toBeUndefined();
  });
});

describe('purity', () => {
  it('never mutates the state it is given', () => {
    const state = initialTurnState({ connected: true });
    const frozen = Object.freeze({ ...state, turns: Object.freeze([]) as never });
    const result = reduce(frozen, { type: 'press', at: 5 });
    expect(frozen.phase).toBe('idle');
    expect(result.state.phase).toBe('listening');
    expect(reduce(frozen, { type: 'press', at: 5 })).toEqual(result);
  });
});

describe('heard flag', () => {
  it('turns on at speech_start and resets on the next press', () => {
    const sim = new Sim();
    sim.press();
    const id = sim.state.turnId as number;
    expect(sim.state.heard).toBe(false);
    sim.server({ type: 'speech_start', turnId: id });
    expect(sim.state.heard).toBe(true);
    sim.release();
    sim.press();
    expect(sim.state.heard).toBe(false);
  });
});

describe('a new bill while one is pending', () => {
  it('asks before replacing: the old bill stays pending, the new one waits', () => {
    const sim = new Sim();
    const first = sim.draft();
    const second = sim.draft();
    expect(sim.state.pending?.draftId).toBe(`d${first}`);
    expect(sim.state.replacement?.draftId).toBe(`d${second}`);
  });

  it('replaces on accept and keeps the old one on keep', () => {
    const sim = new Sim();
    sim.draft();
    const second = sim.draft();
    sim.send({ type: 'keep_pending' });
    expect(sim.state.replacement).toBeNull();
    expect(sim.state.pending?.draftId).not.toBe(`d${second}`);

    const sim2 = new Sim();
    sim2.draft();
    const next = sim2.draft();
    sim2.send({ type: 'accept_replacement' });
    expect(sim2.state.pending?.draftId).toBe(`d${next}`);
    expect(sim2.state.replacement).toBeNull();
  });

  it('treats a spoken "haan" for the waiting bill as accepting and saving it', () => {
    const sim = new Sim();
    sim.draft();
    const second = sim.draft();
    const yes = sim.speak();
    sim.effects = [];
    sim.server(draftMessage(yes, { intent: 'confirm', draftId: `d${second}` }));
    expect(sim.effects).toEqual([{ type: 'save_draft', draft: expect.objectContaining({ draftId: `d${second}` }) }]);
    expect(sim.state.pending).toBeNull();
    expect(sim.state.replacement).toBeNull();
  });

  it('does not ask when the first bill was incomplete (nothing to lose)', () => {
    const sim = new Sim();
    sim.draft({ unresolved: [{ kind: 'item', spoken: 'xyz', candidates: [] }] });
    expect(sim.state.pending).toBeNull();
    const second = sim.draft();
    expect(sim.state.pending?.draftId).toBe(`d${second}`);
    expect(sim.state.replacement).toBeNull();
  });
});

describe('editing the draft', () => {
  it('clears the old pending bill when voice correction removes the final item', () => {
    const sim = new Sim();
    const first = sim.draft();
    const second = sim.speak();
    sim.server(draftMessage(second, { draftId: `d${first}`, bill: { items: [], total: 0, paid: 0, udhaar: 0 } }));
    expect(sim.state.pending).toBeNull();
    expect(sim.send({ type: 'confirm' })).toEqual([]);
  });
  it('keeps credit unconfirmable until mandatory customer details are complete', () => {
    const sim = new Sim();
    const id = sim.draft({ customer: { id: 'c1', name: 'Synthetic Customer', isNew: false, creditReady: false } });
    expect(sim.state.pending).toBeNull();
    sim.send({ type: 'edit_draft', draft: draftMessage(id, { customer: { id: 'c1', name: 'Synthetic Customer', isNew: false, creditReady: true } }) });
    expect(sim.state.pending?.draftId).toBe(`d${id}`);
  });
  it('makes an incomplete bill confirmable once it is complete, and keeps it out until then', () => {
    const sim = new Sim();
    const id = sim.draft({ unresolved: [{ kind: 'item', spoken: 'xyz', candidates: [] }] });
    expect(sim.state.pending).toBeNull();
    sim.send({ type: 'edit_draft', draft: draftMessage(id) });
    expect(sim.state.pending?.draftId).toBe(`d${id}`);
    expect(sim.phase).toBe('reviewing');
    sim.send({ type: 'edit_draft', draft: draftMessage(id, { unresolved: [{ kind: 'item', spoken: 'q', candidates: [] }] }) });
    expect(sim.state.pending).toBeNull();
    expect(sim.phase).toBe('idle');
  });

  it('a spoken yes still saves the edited version', () => {
    const sim = new Sim();
    const id = sim.draft();
    const edited = draftMessage(id, { bill: { items: [], total: 0, paid: 0, udhaar: 0 } });
    sim.send({ type: 'edit_draft', draft: { ...edited, bill: { ...draftMessage(id).bill!, total: 777, udhaar: 777 } } });
    const yes = sim.speak();
    sim.effects = [];
    sim.server(draftMessage(yes, { intent: 'confirm', draftId: `d${id}` }));
    expect(sim.effects[0]).toMatchObject({ type: 'save_draft', draft: { bill: { total: 777 } } });
  });
});

describe('press to silence', () => {
  it('is recorded only for a press that interrupted speech', () => {
    const sim = new Sim();
    const id = sim.draft();
    sim.server({ type: 'tts_start', turnId: id, sampleRate: 24000, format: 'pcm_s16le' });
    sim.press();
    const pressedAt = sim.state.turns.at(-1)!.pressAt;
    sim.send({ type: 'silenced', at: pressedAt + 7 });
    sim.send({ type: 'silenced', at: pressedAt + 99 });
    expect(sim.state.turns.at(-1)).toMatchObject({ bargeIn: true, pressToSilenceMs: 7 });

    const plain = new Sim();
    plain.press();
    plain.send({ type: 'silenced', at: plain.tick() });
    expect(plain.state.turns[0]?.pressToSilenceMs).toBeUndefined();
  });
});

describe('udhaar without a customer', () => {
  it('is shown but not confirmable until a customer is chosen', () => {
    const sim = new Sim();
    const id = sim.draft({ customer: undefined });
    expect(sim.state.pending).toBeNull();
    sim.send({ type: 'edit_draft', draft: draftMessage(id, { customer: { name: 'Naya Grahak', isNew: true } }) });
    expect(sim.state.pending?.draftId).toBe(`d${id}`);
  });

  it('a fully paid bill with nobody named is still confirmable', () => {
    const sim = new Sim();
    sim.draft({ customer: undefined, bill: { items: draftMessage(1).bill!.items, total: 90, paid: 90, udhaar: 0 } });
    expect(sim.state.pending).not.toBeNull();
  });
});

describe('stock-out and summary drafts', () => {
  const stockDraft = (extra = {}) => draftMessage(1, { intent: 'out_of_stock', bill: undefined, customer: undefined, stock: { productId: 'p1', name: 'Aata' }, ...extra });

  it('can be confirmed only when a product is named', () => {
    expect(isConfirmable(stockDraft())).toBe(true);
    expect(isConfirmable(stockDraft({ stock: undefined }))).toBe(false);
  });

  it('never makes a summary answer confirmable', () => {
    expect(isConfirmable(draftMessage(1, { intent: 'query_summary', bill: undefined, summary: { todaySales: 100, todayBills: 1, totalUdhaar: 0 } }))).toBe(false);
  });
});


describe('add_customer drafts', () => {
  const addDraft = (extra = {}) => draftMessage(1, { intent: 'add_customer', bill: undefined, customer: { name: 'Anil Singh', isNew: true }, ...extra });

  it('can be confirmed only for a new customer', () => {
    expect(isConfirmable(addDraft())).toBe(true);
    expect(isConfirmable(addDraft({ customer: { id: 'c1', name: 'Sharma ji', isNew: false } }))).toBe(false);
    expect(isConfirmable(addDraft({ customer: undefined }))).toBe(false);
  });
});

describe('add_product drafts', () => {
  const productDraft = (extra = {}) => draftMessage(1, { intent: 'add_product', bill: undefined, customer: undefined, product: { name: 'Maida', unit: 'kg', pricePerUnit: 40, isNew: true }, ...extra });

  it('can be confirmed only for a new product', () => {
    expect(isConfirmable(productDraft())).toBe(true);
    expect(isConfirmable(productDraft({ product: { id: 'p1', name: 'Aata', unit: 'kg', pricePerUnit: 45, isNew: false } }))).toBe(false);
    expect(isConfirmable(productDraft({ product: undefined }))).toBe(false);
  });
});

describe('update_price drafts', () => {
  const priceDraft = (extra = {}) => draftMessage(1, { intent: 'update_price', bill: undefined, customer: undefined, product: { id: 'p1', name: 'Aata', unit: 'kg', pricePerUnit: 48, previousPrice: 45, isNew: false }, ...extra });

  it('can be confirmed only for a known product with a different rate', () => {
    expect(isConfirmable(priceDraft())).toBe(true);
    expect(isConfirmable(priceDraft({ product: { id: 'p1', name: 'Aata', unit: 'kg', pricePerUnit: 45, previousPrice: 45, isNew: false } }))).toBe(false);
    expect(isConfirmable(priceDraft({ product: { name: 'Aata', unit: 'kg', pricePerUnit: 48, isNew: false } }))).toBe(false);
    expect(isConfirmable(priceDraft({ product: undefined }))).toBe(false);
  });
});

describe('add_products drafts', () => {
  const row = (name: string, isNew: boolean) => ({ name, unit: 'kg' as const, pricePerUnit: 30, isNew });
  const listDraft = (products: ReturnType<typeof row>[] | undefined) => draftMessage(1, { intent: 'add_products', bill: undefined, customer: undefined, products });

  it('can be confirmed when at least one product is new', () => {
    expect(isConfirmable(listDraft([row('Maida', true), row('Aata', false)]))).toBe(true);
    expect(isConfirmable(listDraft([row('Aata', false)]))).toBe(false);
    expect(isConfirmable(listDraft([]))).toBe(false);
    expect(isConfirmable(listDraft(undefined))).toBe(false);
  });
});

describe('start_draft (a quick tile starts a bill by hand)', () => {
  it('shows the new bill and makes it confirmable when nothing else is waiting', () => {
    const state = initialTurnState();
    const draft = draftMessage(0, { draftId: 'tile-1' });
    const { state: next } = reduce(state, { type: 'start_draft', draft });
    expect(next.draft).toEqual(draft);
    expect(next.pending).toEqual(draft);
  });

  it('refuses to replace a draft that is still waiting for confirmation', () => {
    const waiting = draftMessage(1, { draftId: 'waiting' });
    const state = { ...initialTurnState(), draft: waiting, pending: waiting };
    const { state: next } = reduce(state, { type: 'start_draft', draft: draftMessage(0, { draftId: 'tile-2' }) });
    expect(next.pending?.draftId).toBe('waiting');
    expect(next.draft?.draftId).toBe('waiting');
  });

  it('replaces a finished answer such as a balance card', () => {
    const answer = draftMessage(1, { draftId: 'answer', intent: 'query_balance', bill: undefined, balance: { balance: 100 } });
    const state = { ...initialTurnState(), draft: answer, pending: null };
    const { state: next } = reduce(state, { type: 'start_draft', draft: draftMessage(0, { draftId: 'tile-3' }) });
    expect(next.draft?.draftId).toBe('tile-3');
    expect(next.pending?.draftId).toBe('tile-3');
  });
});
