import { describe, expect, it } from 'vitest';
import { connectionNotice, friendlyError, micErrorText } from './errorText';
import { statusText } from './statusText';

describe('copy', () => {
  it('every error code has a title and a hint saying what to do next', () => {
    for (const code of ['NO_TRANSCRIPT', 'OFFLINE', 'DISCONNECTED', 'MIC_UNAVAILABLE', 'STT_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'INTERNAL', 'WHATEVER']) {
      const e = friendlyError({ code, message: 'x', retryable: true });
      expect(e.title.length).toBeGreaterThan(3);
      expect(e.hint.length).toBeGreaterThan(10);
    }
  });

  it('explains each microphone failure', () => {
    for (const kind of ['denied', 'no_device', 'unsupported', 'failed'] as const) expect(micErrorText(kind).hint).not.toBe('');
  });

  it('shows notices only for connection states that need one', () => {
    expect(connectionNotice({ status: 'ready', sessionId: 's', maxSessionMinutes: 1, maxUtteranceSeconds: 1, rttMs: 1 })).toBeNull();
    expect(connectionNotice({ status: 'limited', reason: 'busy', message: 'Busy.', retryAt: 0 })?.title).toMatch(/busy/);
    expect(connectionNotice({ status: 'limited', reason: 'budget', message: 'Used.', retryAt: 0 })?.title).toMatch(/budget/);
  });

  it('has a status line for every phase', () => {
    const base = { heard: false, mode: 'held' as const, hasPending: false, micLive: true };
    const lines = (['idle', 'listening', 'finishing', 'transcribing', 'drafting', 'reviewing', 'speaking', 'error'] as const).map((phase) => statusText({ ...base, phase }));
    expect(lines.every((l) => l.length > 3)).toBe(true);
    expect(statusText({ ...base, phase: 'listening', heard: true })).toBe('Sun raha hoon…');
    expect(statusText({ ...base, phase: 'transcribing' })).toBe('Samajh raha hoon…');
    expect(statusText({ ...base, phase: 'speaking' })).toBe('Bol raha hoon…');
    expect(statusText({ ...base, phase: 'idle', micLive: false })).toBe('Mic chalu karo');
  });
});
