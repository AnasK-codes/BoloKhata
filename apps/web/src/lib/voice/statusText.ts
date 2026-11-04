import type { Phase } from '../turn/types';

export interface StatusInput {
  phase: Phase;
  heard: boolean;
  mode: 'held' | 'latched';
  hasPending: boolean;
  micLive: boolean;
}

/** One short line for what the app is doing, in simple Hinglish. */
export function statusText(s: StatusInput): string {
  if (!s.micLive) return 'Pehle mic chalu karo';
  switch (s.phase) {
    case 'listening':
      if (s.mode === 'latched') return 'Sun raha hoon… bolke tap karo';
      return s.heard ? 'Sun raha hoon…' : 'Boliye, main sun raha hoon…';
    case 'finishing':
    case 'transcribing':
      return 'Samajh raha hoon…';
    case 'drafting':
      return 'Bill bana raha hoon…';
    case 'speaking':
      return 'Bol raha hoon…';
    case 'reviewing':
      return 'Confirm karo ya "haan" bolo';
    case 'error':
      return 'Dobara try karo';
    case 'idle':
      return s.hasPending ? 'Confirm karo ya "haan" bolo' : 'Dabake bolo';
  }
}
