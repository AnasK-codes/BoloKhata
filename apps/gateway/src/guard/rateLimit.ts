/** Fixed-window rate limiter keyed by string (an IP, or one shared key for a global limit). */
export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): RateResult {
    const t = this.now();
    if (this.windows.size > 5000) this.sweep(t);
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, entry);
    }
    if (entry.count >= this.limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
    }
    entry.count++;
    return { ok: true, retryAfterSec: 0 };
  }

  private sweep(t: number): void {
    for (const [key, entry] of this.windows) if (entry.resetAt <= t) this.windows.delete(key);
  }
}
