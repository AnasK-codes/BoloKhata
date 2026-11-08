import type { Phase } from '../turn/types';
import { t } from '../i18n';

export interface StatusInput {
  phase: Phase;
  heard: boolean;
  mode: 'held' | 'latched';
  hasPending: boolean;
  micLive: boolean;
}

/** One short line for what the app is doing, in the chosen interface language. */
export function statusText(s: StatusInput): string {
  if (!s.micLive) return t('status.micOff');
  switch (s.phase) {
    case 'listening':
      if (s.mode === 'latched') return t('status.latched');
      return s.heard ? t('status.listening') : t('status.speakNow');
    case 'finishing':
    case 'transcribing':
      return t('status.understanding');
    case 'drafting':
      return t('status.drafting');
    case 'speaking':
      return t('status.speaking');
    case 'reviewing':
      return t('status.confirm');
    case 'error':
      return t('common.retry');
    case 'idle':
      return s.hasPending ? t('status.confirm') : t('status.idle');
  }
}
