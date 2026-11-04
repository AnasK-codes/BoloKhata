import type { HelloMessage, ServerMessage } from '@bolbill/shared';

/** Products with prices and customers with balances, as `hello` carries them. */
export type CatalogSnapshot = HelloMessage['catalog'];

export type LimitReason = 'busy' | 'budget' | 'session_expired' | 'rate_limited';

export type ConnectionState =
  | { status: 'idle' }
  | { status: 'connecting'; attempt: number }
  | {
      status: 'ready';
      sessionId: string;
      maxUtteranceSeconds: number;
      maxSessionMinutes: number;
      /** Latest round trip to the gateway in ms, once a ping has been answered. */
      rttMs: number | null;
    }
  /** Waiting `delayMs` before the next try after a drop or a failure. */
  | { status: 'reconnecting'; attempt: number; delayMs: number }
  /** The demo is busy or out of budget. Retrying automatically at `retryAt` (epoch ms). */
  | { status: 'limited'; reason: LimitReason; message: string; retryAt: number; resetAt?: string }
  /** Needs a person: wrong access code or a blocked origin. No automatic retry. */
  | { status: 'blocked'; reason: 'access_code_required' | 'origin_not_allowed'; message: string }
  | { status: 'closed' };

export type RealtimeIssue =
  /** An audio frame was not sent (socket not ready, or the send buffer was full). */
  | { kind: 'audio_dropped'; reason: 'not_ready' | 'backpressure' }
  | { kind: 'bad_message'; messageType?: string }
  | { kind: 'bad_binary' };

export interface RealtimeEvents {
  onState?: (state: ConnectionState) => void;
  /** Every validated JSON message from the gateway except `pong`. */
  onMessage?: (message: ServerMessage) => void;
  /** `pcm` is a view into the received buffer, valid only during the call: copy what you keep. */
  onTtsAudio?: (turnId: number, pcm: Uint8Array) => void;
  /** `audio_dropped` is reported once when a streak of dropped frames begins, not per frame. */
  onIssue?: (issue: RealtimeIssue) => void;
}
