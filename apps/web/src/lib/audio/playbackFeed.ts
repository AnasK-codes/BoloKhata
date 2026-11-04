import type { PlaybackCommand } from './worklets/messages';

interface Pending {
  pcm: ArrayBuffer;
  ms: number;
}

/** Keep the ring this full at most, so a late stats message cannot cause an overflow. */
const FILL_LIMIT = 0.75;

/**
 * Decides when TTS chunks may be handed to the playback worklet. The gateway can deliver audio
 * much faster than real time (a cached phrase arrives in one burst), but the worklet's ring
 * holds only about two seconds. Chunks that do not fit wait here and are released as the
 * worklet reports free space. Pure logic: it only calls `post`.
 */
export class PlaybackFeed {
  private turn = -1;
  private sampleRate = 0;
  private pending: Pending[] = [];
  private estimateMs = 0;
  private endRequested = false;
  private endSent = false;

  constructor(
    private readonly capacityMs: number,
    private readonly post: (command: PlaybackCommand, transfer?: ArrayBuffer[]) => void,
  ) {}

  get activeTurn(): number {
    return this.turn;
  }

  get pendingMs(): number {
    return this.pending.reduce((sum, p) => sum + p.ms, 0);
  }

  begin(turnId: number, sampleRate: number): void {
    if (turnId !== this.turn) {
      this.pending = [];
      this.estimateMs = 0;
    }
    this.turn = turnId;
    this.sampleRate = sampleRate;
    this.endRequested = false;
    this.endSent = false;
    this.post({ type: 'begin', turnId, sampleRate });
  }

  /** `pcm` must be a buffer this feed may transfer away (the caller copied it). */
  push(turnId: number, pcm: ArrayBuffer): void {
    if (turnId !== this.turn || this.sampleRate === 0) return;
    this.pending.push({ pcm, ms: (pcm.byteLength / 2 / this.sampleRate) * 1000 });
    this.drain();
  }

  end(turnId: number): void {
    if (turnId !== this.turn) return;
    this.endRequested = true;
    this.drain();
  }

  /** The worklet's own count of buffered audio; replaces our running estimate. */
  onBuffered(bufferedMs: number): void {
    this.estimateMs = bufferedMs;
    this.drain();
  }

  flush(): void {
    this.pending = [];
    this.estimateMs = 0;
    this.turn = -1;
    this.sampleRate = 0;
    this.endRequested = false;
    this.endSent = false;
    this.post({ type: 'flush' });
  }

  private drain(): void {
    const limit = this.capacityMs * FILL_LIMIT;
    // An empty ring always accepts the next chunk, however long, so a big chunk cannot stall.
    while (this.pending.length > 0) {
      const next = this.pending[0] as Pending;
      if (this.estimateMs > 0 && this.estimateMs + next.ms > limit) break;
      this.pending.shift();
      this.estimateMs += next.ms;
      this.post({ type: 'chunk', turnId: this.turn, pcm: next.pcm }, [next.pcm]);
    }
    if (this.endRequested && !this.endSent && this.pending.length === 0) {
      this.endSent = true;
      this.post({ type: 'end', turnId: this.turn });
    }
  }
}
