import type { ConnectionState } from '../realtime/types';
import type { MicErrorKind } from '../audio/micCapture';
import type { TurnError } from '../turn/types';

export interface FriendlyError {
  title: string;
  /** What to do next. */
  hint: string;
}

/** Simple Hinglish with an English fallback; every message says what to do next. */
export function friendlyError(error: TurnError): FriendlyError {
  switch (error.code) {
    case 'NO_TRANSCRIPT':
      return { title: 'Kuch sunai nahi diya', hint: 'Mic ke paas bolo aur dobara try karo. (No speech was detected.)' };
    case 'OFFLINE':
    case 'DISCONNECTED':
      return { title: 'Internet nahi hai', hint: 'Bolne ke liye internet chahiye. Connection aate hi dobara try karo. Khata aur samaan phir bhi khul sakte hain.' };
    case 'MIC_UNAVAILABLE':
      return { title: 'Mic ready nahi hai', hint: 'Mic ki permission allow karo, phir dobara dabao. (Allow the microphone.)' };
    case 'STT_ERROR':
    case 'STT_UNAVAILABLE':
      return { title: 'Awaaz samajhne wali service busy hai', hint: 'Thodi der baad dobara bolo. (The speech service had a problem.)' };
    case 'UTTERANCE_TOO_LONG':
      return { title: 'Bahut lamba bol diya', hint: 'Ek baar mein ek bill bolo, chhote vaakya mein.' };
    case 'TIMEOUT':
      return { title: 'Jawab nahi aaya', hint: 'Dobara try karo. (The server did not answer in time.)' };
    case 'RATE_LIMITED':
      return { title: 'Bahut tez, thoda ruko', hint: 'Kuch second baad dobara try karo.' };
    default:
      return { title: 'Kuch gadbad hui', hint: 'Dobara try karo. (Something went wrong.)' };
  }
}

export function micErrorText(kind: MicErrorKind): FriendlyError {
  switch (kind) {
    case 'denied':
      return { title: 'Mic ki permission band hai', hint: 'Browser ya phone settings mein is site ke liye Microphone allow karo, phir page reload karo.' };
    case 'no_device':
      return { title: 'Mic nahi mila', hint: 'Mic jodo ya phone ka mic check karo, phir dobara try karo.' };
    case 'unsupported':
      return { title: 'Yeh browser mic support nahi karta', hint: 'Chrome ya Safari ka naya version use karo, aur HTTPS par kholo.' };
    default:
      return { title: 'Mic shuru nahi hua', hint: 'Dobara try karo.' };
  }
}

export function connectionNotice(state: ConnectionState): FriendlyError | null {
  switch (state.status) {
    case 'limited':
      return {
        title: state.reason === 'budget' ? 'Aaj ka demo budget khatam' : 'Demo abhi busy hai',
        hint: `${state.message} Khud dobara try karega. Khata aur samaan chal rahe hain.`,
      };
    case 'blocked':
      return { title: 'Demo access band hai', hint: state.message };
    case 'reconnecting':
      return { title: 'Connection ja raha hai', hint: 'Dobara jud raha hai…' };
    default:
      return null;
  }
}
