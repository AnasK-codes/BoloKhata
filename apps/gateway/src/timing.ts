import { performance } from 'node:perf_hooks';
import type { TimingMessage, TimingSpan } from '@bolbill/shared';

/**
 * Per-turn timing recorder. Spans are milliseconds since the gateway first heard about the turn
 * (`ptt_start`). The first mark of a span wins so a retry cannot rewrite history. Only the most
 * recent turns are kept, so a long session does not grow without bound.
 */
interface TurnTiming {
  t0: number;
  spans: Partial<Record<TimingSpan, number>>;
  parseSource?: 'rules' | 'llm';
}

export class TurnTimer {
  private readonly turns = new Map<number, TurnTiming>();

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly keep = 8,
  ) {}

  start(turnId: number): void {
    this.turns.delete(turnId);
    this.turns.set(turnId, { t0: this.now(), spans: {} });
    while (this.turns.size > this.keep) {
      const oldest = this.turns.keys().next().value;
      if (oldest === undefined) break;
      this.turns.delete(oldest);
    }
  }

  /** Starts timing a turn that has no `ptt_start` (client-initiated speech), unless already timed. */
  ensure(turnId: number): void {
    if (!this.turns.has(turnId)) this.start(turnId);
  }

  mark(turnId: number, span: TimingSpan): void {
    const turn = this.turns.get(turnId);
    if (!turn || turn.spans[span] !== undefined) return;
    turn.spans[span] = Math.round((this.now() - turn.t0) * 10) / 10;
  }

  setParseSource(turnId: number, source: 'rules' | 'llm'): void {
    const turn = this.turns.get(turnId);
    if (turn) turn.parseSource = source;
  }

  message(turnId: number): TimingMessage | null {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    return {
      type: 'timing',
      turnId,
      spans: { ...turn.spans },
      ...(turn.parseSource ? { parseSource: turn.parseSource } : {}),
    };
  }
}
