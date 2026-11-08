import type { ConnectionState } from '../realtime/types';
import type { MicErrorKind } from '../audio/micCapture';
import type { TurnError } from '../turn/types';
import { t } from '../i18n';

export interface FriendlyError {
  title: string;
  /** What to do next. */
  hint: string;
}

/** In the chosen interface language; every message says what to do next. */
export function friendlyError(error: TurnError): FriendlyError {
  switch (error.code) {
    case 'NO_TRANSCRIPT':
      return { title: t('err.noTranscriptTitle'), hint: t('err.noTranscriptHint') };
    case 'OFFLINE':
    case 'DISCONNECTED':
      return { title: t('notice.offlineTitle'), hint: t('err.offlineHint') };
    case 'MIC_UNAVAILABLE':
      return { title: t('err.micTitle'), hint: t('err.micHint') };
    case 'STT_ERROR':
    case 'STT_UNAVAILABLE':
      return { title: t('err.sttTitle'), hint: t('err.sttHint') };
    case 'UTTERANCE_TOO_LONG':
      return { title: t('err.tooLongTitle'), hint: t('err.tooLongHint') };
    case 'TIMEOUT':
      return { title: t('err.timeoutTitle'), hint: t('err.timeoutHint') };
    case 'RATE_LIMITED':
      return { title: t('err.rateTitle'), hint: t('err.rateHint') };
    default:
      return { title: t('err.genericTitle'), hint: t('err.genericHint') };
  }
}

export function micErrorText(kind: MicErrorKind): FriendlyError {
  switch (kind) {
    case 'denied':
      return { title: t('micErr.deniedTitle'), hint: t('micErr.deniedHint') };
    case 'no_device':
      return { title: t('micErr.noDeviceTitle'), hint: t('micErr.noDeviceHint') };
    case 'unsupported':
      return { title: t('micErr.unsupportedTitle'), hint: t('micErr.unsupportedHint') };
    default:
      return { title: t('micErr.failedTitle'), hint: t('common.retry') };
  }
}

/** `message` comes from the gateway (English); it is shown as is inside the translated sentence. */
export function connectionNotice(state: ConnectionState): FriendlyError | null {
  switch (state.status) {
    case 'limited':
      return {
        title: state.reason === 'budget' ? t('connNotice.budgetTitle') : t('connNotice.busyTitle'),
        hint: t('connNotice.limitedHint', { message: state.message }),
      };
    case 'blocked':
      return { title: t('connNotice.blockedTitle'), hint: state.message };
    case 'reconnecting':
      return { title: t('connNotice.reconnectingTitle'), hint: t('connNotice.reconnectingHint') };
    default:
      return null;
  }
}
