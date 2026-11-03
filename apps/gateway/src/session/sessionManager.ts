import type { Session } from './session';

/** Tracks live sessions: the concurrency cap, the drain on shutdown. */
export class SessionManager {
  private readonly sessions = new Set<Session>();
  private emptyWaiters: (() => void)[] = [];

  constructor(readonly maxSessions: number) {}

  get size(): number {
    return this.sessions.size;
  }

  get isFull(): boolean {
    return this.sessions.size >= this.maxSessions;
  }

  add(session: Session): void {
    this.sessions.add(session);
  }

  remove(session: Session): void {
    this.sessions.delete(session);
    if (this.sessions.size === 0) {
      const waiters = this.emptyWaiters;
      this.emptyWaiters = [];
      for (const wake of waiters) wake();
    }
  }

  forEach(fn: (session: Session) => void): void {
    for (const session of [...this.sessions]) fn(session);
  }

  closeAll(code: number, reason: string): void {
    this.forEach((session) => session.close(code, reason));
  }

  /** Resolves when no sessions remain, or after `timeoutMs`. */
  whenEmpty(timeoutMs: number): Promise<void> {
    if (this.sessions.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.emptyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
