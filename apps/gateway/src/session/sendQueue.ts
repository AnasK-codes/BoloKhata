import { serverMessageSchema, type ServerMessage } from '@bolbill/shared';
import { CLOSE } from './closeCodes';

const OPEN = 1;

export interface SocketLike {
  readyState: number;
  bufferedAmount: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface SendQueueOptions {
  /** Above this many unsent bytes, TTS audio is dropped (stale audio is worthless). */
  ttsDropBytes: number;
  /** Above this, the client is hopelessly slow: close it instead of growing memory. */
  hardLimitBytes: number;
}

const DEFAULTS: SendQueueOptions = { ttsDropBytes: 512 * 1024, hardLimitBytes: 4 * 1024 * 1024 };

/**
 * Outbound policy for one socket. `ws` already queues writes; this adds the rules around it:
 * outbound JSON is validated against the shared schema, TTS audio of an interrupted turn is
 * dropped, audio is dropped first when the client falls behind, and a client that falls far
 * behind is closed rather than letting memory grow.
 */
export class SendQueue {
  droppedTtsFrames = 0;
  private readonly staleTurns = new Set<number>();
  private readonly options: SendQueueOptions;

  constructor(
    private readonly socket: SocketLike,
    options: Partial<SendQueueOptions> = {},
    private readonly onInvalid: (type: string) => void = () => undefined,
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  get isOpen(): boolean {
    return this.socket.readyState === OPEN;
  }

  json(message: ServerMessage): boolean {
    if (!this.isOpen) return false;
    if (!serverMessageSchema.safeParse(message).success) {
      this.onInvalid(message.type);
      return false;
    }
    if (this.socket.bufferedAmount > this.options.hardLimitBytes) {
      this.socket.close(CLOSE.busy, 'slow client');
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** `frame` must already carry the 5-byte TTS header. False means it was dropped. */
  tts(frame: Uint8Array, turnId: number): boolean {
    if (!this.isOpen) return false;
    if (this.staleTurns.has(turnId) || this.socket.bufferedAmount > this.options.ttsDropBytes) {
      this.droppedTtsFrames++;
      return false;
    }
    this.socket.send(frame);
    return true;
  }

  /** After this, audio for `turnId` is discarded even if a late chunk arrives. */
  markStale(turnId: number): void {
    this.staleTurns.add(turnId);
    if (this.staleTurns.size > 64) {
      const oldest = this.staleTurns.values().next().value;
      if (oldest !== undefined) this.staleTurns.delete(oldest);
    }
  }

  /** A turn ID is reused only by a new press, which must start un-stale. */
  markLive(turnId: number): void {
    this.staleTurns.delete(turnId);
  }
}
